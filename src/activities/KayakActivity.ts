import * as THREE from 'three';
import { HULL, KayakBody, Paddle, PADDLE, shaftDir, type BladeEvent, type KayakEnv, type PaddleControls } from './kayakPhysics';
import type { KayakModel } from '../world/kayak';
import type { SeatedPose } from '../world/avatar';
import type { IslandColliders } from '../controls/islandColliders';
import type { WalkView } from '../controls/walker';
import { clamp, damp } from '../core/math';
import { DragLook } from '../controls/dragLook';
import { isTyping } from '../controls/keymap';
import { WakeKind, type WakeSink } from '../water/WakeMap';
import type { SpraySink } from '../water/Spray';

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
const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
/** Seconds without mouse movement before the camera drifts back behind the boat. */
const RECENTER_AFTER = 1.2;

export interface KayakEvents {
  /** A blade entered or left the water. */
  onBlade(e: BladeEvent): void;
  /** Space: jump over the side into the sea. */
  onJump(): void;
}

/** Where the kayak's water effects go (the wake map can be missing on old GPUs). */
export interface KayakEffects {
  wake: WakeSink | null;
  spray: SpraySink;
}

/** tan(19.47°): the half-angle of the V behind anything moving on deep water (Kelvin wake). */
const KELVIN = 0.354;

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
  private readonly ctl: PaddleControls = { left: false, right: false, steer: 0, cruise: false, back: false, sweep: false };
  /** Mouse look: drag on the scene (see DragLook). */
  readonly look: DragLook;
  private wakeTimer = 0;
  private readonly bladeTimer = [0, 0];
  /** Seconds since each blade left the water (it drips for a while). */
  private readonly sinceExit = [9, 9];
  private dripTimer = 0;
  private readonly bp = { x: 0, y: 0, z: 0 };
  /** Third person: the camera follows the boat's heading with a little lag (turns read). */
  private camYaw = 0;
  private mouseIdle = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly dir = { x: 0, y: 0, z: 0 };
  private readonly basis = new THREE.Matrix4();
  private readonly restTurn = new THREE.Matrix4().makeRotationY(Math.PI / 2 - 0.06);
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly p2 = { x: 0, z: 0 };
  /** A knock's rocking: extra roll (rad) and heave (m), springs settling back (see jolt). */
  private joltRoll = 0;
  private joltRollV = 0;
  private joltHeave = 0;
  private joltHeaveV = 0;
  /** Capsized: seconds into it (−1 = upright) and which way it rolls (see capsize). */
  private capT = -1;
  private capSide = 1;
  /** The capsize's extra roll this frame (rad, 0 upright … π upside down … 2π upright again). */
  private capRoll = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly model: KayakModel,
    private readonly env: KayakEnv,
    private readonly colliders: IslandColliders,
    private readonly events: KayakEvents,
    private readonly reducedMotion: () => boolean,
    private readonly fx: KayakEffects,
  ) {
    this.body = new KayakBody(env);
    window.addEventListener('keydown', (e) => {
      if (this.active && e.code === 'Space' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        this.events.onJump();
        return;
      }
      if (!this.active || !KEYS.has(e.code) || e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return;
      if (!e.repeat) {
        if (e.code === 'KeyQ') this.latch.left = LATCH;
        if (e.code === 'KeyE') this.latch.right = LATCH;
      }
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.look = new DragLook(
      dom,
      (dx, dy) => {
        this.lookYaw -= dx * LOOK_SPEED;
        if (dx !== 0) this.mouseIdle = 0;
        this.lookYaw = Math.atan2(Math.sin(this.lookYaw), Math.cos(this.lookYaw));
        const [lo, hi] = PITCH[this.view];
        this.pitch = clamp(this.pitch - dy * LOOK_SPEED, lo, hi);
      },
      LOOK_SPEED,
    );
  }

  /**
   * A knock (Bé Mập's pranks): the hull rocks by `roll` rad and lifts by `heave` m, then swings
   * back and settles like a spring (a damped oscillation).
   */
  jolt(roll: number, heave: number): void {
    this.joltRollV += roll * 9;
    this.joltHeaveV += heave * 9;
  }

  /** Spun round (rad/s added to the yaw rate) and shoved (m/s, world). */
  shove(spin: number, vx: number, vz: number): void {
    this.body.w += spin;
    this.body.vx += vx;
    this.body.vz += vz;
  }

  /** Upside down for a moment, then rolled up again (an Eskimo roll); false if it cannot now. */
  capsize(side: 1 | -1): boolean {
    if (!this.active || this.capT >= 0) return false;
    if (this.reducedMotion()) {
      this.jolt(side * 0.5, 0.15);
      return false;
    }
    this.capT = 0;
    this.capSide = side;
    return true;
  }

  /** Capsized right now (upside down or rolling). */
  get capsized(): boolean {
    return this.capT >= 0;
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

  /** Just beside the cockpit on the left (to slip into deep water and swim). */
  besideSpot(out: { x: number; z: number; yaw: number }): void {
    this.body.toWorld(-1.1, HULL.seatZ, this.p2);
    out.x = this.p2.x;
    out.z = this.p2.z;
    out.yaw = this.body.yaw + this.lookYaw;
  }

  enter(): void {
    this.active = true;
    this.keys.clear();
    this.latch.left = this.latch.right = 0;
    this.lookYaw = 0;
    this.camYaw = this.body.yaw;
    this.mouseIdle = 0;
    this.pitch = -0.18;
    this.arm = ARM;
    this.camera.rotation.order = 'YXZ';
    this.applyCamera(0);
    this.look.start();
  }

  exit(): void {
    this.active = false;
    this.keys.clear();
    this.camera.rotation.order = 'XYZ';
    this.look.stop();
  }

  setView(view: WalkView): void {
    this.view = view;
    const [lo, hi] = PITCH[view];
    this.pitch = clamp(this.pitch, lo, hi);
  }

  /** Every frame, paddled or not (an empty kayak still floats on the waves). */
  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    if (this.active) {
      const k = this.keys;
      // Paddling (a key held, or a Q/E stroke running): the mouse steers (DragLook).
      let paddling = this.latch.left > 0 || this.latch.right > 0;
      for (const key of k) if (!key.startsWith('Shift')) paddling = true;
      this.look.update(dt, paddling);
      this.latch.left = Math.max(0, this.latch.left - dt);
      this.latch.right = Math.max(0, this.latch.right - dt);
      const c = this.ctl;
      // A/D steer (the paddle picks the strokes); Q/E stroke one side by hand. Not while
      // capsized (the paddler is busy rolling back up).
      const free = this.capT < 0;
      c.left = free && (k.has('KeyQ') || this.latch.left > 0);
      c.right = free && (k.has('KeyE') || this.latch.right > 0);
      c.steer = free ? (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) : 0;
      c.cruise = free && (k.has('KeyW') || k.has('ArrowUp'));
      c.back = free && (k.has('KeyS') || k.has('ArrowDown'));
      c.sweep = free && (k.has('ShiftLeft') || k.has('ShiftRight'));
      this.paddle.update(dt, c, this.body.speed);
      // Not looking around and moving: the view settles back behind the boat, like a car cam.
      this.mouseIdle += dt;
      if (this.mouseIdle > RECENTER_AFTER && Math.abs(this.body.speed) > 0.25) this.lookYaw *= 1 - damp(1.2, dt);
      if (this.paddle.consumed(-1)) this.latch.left = 0;
      if (this.paddle.consumed(1)) this.latch.right = 0;
      this.body.step(dt, this.paddle, this.onBlade);
      this.bladeEffects(dt);
    } else {
      this.body.step(dt, null);
    }
    this.knocks(dt);
    this.hullWake(dt);
    this.syncModel();
    if (this.active) this.applyCamera(dt);
  }

  /** The rocking springs settle; a capsize runs its course (tip over, hang, roll up). */
  private knocks(dt: number): void {
    // Damped springs: a = −k·x − c·v (rocks a few times, then still).
    this.joltRollV += (-26 * this.joltRoll - 3.2 * this.joltRollV) * dt;
    this.joltRoll += this.joltRollV * dt;
    this.joltHeaveV += (-30 * this.joltHeave - 5 * this.joltHeaveV) * dt;
    this.joltHeave += this.joltHeaveV * dt;
    if (this.capT < 0) {
      this.capRoll = 0;
      return;
    }
    const was = this.capT;
    this.capT += dt;
    const t = this.capT;
    const ease = (k: number): number => k * k * (3 - 2 * k);
    // Over in 0.45 s, upside down until 1.85 s, then on round to upright by 2.75 s.
    if (t < 0.45) this.capRoll = Math.PI * ease(t / 0.45);
    else if (t < 1.85) this.capRoll = Math.PI;
    else if (t < 2.75) this.capRoll = Math.PI * (1 + ease((t - 1.85) / 0.9));
    else {
      this.capRoll = 0;
      this.capT = -1;
    }
    // A burst of water as it goes over and as it comes up.
    if ((was < 0.35 && t >= 0.35) || (was < 2.6 && t >= 2.6)) this.splashBurst(30);
  }

  /** Water thrown up all round the hull (a capsize, a breach landing beside it). */
  splashBurst(n: number): void {
    const b = this.body;
    this.fx.wake?.emit(WakeKind.Ring, b.x, b.z, 0, 0, 2.5, 0.4, 2.2, 0.9, 0.12);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const h = 0.5 + Math.random() * 1.8;
      this.fx.spray.drop(b.x + Math.cos(a) * 0.4, b.y + 0.2, b.z + Math.sin(a) * 0.4, Math.cos(a) * h + b.vx * 0.3, 1.5 + Math.random() * 2.5, Math.sin(a) * h + b.vz * 0.3, 0.02 + Math.random() * 0.04);
    }
  }

  /** The blade in or out of the water: splash ring, droplets, the swirl it leaves behind. */
  private readonly onBlade = (e: BladeEvent): void => {
    const i = e.side < 0 ? 0 : 1;
    const b = this.body;
    const wake = this.fx.wake;
    this.body.bladeWorld(i, this.bp);
    const y = Math.max(this.bp.y, b.y - 0.02);
    if (e.kind === 'catch') {
      wake?.emit(WakeKind.Ring, e.x, e.z, 0, 0, 1.1, 0.12, 0.9, 0.3, 0.05 + 0.04 * e.strength);
      const n = 4 + Math.round(8 * e.strength);
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const h = 0.4 + Math.random() * 0.8;
        this.fx.spray.drop(e.x, y, e.z, b.vx + Math.cos(a) * h, 1.2 + Math.random() * 1.6 * (0.5 + e.strength), b.vz + Math.sin(a) * h, 0.012 + Math.random() * 0.012);
      }
    } else {
      // The pull leaves a pair of small whirlpools where the blade came out: the classic
      // trail of a kayak, dimples with foam spun round them, drifting slowly behind.
      wake?.emit(WakeKind.Eddy, e.x, e.z, 0, 0, 5, 0.22, 0.6, 0.5, 0.08);
      this.body.toWorld(e.side * 0.75, HULL.seatZ + 0.15, this.p2);
      wake?.emit(WakeKind.Eddy, (e.x + this.p2.x) / 2, (e.z + this.p2.z) / 2, 0, 0, 4, 0.16, 0.45, 0.35, 0.06);
      // Water sheeting off the blade as it rises.
      for (let k = 0; k < 6; k++) {
        this.fx.spray.drop(e.x, y + 0.1, e.z, b.vx * 0.5 + (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 1.2, b.vz * 0.5 + (Math.random() - 0.5) * 0.6, 0.01 + Math.random() * 0.01);
      }
      this.sinceExit[i] = 0;
    }
    this.events.onBlade(e);
  };

  /** While a blade pulls: whitewater around it. After it leaves the water: drips. */
  private bladeEffects(dt: number): void {
    const b = this.body;
    this.dripTimer -= dt;
    for (let i = 0; i < 2; i++) {
      const wet = b.bladeWorld(i, this.bp);
      this.sinceExit[i] += dt;
      this.bladeTimer[i] -= dt;
      if (wet > 0.2 && this.paddle.stroking && this.bladeTimer[i] <= 0) {
        this.bladeTimer[i] = 0.05;
        this.fx.wake?.emit(WakeKind.Blob, this.bp.x, this.bp.z, 0, 0, 1.6, 0.1, 0.32, 0.28 * wet, 0.04 * wet);
      }
      // Drips from the raised blade for about a second.
      if (wet < 0.05 && this.sinceExit[i] < 1.1 && this.dripTimer <= 0) {
        this.fx.spray.drop(this.bp.x, this.bp.y + 0.05, this.bp.z, b.vx, -0.2, b.vz, 0.008 + Math.random() * 0.006);
      }
    }
    if (this.dripTimer <= 0) this.dripTimer = 0.06;
  }

  /**
   * Bow and stern: while moving, marks slide out sideways from both bow shoulders at
   * tan(19.5°) × speed, so the trail of marks opens into the Kelvin V; a softer wash spreads
   * behind the stern.
   */
  private hullWake(dt: number): void {
    const wake = this.fx.wake;
    const b = this.body;
    const v = b.speed;
    const av = Math.abs(v);
    this.wakeTimer -= dt;
    if (!wake || av < 0.15 || b.grounded > 0.5 || this.wakeTimer > 0) return;
    this.wakeTimer = 0.045;
    const k = clamp(av / 1.6, 0, 1.2);
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    // Right in the world: (cos yaw, −sin yaw).
    const out = KELVIN * av;
    const front = v >= 0 ? -1.55 : 1.6;
    for (const side of [-1, 1]) {
      b.toWorld(side * 0.2, front, this.p2);
      wake.emit(WakeKind.Blob, this.p2.x, this.p2.z, side * c * out, -side * s * out, 3, 0.08, 0.4, 0.12 * k, 0.05 * k);
    }
    b.toWorld(0, -front * 1.15, this.p2);
    wake.emit(WakeKind.Blob, this.p2.x, this.p2.z, 0, 0, 2.5, 0.14, 0.6, 0.07 * k, -0.025 * k);
  }

  /** Hull and paddle meshes from the physics; the avatar's seat and grips. */
  private syncModel(): void {
    const b = this.body;
    const g = this.model.group;
    // Upside down it floats a little lower (the hull's bottom at the surface).
    const sunk = Math.sin(Math.min(Math.PI, this.capRoll)) * 0.1 + (this.capRoll > 0.5 && this.capRoll < 5.8 ? 0.12 : 0);
    g.position.set(b.x, b.y + this.joltHeave - sunk, b.z);
    g.rotation.set(b.pitch, b.yaw, -b.roll - this.joltRoll - this.capSide * this.capRoll, 'YXZ');
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
    // The head looks where the camera looks (relative to the boat).
    const rel = this.camYaw + this.lookYaw - this.body.yaw;
    s.lookYaw = Math.atan2(Math.sin(rel), Math.cos(rel));
    s.lookPitch = this.pitch;
    s.firstPerson = this.view === 'first';
  }

  private applyCamera(dt: number): void {
    const b = this.body;
    const g = this.model.group;
    const head = this.tmp.set(0, HULL.seatY + EYE.y, HULL.seatZ + EYE.z).applyMatrix4(g.matrixWorld);
    const turn = b.yaw - this.camYaw;
    // Capsized, seen from behind: the camera keeps to where the head would be upright (it
    // watches the hull go over and come up, instead of diving with it).
    if (this.capT >= 0 && this.view !== 'first') head.set(b.x, b.y + HULL.seatY + EYE.y, b.z);
    this.camYaw = dt === 0 ? b.yaw : this.camYaw + Math.atan2(Math.sin(turn), Math.cos(turn)) * damp(4, dt);
    const calm = this.reducedMotion() ? 0 : 1;
    if (this.view === 'first') {
      const yaw = b.yaw + this.lookYaw;
      // The boat's roll and pitch, softened (and none with reduced motion).
      const k = 0.35 * calm;
      this.camera.position.copy(head);
      // Capsized: the view turns over with you (under water for a moment).
      this.camera.rotation.set(this.pitch + b.pitch * k, yaw, -b.roll * k - this.joltRoll * 0.5 * calm - this.capSide * this.capRoll, 'YXZ');
      return;
    }
    const yaw = this.camYaw + this.lookYaw;
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
    // Leans a touch into turns.
    this.camera.rotation.set(this.pitch, yaw, clamp(-b.w * 0.05, -0.04, 0.04) * calm, 'YXZ');
  }
}
