import * as THREE from 'three';
import { HULL, KayakBody, Paddle, PADDLE, shaftDir, type BladeEvent, type KayakEnv, type PaddleControls } from './kayakPhysics';
import type { KayakModel } from '../world/kayak';
import type { SeatedPose } from '../world/avatar';
import type { IslandColliders } from '../controls/islandColliders';
import type { WalkView } from '../controls/walker';
import { clamp, damp } from '../core/math';

const LOOK_SPEED = 0.0022;
const PITCH = { first: [-1.2, 1.2], third: [-1.0, 0.7] } as const;
/** Third person: camera distance behind the paddler's head. */
const ARM = 4.6;
/** Eyes above the seat, and a little forward of it. */
const EYE = { y: 0.84, z: -0.06 } as const;
/** A tapped stroke key still counts this long (a quick tap mid-stroke isn't lost). */
const LATCH = 0.6;
/** Deepest water you can step out into (m), as deep as you can wade. */
const MAX_STEP_OUT = 0.9;
const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export interface KayakEvents {
  /** The pointer lock was released (Esc) after having been active. */
  onUnlock(): void;
  onLockState(locked: boolean, failed: boolean): void;
  /** A blade entered or left the water. */
  onBlade(e: BladeEvent): void;
  /** Bow wave while moving: a ripple at (x, z). */
  onWake(x: number, z: number, strength: number): void;
}

/**
 * Paddling the kayak: keys drive the paddle strokes (see kayakPhysics), the mouse looks
 * around (the head turns, the boat doesn't), the camera rides with the boat. When nobody sits
 * in it, the kayak keeps floating (or lies on the sand) where it was left.
 */
export class KayakActivity {
  active = false;
  view: WalkView = 'third';
  /** Look direction relative to the boat. */
  lookYaw = 0;
  pitch = -0.18;
  /** Third person: current camera distance (shorter when something is in the way). */
  arm = ARM;
  readonly body: KayakBody;
  readonly paddle = new Paddle();
  /** What the avatar needs to sit and hold the paddle (world space), refreshed every frame. */
  readonly seated: SeatedPose = {
    seat: new THREE.Matrix4(),
    hands: [new THREE.Vector3(), new THREE.Vector3()],
    twist: 0,
    lean: 0,
    lookYaw: 0,
    lookPitch: 0,
    // In the footwells (deck ≈ 0.085 m above the seat there) plus the ankle's height.
    feet: { x: 0.15, y: 0.16, z: -0.66 },
    firstPerson: false,
  };
  private readonly keys = new Set<string>();
  private readonly latch = { left: 0, right: 0 };
  private readonly ctl: PaddleControls = { left: false, right: false, cruise: false, back: false, sweep: false };
  private wasLocked = false;
  private wakeTimer = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly dir = { x: 0, y: 0, z: 0 };
  private readonly basis = new THREE.Matrix4();
  private readonly restTurn = new THREE.Matrix4().makeRotationY(Math.PI / 2 - 0.06);
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly p2 = { x: 0, z: 0 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly model: KayakModel,
    private readonly env: KayakEnv,
    private readonly colliders: IslandColliders,
    private readonly events: KayakEvents,
    private readonly reducedMotion: () => boolean,
  ) {
    this.body = new KayakBody(env);
    window.addEventListener('keydown', (e) => {
      if (!this.active || !KEYS.has(e.code) || e.ctrlKey || e.altKey || e.metaKey) return;
      if (!e.repeat) {
        if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.latch.left = LATCH;
        if (e.code === 'KeyD' || e.code === 'ArrowRight') this.latch.right = LATCH;
      }
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !this.locked) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.lookYaw -= e.movementX * LOOK_SPEED;
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

  /** Where the kayak waits at first: pulled up on the sand. */
  place(x: number, z: number, yaw: number): void {
    this.body.place(x, z, yaw);
    this.syncModel();
  }

  /** Distance (m) from (x, z) to the kayak. */
  distanceTo(x: number, z: number): number {
    return Math.hypot(this.body.x - x, this.body.z - z);
  }

  /**
   * Puts the kayak in the water near (x, z), afloat (0.35–0.85 m deep) and pointing out to sea.
   * False when there is no such water within ~14 m.
   */
  launchNear(x: number, z: number): boolean {
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let r = 1.5; r <= 14; r += 0.75) {
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const g = this.env.ground(px, pz);
        if (g > -0.35 || g < -0.85 || r >= best) continue;
        best = r;
        bx = px;
        bz = pz;
      }
      if (best < Infinity) break;
    }
    if (best === Infinity) return false;
    // Bow down the slope of the seabed (toward deeper water).
    const e = 1;
    const gx = this.env.ground(bx + e, bz) - this.env.ground(bx - e, bz);
    const gz = this.env.ground(bx, bz + e) - this.env.ground(bx, bz - e);
    // Forward is (−sin yaw, −cos yaw); point it along −gradient.
    const yaw = Math.atan2(gx, gz);
    // Move out until the whole hull floats.
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let d = 0;
    while (d < 6 && (this.env.ground(bx + fx * (d + 1.8), bz + fz * (d + 1.8)) > -0.25 || this.env.ground(bx + fx * (d - 1.8), bz + fz * (d - 1.8)) > -0.2)) d += 0.25;
    this.body.place(bx + fx * d, bz + fz * d, yaw);
    this.body.y = 0;
    this.syncModel();
    return true;
  }

