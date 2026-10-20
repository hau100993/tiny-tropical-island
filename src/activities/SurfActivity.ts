import * as THREE from 'three';
import { BOARD, SurfBody, type PopUp, type SurfControls, type SurfEnv, type SurfEvent } from './surfPhysics';
import type { SurfPose } from '../world/avatar';
import type { IslandColliders } from '../controls/islandColliders';
import type { WalkView } from '../controls/walker';
import { clamp, damp } from '../core/math';
import { SURF, createSurfSample, type SurfFrame } from '../water/surf';
import { WakeKind } from '../water/WakeMap';
import type { KayakEffects } from './KayakActivity';
import type { WaterSample } from './kayakPhysics';

const LOOK_SPEED = 0.0022;
const PITCH = { first: [-1.2, 1.2], third: [-1.0, 0.7] } as const;
/** Third person: camera distance behind the rider's head. */
const ARM = 4.8;
const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
/** Seconds without mouse movement before the camera drifts back behind the board. */
const RECENTER_AFTER = 1.2;
/** Standing up takes this long (s). */
const POP_TIME = 0.35;

export interface SurfEvents {
  /** The pointer lock was released (Esc) after having been active. */
  onUnlock(): void;
  onLockState(locked: boolean, failed: boolean): void;
  /** Space: the pop-up's outcome. */
  onPopUp(result: PopUp): void;
  /** Wiped out, the wave left you, or the board touched the beach. */
  onEvent(e: SurfEvent): void;
  /** A paddling stroke (left −1 / right +1). */
  onStroke(side: number, strength: number): void;
}

/**
 * Surfing: lie on the board and paddle (W, A/D), turn the nose to the beach as a wave comes, paddle
 * with it and press Space on its face to stand up; then A/D carve along the wave (Shift: harder),
 * W pumps, S stalls. The mouse looks around; the camera rides behind. When nobody is on it, the
 * board drifts on the waves and washes up on the beach.
 */
