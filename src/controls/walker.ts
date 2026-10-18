import * as THREE from 'three';
import type { Support } from './collision';
import type { IslandColliders, Shelter, WalkSurface } from './islandColliders';
import { clamp, damp } from '../core/math';

/** Eye height above the feet (m). */
export const EYE_HEIGHT = 1.65;
const RADIUS = 0.3;
const WALK_SPEED = 1.6;
const RUN_SPEED = 4.0;
/** Deepest water you can wade into (m). */
export const MAX_WADE = 0.9;
/** Radians per pixel of mouse movement. */
const LOOK_SPEED = 0.0022;
/** Look up/down limits per view; third person can't look far up (the camera would hit the ground). */
const PITCH = { first: [-1.45, 1.45], third: [-1.2, 0.45] } as const;
/** Third person: camera distance behind the pivot, and pivot height above the feet (chest). */
const ARM = 4.2;
const HEAD = 1.4;

export type WalkView = 'first' | 'third';

export interface StepEvent {
  surface: WalkSurface;
  /** 0.4 (slow walk) … 1 (running). */
  strength: number;
  /** Water depth at the feet (m), 0 on land. */
  depth: number;
}

export interface WalkerEvents {
  /** Each footfall. */
  onStep(e: StepEvent): void;
  /** The pointer lock was released (Esc) after having been active. */
  onUnlock(): void;
  /** Pointer lock state changed or could not be obtained (`failed`), for the on-screen hint. */
  onLockState(locked: boolean, failed: boolean): void;
}

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);

/**
 * Walking on the island: pointer-lock mouse look, WASD/arrows, Shift to run. Movement follows
 * the terrain and the house floor/steps, slides along trunks and walls, wades into shallow
 * water (slower) and stops at chest-deep water. Footfalls are reported every stride.
 *
 * Two views: through the eyes ('first'), or a camera behind the character ('third') that
 * pulls in when a wall, the roof, a trunk or the ground is in the way. Movement is relative
 * to where the camera looks in both.
 */