  /**
   * Where you can step out: beside the cockpit, on whichever side is shallower, if the water
   * there is no deeper than you can wade. Null when it is too deep on both sides.
   */
  landingSpot(out: { x: number; z: number; yaw: number }): boolean {
    let best = -Infinity;
    for (const s of [-1, 1]) {
      this.body.toWorld(s * 0.95, HULL.seatZ, this.p2);
      const g = this.env.ground(this.p2.x, this.p2.z);
      if (g < -MAX_STEP_OUT || g <= best) continue;
      best = g;
      out.x = this.p2.x;
      out.z = this.p2.z;
    }
    out.yaw = this.body.yaw + this.lookYaw;
    return best > -Infinity;
  }

  enter(): void {
    this.active = true;
    this.wasLocked = false;
    this.keys.clear();
    this.latch.left = this.latch.right = 0;
    this.lookYaw = 0;
    this.pitch = -0.18;
    this.arm = ARM;
    this.camera.rotation.order = 'YXZ';
    this.applyCamera(0);
    this.requestLock();
  }

  exit(): void {
    this.active = false;
    this.keys.clear();
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

  /** Every frame, paddled or not (an empty kayak still floats on the waves). */
  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    if (this.active) {
      const k = this.keys;
      this.latch.left = Math.max(0, this.latch.left - dt);
      this.latch.right = Math.max(0, this.latch.right - dt);
      const c = this.ctl;
      c.left = k.has('KeyA') || k.has('ArrowLeft') || this.latch.left > 0;
      c.right = k.has('KeyD') || k.has('ArrowRight') || this.latch.right > 0;
      c.cruise = k.has('KeyW') || k.has('ArrowUp');
      c.back = k.has('KeyS') || k.has('ArrowDown');
      c.sweep = k.has('ShiftLeft') || k.has('ShiftRight');
      this.paddle.update(dt, c);
      if (this.paddle.consumed(-1)) this.latch.left = 0;
      if (this.paddle.consumed(1)) this.latch.right = 0;
      this.body.step(dt, this.paddle, (e) => this.events.onBlade(e));
      // Bow wave: a small ripple off the bow every few tenths of a second when moving.
      const v = Math.abs(this.body.speed);
      this.wakeTimer -= dt;
      if (v > 0.35 && this.wakeTimer <= 0 && this.body.grounded < 0.5) {
        this.wakeTimer = 0.3;
        this.body.toWorld(0, -1.75, this.p2);
        this.events.onWake(this.p2.x, this.p2.z, clamp(v / 2, 0.2, 1));
      }
    } else {
      this.body.step(dt, null);
    }
    this.syncModel();
    if (this.active) this.applyCamera(dt);
  }