export class SurfActivity {
  active = false;
  view: WalkView = 'third';
  lookYaw = 0;
  pitch = -0.2;
  arm = ARM;
  readonly body: SurfBody;
  /** What the avatar needs (world space), refreshed every frame. */
  readonly pose: SurfPose = { board: new THREE.Matrix4(), stand: 0, stroke: 0, paddling: 0, crouch: 0, lean: 0, firstPerson: false };
  private readonly keys = new Set<string>();
  private readonly ctl: SurfControls = { forward: false, back: false, steer: 0, hard: false };
  private wasLocked = false;
  private camYaw = 0;
  private mouseIdle = 0;
  private wakeTimer = 0;
  private sprayTimer = 0;
  private lipTimer = 0;
  private lastStroke = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly p2 = { x: 0, z: 0 };
  private readonly lip = createSurfSample();
  private readonly sea: WaterSample = { height: 0, dhdx: 0, dhdz: 0 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly model: THREE.Group,
    private readonly env: SurfEnv,
    private readonly frame: SurfFrame,
    private readonly colliders: IslandColliders,
    private readonly events: SurfEvents,
    private readonly reducedMotion: () => boolean,
    private readonly fx: KayakEffects,
    /** The sea shader's clock (uTime). */
    private readonly time: () => number,
  ) {
    this.body = new SurfBody(env);
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && this.body.state === 'prone') this.events.onPopUp(this.body.popUp());
        return;
      }
      if (!KEYS.has(e.code)) return;
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !this.locked) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.lookYaw -= e.movementX * LOOK_SPEED;
      if (e.movementX !== 0) this.mouseIdle = 0;
      this.lookYaw = Math.atan2(Math.sin(this.lookYaw), Math.cos(this.lookYaw));
      const [lo, hi] = PITCH[this.view];
      this.pitch = clamp(this.pitch - e.movementY * LOOK_SPEED, lo, hi);
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.active) return;
      const locked = this.locked;
      if (locked) this.wasLocked = true;
      this.events.onLockState(locked, false);
      if (!locked && this.wasLocked) this.events.onUnlock();
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.active) this.events.onLockState(false, true);
    });
    dom.addEventListener('click', () => {
      if (this.active && !this.locked) this.requestLock();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  /** Where the board waits at first: on the sand above the break. */
  place(x: number, z: number, yaw: number): void {
    this.body.place(x, z, yaw);
    this.body.state = 'idle';
    this.syncModel(0);
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(this.body.x - x, this.body.z - z);
  }

  /** The board floats (not lying on the sand). */
  get afloat(): boolean {
    return this.body.depth > 0.3;
  }

  /**
   * Puts the board in the water on the shoulder of the break (the side the peel reaches last),
   * out past the close-out (≥ 22 m, ≥ 2.5 m deep): the waves lift it there instead of
   * washing it straight onto the sand.
   */
  launch(): void {
    const f = this.frame;
    const sx = -f.uz;
    const sz = f.ux;
    const l = 25;
    let d = 22;
    while (d < 60 && this.env.ground(f.ox - f.ux * d + sx * l, f.oz - f.uz * d + sz * l) > -2.5) d += 0.5;
    const x = f.ox - f.ux * d + sx * l;
    const z = f.oz - f.uz * d + sz * l;
    // Nose out to sea: forward (−sin yaw, −cos yaw) = −u.
    this.body.place(x, z, Math.atan2(f.ux, f.uz));
  }

  /** Beside the board (to slip into the water after a wipeout, or step off). */
  besideSpot(out: { x: number; z: number; yaw: number }): void {
    this.body.toWorld(0.9, 0, this.p2);
    out.x = this.p2.x;
    out.z = this.p2.z;
    out.yaw = this.body.yaw + this.lookYaw;
  }

  enter(): void {
    this.active = true;
    this.wasLocked = false;
    this.keys.clear();
    this.body.state = 'prone';
    this.pose.stand = 0;
    this.lookYaw = 0;
    this.camYaw = this.body.yaw;
    this.mouseIdle = 0;
    this.pitch = -0.2;
    this.arm = ARM;
    this.camera.rotation.order = 'YXZ';
    this.syncModel(0);
    this.applyCamera(0);
    this.requestLock();
  }

  exit(): void {
    this.active = false;
    this.keys.clear();
    if (this.body.state !== 'idle') this.body.state = 'idle';
    this.camera.rotation.order = 'XYZ';
    if (this.locked) document.exitPointerLock();
  }

  setView(view: WalkView): void {
    this.view = view;
    const [lo, hi] = PITCH[view];
    this.pitch = clamp(this.pitch, lo, hi);
  }

  private requestLock(): void {
    this.dom
      .requestPointerLock({ unadjustedMovement: true })
      .catch(() => this.dom.requestPointerLock())
      .catch(() => this.events.onLockState(false, true));
  }

  /** A wave coming in behind the board: time to paddle (for the hint). */
  get waveComing(): boolean {
    const s = this.body.wave;
    return this.body.state === 'prone' && s.size > 0.3 && s.x < SURF.closeOut && s.d > -0.04 && s.d < 0.32;
  }

  /** Fallen off: the rider is somewhere in the white water (not drawn) for a moment. */
  get riderHidden(): boolean {
    return this.body.state === 'wiped';
  }

  /** Every frame, ridden or not (an empty board still drifts on the waves). */
  update(dt: number, cameraPos: THREE.Vector3): void {
    dt = Math.min(dt, 0.05);
    let ev: SurfEvent = 'none';
    if (this.active) {
      const k = this.keys;
      const c = this.ctl;
      c.forward = k.has('KeyW') || k.has('ArrowUp');
      c.back = k.has('KeyS') || k.has('ArrowDown');
      c.steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
      c.hard = k.has('ShiftLeft') || k.has('ShiftRight');
      this.mouseIdle += dt;
      if (this.mouseIdle > RECENTER_AFTER && Math.hypot(this.body.vx, this.body.vz) > 0.4) this.lookYaw *= 1 - damp(1.2, dt);
      ev = this.body.step(dt, this.body.state === 'idle' ? null : c);
      this.strokes();
    } else {
      this.body.step(dt, null);
    }
    this.effects(dt, ev);
    this.lipSpray(dt, cameraPos);
    this.syncModel(dt);
    if (this.active) this.applyCamera(dt);
    if (ev !== 'none') this.events.onEvent(ev);
  }

  /** Each arm entering the water while paddling: a stroke (sound, splash). */
  private strokes(): void {
    const b = this.body;
    if (b.state !== 'prone' || b.paddling < 0.3) {
      this.lastStroke = Math.floor(b.stroke * 2);
      return;
    }
    const n = Math.floor(b.stroke * 2);
    if (n === this.lastStroke) return;
    this.lastStroke = n;
    const side = n % 2 ? 1 : -1;
    b.toWorld(side * 0.5, -0.35, this.p2);
    this.fx.wake?.emit(WakeKind.Ring, this.p2.x, this.p2.z, 0, 0, 1.0, 0.1, 0.6, 0.25, 0.04);
    for (let k = 0; k < 5; k++) {
      this.fx.spray.drop(this.p2.x, b.y + 0.05, this.p2.z, b.vx + (Math.random() - 0.5) * 0.6, 0.8 + Math.random(), b.vz + (Math.random() - 0.5) * 0.6, 0.012 + Math.random() * 0.01);
    }
    this.events.onStroke(side, b.paddling);
  }

  /** Wake behind the board, spray off the rail in a carve, a burst of water at a wipeout. */
  private effects(dt: number, ev: SurfEvent): void {
    const b = this.body;
    const wake = this.fx.wake;
    const v = Math.hypot(b.vx, b.vz);
    this.wakeTimer -= dt;
    if (wake && v > 0.3 && b.depth > 0.3 && this.wakeTimer <= 0) {
      this.wakeTimer = 0.05;
      b.toWorld(0, BOARD.length * 0.45, this.p2);
      const k = clamp(v / 4, 0, 1.3);
      wake.emit(WakeKind.Blob, this.p2.x, this.p2.z, 0, 0, 2.2, 0.12, 0.5, (b.state === 'ride' ? 0.3 : 0.12) * k, 0.03 * k);
    }
    // Carving: a fan of spray thrown off the outside of the turn, from the tail.
    this.sprayTimer -= dt;
    const carve = b.state === 'ride' ? Math.abs(b.w) * v : 0;
    if (carve > 2.5 && this.sprayTimer <= 0) {
      this.sprayTimer = 0.02;
      const out = b.w > 0 ? 1 : -1;
      const n = Math.min(6, Math.round(carve / 3));
      for (let k = 0; k < n; k++) {
        b.toWorld(out * 0.25, BOARD.length * 0.35, this.p2);
        const c = Math.cos(b.yaw);
        const s = Math.sin(b.yaw);
        const sp = 1 + Math.random() * 2.5;
        this.fx.spray.drop(this.p2.x, b.y + 0.05, this.p2.z, b.vx * 0.4 + out * c * sp, 1.2 + Math.random() * 2.2, b.vz * 0.4 - out * s * sp, 0.02 + Math.random() * 0.03);
      }
    }
    if (ev === 'wipeout') {
      wake?.emit(WakeKind.Ring, b.x, b.z, 0, 0, 2.5, 0.4, 2.2, 0.9, 0.12);
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2;
        const h = 0.5 + Math.random() * 2;
        this.fx.spray.drop(b.x, b.y + 0.2, b.z, Math.cos(a) * h + b.vx * 0.3, 1.5 + Math.random() * 3, Math.sin(a) * h + b.vz * 0.3, 0.02 + Math.random() * 0.04);
      }
    }
  }

  /**
   * The breaking lip throws spray: at the peel (where the wave is pitching right now) of every
   * crest near the camera, drops fly up and over the falls; a few along the broken part.
   */
  private lipSpray(dt: number, cam: THREE.Vector3): void {
    this.lipTimer -= dt;
    if (this.lipTimer > 0) return;
    this.lipTimer = 0.03;
    const f = this.frame;
    const rx = cam.x - f.ox;
    const rz = cam.z - f.oz;
    const cx = rx * f.ux + rz * f.uz;
    const cl = -rx * f.uz + rz * f.ux;
    if (cx < SURF.start - 40 || cx > 60 || Math.abs(cl) > SURF.halfWidth + 60) return;
    const time = this.time();
    // Crests: x − c·t = (n + ½)·L.
    const n0 = Math.ceil((SURF.breakAt - SURF.speed * time) / SURF.length - 0.5);
    for (let n = n0; ; n++) {
      const xc = SURF.speed * time + (n + 0.5) * SURF.length;
      if (xc > -4) break;
      const tau = (xc - SURF.breakAt) / SURF.speed;
      const peel = Math.min(SURF.halfWidth, SURF.peelStart + SURF.peelSpeed * tau);
      for (let k = 0; k < 3; k++) {
        // At the peel, or somewhere along the broken part behind it.
        const l = k === 0 ? peel : -SURF.halfWidth + Math.random() * (peel + SURF.halfWidth);
        if (l < -SURF.halfWidth) continue;
        const wx = f.ox + f.ux * (xc + 0.3) - f.uz * l;
        const wz = f.oz + f.uz * (xc + 0.3) + f.ux * l;
        if (Math.hypot(wx - cam.x, wz - cam.z) > 70) continue;
        this.env.surf(wx, wz, this.lip);
        if (this.lip.size < 0.3) continue;
        const y = this.env.water(wx, wz, this.sea).height;
        const up = (k === 0 ? 2.5 : 1.2) + Math.random() * 1.5;
        const fwd = SURF.speed * (0.6 + Math.random() * 0.6);
        this.fx.spray.drop(wx, y + 0.1, wz, f.ux * fwd + (Math.random() - 0.5), up, f.uz * fwd + (Math.random() - 0.5), 0.04 + Math.random() * 0.06);
      }
    }
  }

  /** Board mesh from the physics; the rider's pose. */
  private syncModel(dt: number): void {
    const b = this.body;
    const g = this.model;
    g.position.set(b.x, b.y, b.z);
    g.rotation.set(b.pitch, b.yaw, b.roll, 'YXZ');
    g.updateMatrixWorld(true);
    const p = this.pose;
    p.board.makeTranslation(0, BOARD.deckY, 0).premultiply(g.matrixWorld);
    const target = b.state === 'ride' ? 1 : 0;
    p.stand = dt === 0 ? target : clamp(p.stand + Math.sign(target - p.stand) * (dt / POP_TIME), 0, 1);
    p.stroke = b.stroke;
    p.paddling = b.paddling;
    p.crouch = clamp(0.35 + 0.25 * Math.abs(b.w) + (this.ctl.back && b.state === 'ride' ? 0.4 : 0) + (1 - p.stand) * 2 * (p.stand > 0 ? 1 : 0), 0, 1);
    p.lean = b.lean;
    p.firstPerson = this.view === 'first';
  }

  private applyCamera(dt: number): void {
    const b = this.body;
    const g = this.model;
    const standing = this.pose.stand >= 0.5;
    const head = standing ? this.tmp.set(0, 1.45, 0) : this.tmp.set(0, 0.5, -0.55);
    head.applyMatrix4(g.matrixWorld);
    // Follow the way the board goes when riding (it slides sideways in turns), its nose when lying.
    const v = Math.hypot(b.vx, b.vz);
    const heading = standing && v > 1 ? Math.atan2(-b.vx, -b.vz) : b.yaw;
    const turn = heading - this.camYaw;
    this.camYaw = dt === 0 ? heading : this.camYaw + Math.atan2(Math.sin(turn), Math.cos(turn)) * damp(3, dt);
    const calm = this.reducedMotion() ? 0 : 1;
    if (this.view === 'first') {
      this.camera.position.copy(head);
      this.camera.rotation.set(this.pitch + b.pitch * 0.3 * calm, b.yaw + this.lookYaw, b.roll * 0.2 * calm, 'YXZ');
      return;
    }
    const yaw = this.camYaw + this.lookYaw;
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(yaw) * cp;
    const oy = head.y + 0.3;
    const free = this.colliders.cameraDistance(head.x, oy, head.z, -fx, -fy, -fz, ARM);
    const want = Math.max(0.3, free - 0.25);
    if (want < this.arm || dt === 0) this.arm = want;
    else this.arm += (want - this.arm) * damp(3, dt);
    const cx = head.x - fx * this.arm;
    const cz = head.z - fz * this.arm;
    // Keep the camera above the wave behind (not inside it).
    const sea = this.env.water(cx, cz, this.sea).height;
    const cy = Math.max(oy - fy * this.arm, sea + 0.6, this.colliders.waterClearance(cx, cz));
    this.camera.position.set(cx, cy, cz);
    this.camera.rotation.set(this.pitch, yaw, clamp(b.lean * 0.15, -0.12, 0.12) * calm, 'YXZ');
  }
}