export class Walker {
  active = false;
  /** Feet position. */
  x = 0;
  z = 0;
  feetY = 0;
  yaw = 0;
  pitch = 0;
  surface: WalkSurface = 'sand';
  shelter: Shelter = 'none';
  /** Water depth at the feet (m). */
  depth = 0;
  /** Current horizontal speed (m/s). */
  speed = 0;
  running = false;
  view: WalkView = 'third';
  /** Footfall counter: +1 per step (drives the avatar's gait). */
  phase = 0;
  /** Third person: current camera distance (shorter when something is in the way). */
  arm = ARM;
  private placed = false;
  private eyeY = 0;
  readonly vel = new THREE.Vector2();
  private readonly keys = new Set<string>();
  private wasLocked = false;
  private readonly tmp = { x: 0, z: 0 };
  private readonly sup: Support<WalkSurface> = { y: 0, surface: 'sand', onPlatform: false };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly colliders: IslandColliders,
    private readonly events: WalkerEvents,
    private readonly reducedMotion: () => boolean,
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.active || !MOVE_KEYS.has(e.code) || e.ctrlKey || e.altKey || e.metaKey) return;
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !this.locked) return;
      // Chrome sometimes reports a huge jump right after locking; ignore it.
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.yaw -= e.movementX * LOOK_SPEED;
      const [lo, hi] = PITCH[this.view];
      this.pitch = clamp(this.pitch - e.movementY * LOOK_SPEED, lo, hi);
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = this.locked;
      if (locked) this.wasLocked = true;
      this.events.onLockState(locked, false);
      if (!locked && this.active && this.wasLocked) this.events.onUnlock();
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.active) this.events.onLockState(false, true);
    });
    // Click the scene to (re)gain the mouse, e.g. when the browser refused the first request.
    dom.addEventListener('click', () => {
      if (this.active && !this.locked) this.requestLock();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.dom;
  }

  /** Starts walking: at the last position, or at `spawn` the first time. */
  enter(spawn: { x: number; z: number; yaw: number }): void {
    if (!this.placed) {
      this.x = spawn.x;
      this.z = spawn.z;
      this.yaw = spawn.yaw;
      this.pitch = -0.22;
      this.feetY = this.colliders.world.supportAt(spawn.x, spawn.z, 1000, this.sup) ? this.sup.y : 0;
      this.placed = true;
    }
    this.active = true;
    this.wasLocked = false;
    this.keys.clear();
    this.vel.set(0, 0);
    this.eyeY = this.feetY + EYE_HEIGHT;
    this.arm = ARM;
    this.setView(this.view);
    this.camera.rotation.order = 'YXZ';
    this.applyCamera(0);
    this.requestLock();
  }

  setView(view: WalkView): void {
    this.view = view;
    const [lo, hi] = PITCH[view];
    this.pitch = clamp(this.pitch, lo, hi);
  }

  exit(): void {
    this.active = false;
    this.keys.clear();
    this.speed = 0;
    this.camera.rotation.order = 'XYZ';
    if (this.locked) document.exitPointerLock();
  }

  private requestLock(): void {
    // Raw mouse input (no OS acceleration) where supported; plain lock otherwise.
    this.dom
      .requestPointerLock({ unadjustedMovement: true })
      .catch(() => this.dom.requestPointerLock())
      .catch(() => this.events.onLockState(false, true));
  }

  update(dt: number): void {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    this.running = run;
    // Wading slows you down, the deeper the slower.
    const wade = 1 - 0.55 * clamp(this.depth / MAX_WADE, 0, 1);
    const max = (run ? RUN_SPEED : WALK_SPEED) * wade;
    const len = Math.hypot(fwd, side) || 1;
    // Forward is −Z rotated by yaw; right is +X rotated by yaw.
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const tx = ((-s * fwd + c * side) / len) * max;
    const tz = ((-c * fwd - s * side) / len) * max;
    const a = damp(10, dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.y += (tz - this.vel.y) * a;

    const x0 = this.x;
    const z0 = this.z;
    if (this.vel.lengthSq() > 1e-6) {
      const dx = this.vel.x * dt;
      const dz = this.vel.y * dt;
      // Slide: if the full move is blocked, try each axis on its own.
      if (!this.tryMove(this.x + dx, this.z + dz) && !this.tryMove(this.x + dx, this.z)) this.tryMove(this.x, this.z + dz);
    }
    const moved = Math.hypot(this.x - x0, this.z - z0);
    this.speed = moved / dt;

    // Ground under the feet even when standing still (the house floor, the seabed).
    if (this.colliders.world.supportAt(this.x, this.z, this.feetY, this.sup)) {
      this.feetY = this.sup.y;
      this.surface = this.sup.surface;
      this.depth = this.sup.onPlatform ? 0 : Math.max(0, -this.sup.y);
    }
    this.shelter = this.colliders.shelterAt(this.x, this.z, this.feetY);

    // A footfall every stride; longer strides when running.
    const stride = run ? 0.95 : 0.7;
    const before = Math.floor(this.phase);
    this.phase += moved / stride;
    if (Math.floor(this.phase) !== before) {
      this.events.onStep({
        surface: this.surface,
        strength: clamp(0.25 + this.speed / RUN_SPEED, 0.4, 1),
        depth: this.depth,
      });
    }
    this.applyCamera(dt);
  }

  private tryMove(nx: number, nz: number): boolean {
    const world = this.colliders.world;
    world.resolve(nx, nz, this.feetY, RADIUS, this.tmp);
    if (!world.supportAt(this.tmp.x, this.tmp.z, this.feetY, this.sup)) return false;
    // Too deep: only allow moves that don't take you deeper.
    if (!this.sup.onPlatform && this.sup.y < -MAX_WADE && this.sup.y < this.feetY) return false;
    this.x = this.tmp.x;
    this.z = this.tmp.z;
    this.feetY = this.sup.y;
    return true;
  }

  private applyCamera(dt: number): void {
    const target = this.feetY + EYE_HEIGHT;
    const diff = target - this.eyeY;
    // Smooth over steps and bumps; snap on big jumps (first frame, teleports).
    if (Math.abs(diff) > 3 || dt === 0) this.eyeY = target;
    else this.eyeY += diff * damp(diff > 0 ? 14 : 10, dt);
    if (this.view === 'third') {
      this.applyThirdPerson(dt);
      return;
    }
    // Gentle head bob, lowest at each footfall. None with prefers-reduced-motion.
    const amp = this.reducedMotion() ? 0 : (this.speed > WALK_SPEED * 1.3 ? 0.055 : 0.03) * clamp(this.speed / WALK_SPEED, 0, 1);
    const bob = amp * Math.abs(Math.sin(Math.PI * this.phase));
    this.camera.position.set(this.x, this.eyeY + bob, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /**
   * Camera on a "spring arm" behind the head: it looks where the mouse points, and the arm
   * shortens at once when something gets in the way, then eases back out.
   */
  private applyThirdPerson(dt: number): void {
    const headY = this.eyeY - EYE_HEIGHT + HEAD;
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;
    const free = this.colliders.cameraDistance(this.x, headY, this.z, -fx, -fy, -fz, ARM);
    const want = Math.max(0.3, free - 0.25);
    if (want < this.arm || dt === 0) this.arm = want;
    else this.arm += (want - this.arm) * damp(3, dt);
    const cx = this.x - fx * this.arm;
    const cz = this.z - fz * this.arm;
    // Never under the sea surface (waves would cut through the picture).
    const cy = Math.max(headY - fy * this.arm, this.colliders.waterClearance(cx, cz));
    this.camera.position.set(cx, cy, cz);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