  /** Hull and paddle meshes from the physics; the avatar's seat and grips. */
  private syncModel(): void {
    const b = this.body;
    const g = this.model.group;
    g.position.set(b.x, b.y, b.z);
    g.rotation.set(b.pitch, b.yaw, -b.roll, 'YXZ');
    // Resting across the lap when nobody paddles; at rest on its side when empty.
    const pose = this.paddle.pose;
    const paddle = this.model.paddle;
    paddle.visible = true;
    shaftDir(pose, this.dir);
    const d = this.v1.set(this.dir.x, this.dir.y, this.dir.z);
    // Blade face: across the shaft, as upright as possible (facing back during the pull).
    const up = this.v2.set(0, 1, 0).addScaledVector(d, -d.y).normalize();
    const n = this.v3.crossVectors(d, up);
    this.basis.makeBasis(d, up, n);
    paddle.quaternion.setFromRotationMatrix(this.basis);
    if (this.active) {
      paddle.position.set(pose.cx, HULL.seatY + pose.cy, HULL.seatZ + pose.cz);
    } else {
      // Empty kayak: the paddle lies flat along the deck, blades down.
      paddle.position.set(0.1, HULL.seatY + 0.17, HULL.seatZ - 0.75);
      this.basis.makeRotationX(Math.PI / 2).premultiply(this.restTurn);
      paddle.quaternion.setFromRotationMatrix(this.basis);
    }
    g.updateMatrixWorld(true);
    const s = this.seated;
    s.seat.makeTranslation(0, HULL.seatY, HULL.seatZ).premultiply(g.matrixWorld);
    for (let i = 0; i < 2; i++) {
      const e = i === 0 ? -1 : 1;
      s.hands[i].set(pose.cx + d.x * e * PADDLE.grip, HULL.seatY + pose.cy + d.y * e * PADDLE.grip, HULL.seatZ + pose.cz + d.z * e * PADDLE.grip).applyMatrix4(g.matrixWorld);
    }
    s.twist = this.paddle.twist;
    // Lean into the catch, sit up at the exit.
    s.lean = 0.08 + 0.12 * clamp(-(pose.cz + 0.24) / 0.12, 0, 1);
    s.lookYaw = this.lookYaw;
    s.lookPitch = this.pitch;
    s.firstPerson = this.view === 'first';
  }

  private applyCamera(dt: number): void {
    const b = this.body;
    const g = this.model.group;
    const head = this.tmp.set(0, HULL.seatY + EYE.y, HULL.seatZ + EYE.z).applyMatrix4(g.matrixWorld);
    const yaw = b.yaw + this.lookYaw;
    if (this.view === 'first') {
      // The boat's roll and pitch, softened (and none with reduced motion).
      const k = this.reducedMotion() ? 0 : 0.35;
      this.camera.position.copy(head);
      this.camera.rotation.set(this.pitch + b.pitch * k, yaw, -b.roll * k, 'YXZ');
      return;
    }
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(yaw) * cp;
    const oy = head.y + 0.15;
    const free = this.colliders.cameraDistance(head.x, oy, head.z, -fx, -fy, -fz, ARM);
    const want = Math.max(0.3, free - 0.25);
    if (want < this.arm || dt === 0) this.arm = want;
    else this.arm += (want - this.arm) * damp(3, dt);
    const cx = head.x - fx * this.arm;
    const cz = head.z - fz * this.arm;
    const cy = Math.max(oy - fy * this.arm, this.colliders.waterClearance(cx, cz));
    this.camera.position.set(cx, cy, cz);
    this.camera.rotation.set(this.pitch, yaw, 0, 'YXZ');
  }
}
