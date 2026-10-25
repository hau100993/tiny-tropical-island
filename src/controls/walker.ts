import * as THREE from 'three';
import type { Support } from './collision';
import type { IslandColliders, Shelter, WalkSurface } from './islandColliders';
import { clamp, damp } from '../core/math';
import { KNOCK, knockLevel } from '../core/knock';
import { RUN_GAIT_MIN, stepLength } from '../core/gait';
import { isTyping } from './keymap';
import { DragLook } from './dragLook';

/** Eye height above the feet (m). */
export const EYE_HEIGHT = 1.65;
const RADIUS = 0.3;
const WALK_SPEED = 1.6;
const RUN_SPEED = 4.0;
/** Water depth (m) where wading is slowest; deeper than SWIM_IN you swim. */
export const MAX_WADE = 0.9;
/** Swim from this depth (chest deep) and stand up again below SWIM_OUT (hysteresis). */
const SWIM_IN = 1.2;
const SWIM_OUT = 1.0;
/** Swimming speeds (m/s): breaststroke, front crawl (Shift). */
const SWIM_SPEED = { breast: 0.75, crawl: 1.5 } as const;
/** Arm cycles per second at full speed: breaststroke, front crawl (both arms). */
const SWIM_RATE = { breast: 0.67, crawl: 0.85 } as const;
/** Open water past this radius (m) slowly brings a swimmer back toward the island. */
const SEA_LIMIT = 260;
/** One breath lasts this long under water (s, swimming calmly); refills in BREATH_REFILL s. */
const BREATH_SECONDS = 45;
const BREATH_REFILL = 4;
/** Underwater speeds (m/s): calm, fast (Shift); rising with Space. */
const DIVE_SPEED = { calm: 0.8, fast: 1.4, up: 0.9 } as const;
/** Deepest you can go (m below the surface): a free diver's comfortable limit. */
const MAX_DIVE = 14;
/** Radians per pixel of mouse movement. */
const LOOK_SPEED = 0.0022;
/** Knocked over (Mochi's bark): how long until you are up again (s). */
const KNOCK_TIME = KNOCK.fall + KNOCK.lie + KNOCK.rise;
/**
 * Look up/down limits per view. Third person looking up: the camera arm drops behind the head
 * and shortens against the ground (cameraDistance), so the sky fills the view.
 */
const PITCH = { first: [-1.45, 1.45], third: [-1.2, 0.8] } as const;
/** Third person: camera distance behind the pivot, and pivot height above the feet (chest). */
const ARM = 4.2;
const HEAD = 1.4;
/**
 * Mouse wheel (walking or standing, as in the overview): the arm from `min` to `max` m, × `step`
 * per notch. In past `min` you see through the eyes; out from there, behind you again.
 */
const ZOOM = { min: 1.6, max: 18, step: 1.18 } as const;
/** Wheel delta (px) of one notch (trackpads send many small ones). */
const NOTCH_PX = 100;

export type WalkView = 'first' | 'third';

/** One arm entering the water (crawl: each arm; breaststroke: the kick). */
export interface SwimStroke {
  kind: 'breast' | 'crawl';
  /** −1 left arm, 1 right arm (0 for both, breaststroke). */
  side: -1 | 0 | 1;
  /** 0.3 (treading, slow) … 1 (full speed). */
  strength: number;
}

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
  /** Started swimming (deep water) or stood up again. */
  onSwim(swimming: boolean): void;
  /** A swim stroke (splash). */
  onStroke(e: SwimStroke): void;
  /** Went under (a dive) or came back up to the surface. */
  onDive(under: boolean): void;
  /** The wheel asks for the other view (in past the nearest: through the eyes; out: behind). */
  onView(view: WalkView): void;
}

/** The keys that move you: held, the mouse steers (DragLook). */
const STEER_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const MOVE_KEYS = new Set([
  'Space',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight',
]);

/**
 * Walking on the island: the mouse steers while you move, drag it to look while standing (the
 * cursor is never captured), WASD/arrows, Shift to run. Movement follows
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
  /** Current step length (m): shorter when walking slowly, 0 standing still. */
  stride = 0;
  /** Third person: current camera distance (shorter when something is in the way), and the one the wheel chose. */
  arm = ARM;
  armWant = ARM;
  /** In deep water: swimming instead of walking (feetY is then the seabed below). */
  swimming = false;
  /** Sea surface (with the waves) where the swimmer is. */
  surfaceY = 0;
  /** Swim cycles done (fraction = position in the arm cycle). */
  swimPhase = 0;
  /** 0 breaststroke … 1 front crawl (eased), and 0 treading water … 1 swimming (eased). */
  crawl = 0;
  swimMove = 0;
  /** Under water (a breath-hold dive): the head is at bodyY, moving in 3D. */
  diving = false;
  bodyY = 0;
  vy = 0;
  /** 1 full lungs … 0 out of breath (then you float up whatever you press). */
  breath = 1;
  /** Seconds since you were knocked over (−1: on your feet); see KNOCK. */
  knockT = -1;
  private knockDX = 0;
  private knockDZ = 0;
  /** The sea surface height at (x, z); without it the sea is flat at 0. */
  private sea: ((x: number, z: number) => number) | null = null;
  private placed = false;
  private eyeY = 0;
  readonly vel = new THREE.Vector2();
  private readonly keys = new Set<string>();
  /** Mouse look: drag on the scene (see DragLook). */
  readonly look: DragLook;
  private readonly tmp = { x: 0, z: 0 };
  private readonly sup: Support<WalkSurface> = { y: 0, surface: 'sand', onPlatform: false };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private readonly colliders: IslandColliders,
    private readonly events: WalkerEvents,
    private readonly reducedMotion: () => boolean,
  ) {
    window.addEventListener('keydown', (e) => {
      if (!this.active || !MOVE_KEYS.has(e.code) || e.ctrlKey || e.altKey || e.metaKey) return;
      // The cursor is free: typing in the panel isn't walking.
      if (isTyping(e.target)) return;
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // The wheel over the scene: the camera arm in and out (see ZOOM).
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        const px = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * NOTCH_PX;
        this.zoom(px / NOTCH_PX);
      },
      { passive: false },
    );
    this.look = new DragLook(
      dom,
      (dx, dy) => {
        this.yaw -= dx * LOOK_SPEED;
        const [lo, hi] = PITCH[this.view];
        this.pitch = clamp(this.pitch - dy * LOOK_SPEED, lo, hi);
      },
      LOOK_SPEED,
    );
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
    this.keys.clear();
    this.vel.set(0, 0);
    this.eyeY = this.feetY + EYE_HEIGHT;
    this.arm = this.armWant;
    this.setView(this.view);
    this.camera.rotation.order = 'YXZ';
    this.applyCamera(0);
    this.look.start();
  }

  /** Puts the walker at (x, z) facing `yaw` (e.g. next to the chair after getting up). */
  placeAt(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = -0.1;
    if (this.colliders.world.supportAt(x, z, 1000, this.sup)) this.feetY = this.sup.y;
    this.placed = true;
  }

  /** `notches` of the wheel (> 0: out). */
  zoom(notches: number): void {
    if (notches === 0) return;
    if (this.view === 'first') {
      // Out from the eyes: behind you, close.
      if (notches > 0) {
        this.armWant = ZOOM.min;
        this.events.onView('third');
      }
      return;
    }
    const next = this.armWant * Math.pow(ZOOM.step, notches);
    if (next < ZOOM.min * 0.92) {
      this.events.onView('first');
      return;
    }
    this.armWant = Math.min(ZOOM.max, Math.max(ZOOM.min, next));
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
    this.look.stop();
  }

  /**
   * Knocked over by a blast from (fromX, fromZ): you fall on your back away from it, facing it,
   * lie there a moment and get up; no walking meanwhile. Only on your feet on land.
   */
  knockDown(fromX: number, fromZ: number): boolean {
    if (!this.active || this.swimming || this.knockT >= 0) return false;
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.knockDX = dx / d;
    this.knockDZ = dz / d;
    this.knockT = 0;
    this.vel.set(0, 0);
    return true;
  }

  /** While knocked over: the way to face (toward what knocked you over; the avatar's yaw). */
  get knockYaw(): number {
    return Math.atan2(this.knockDX, this.knockDZ);
  }

  /** 0 on your feet … 1 lying flat (eased), for the camera and the body. */
  get down(): number {
    return knockLevel(this.knockT);
  }

  /** The knock-down's clock and the push back while falling; true while you are down. */
  private knocked(dt: number): boolean {
    if (this.knockT < 0) return false;
    this.knockT += dt;
    if (this.knockT < KNOCK.fall) {
      // Pushed back hardest at first (the shove), the slide dying away as you land.
      const s = ((2 * KNOCK.push) / KNOCK.fall) * (1 - this.knockT / KNOCK.fall) * dt;
      this.tryMove(this.x + this.knockDX * s, this.z + this.knockDZ * s);
    }
    if (this.knockT >= KNOCK_TIME) {
      this.knockT = -1;
      return false;
    }
    return true;
  }

  /** A key that moves you is held (Shift alone doesn't). */
  private steering(): boolean {
    for (const k of this.keys) if (STEER_KEYS.has(k)) return true;
    return false;
  }

  setSea(fn: (x: number, z: number) => number): void {
    this.sea = fn;
  }

  update(dt: number): void {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    // Moving: the mouse steers (DragLook). Not while knocked over.
    this.look.update(dt, this.steering() && this.knockT < 0);
    if (this.swimming) {
      if (this.diving) this.dive(dt);
      else this.swim(dt);
      return;
    }
    this.breath = Math.min(1, this.breath + dt / BREATH_REFILL);
    const k = this.keys;
    const stunned = this.knocked(dt);
    const fwd = stunned ? 0 : (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = stunned ? 0 : (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
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
    if (!this.sup.onPlatform && this.depth > SWIM_IN) {
      // Chest deep: off your feet, swimming.
      this.swimming = true;
      this.swimMove = clamp(this.speed / SWIM_SPEED.breast, 0, 1);
      this.surfaceY = this.seaAt(this.x, this.z);
      this.events.onSwim(true);
    }

    // A footfall every step: shorter, slower steps when walking slowly, longer when running.
    // The avatar scales its stride to the same length (its planted feet would otherwise drag).
    const runGait = run && this.speed > RUN_GAIT_MIN;
    this.stride = stepLength(this.speed, runGait ? RUN_SPEED : WALK_SPEED, runGait);
    const before = Math.floor(this.phase);
    if (this.stride > 0.01) this.phase += moved / this.stride;
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
    this.x = this.tmp.x;
    this.z = this.tmp.z;
    this.feetY = this.sup.y;
    return true;
  }

  private seaAt(x: number, z: number): number {
    return this.sea ? this.sea(x, z) : 0;
  }

  /**
   * Swimming: the same keys as walking, slower to speed up and to stop (you glide), Shift for
   * the front crawl. The body floats on the waves; back in water shallower than SWIM_OUT you
   * stand up and walk out.
   */
  private swim(dt: number): void {
    const k = this.keys;
    this.breath = Math.min(1, this.breath + dt / BREATH_REFILL);
    // Duck dive: Space where the water is deep enough.
    if (k.has('Space') && this.depth > 1.8 && this.breath > 0.15) {
      this.diving = true;
      this.bodyY = this.surfaceY - 0.15;
      this.vy = -1.1;
      this.events.onDive(true);
      this.dive(dt);
      return;
    }
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const crawl = k.has('ShiftLeft') || k.has('ShiftRight');
    this.running = crawl;
    this.crawl += ((crawl ? 1 : 0) - this.crawl) * damp(3, dt);
    const max = SWIM_SPEED.breast + (SWIM_SPEED.crawl - SWIM_SPEED.breast) * this.crawl;
    const len = Math.hypot(fwd, side);
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const tx = len > 0 ? ((-s * fwd + c * side) / len) * max : 0;
    const tz = len > 0 ? ((-c * fwd - s * side) / len) * max : 0;
    // Water: you build up speed over a stroke or two, and glide on when you stop.
    const a = damp(len > 0 ? 1.6 : 0.9, dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.y += (tz - this.vel.y) * a;
    // Far out at sea a gentle current takes you back.
    const r = Math.hypot(this.x, this.z);
    if (r > SEA_LIMIT) {
      this.vel.x -= (this.x / r) * (r - SEA_LIMIT) * 0.5 * dt;
      this.vel.y -= (this.z / r) * (r - SEA_LIMIT) * 0.5 * dt;
    }
    const x0 = this.x;
    const z0 = this.z;
    // Rocks and stilts still block; the body floats near the surface.
    this.colliders.world.resolve(this.x + this.vel.x * dt, this.z + this.vel.y * dt, this.surfaceY - 1.4, RADIUS, this.tmp);
    this.x = this.tmp.x;
    this.z = this.tmp.z;
    this.speed = Math.hypot(this.x - x0, this.z - z0) / dt;
    this.swimMove += (clamp(this.speed / SWIM_SPEED.breast, 0, 1) - this.swimMove) * damp(3, dt);

    const sea = this.seaAt(this.x, this.z);
    this.surfaceY += (sea - this.surfaceY) * damp(5, dt);
    if (this.colliders.world.supportAt(this.x, this.z, this.surfaceY, this.sup)) {
      this.feetY = this.sup.y;
      this.surface = this.sup.surface;
      this.depth = Math.max(0, -this.sup.y);
    }
    this.shelter = 'none';

    // Arm cycles: faster at full speed, a slow sculling rhythm when treading water.
    const rate = SWIM_RATE.breast + (SWIM_RATE.crawl - SWIM_RATE.breast) * this.crawl;
    const before = this.swimPhase;
    this.swimPhase += dt * rate * (0.55 + 0.45 * this.swimMove);
    const strength = clamp(0.3 + 0.7 * this.swimMove, 0.3, 1);
    if (this.swimMove > 0.25) {
      const crossed = (at: number): boolean => Math.floor(before - at) !== Math.floor(this.swimPhase - at);
      if (this.crawl > 0.5) {
        // Each hand enters the water at the start of its pull.
        if (crossed(0)) this.events.onStroke({ kind: 'crawl', side: -1, strength });
        if (crossed(0.5)) this.events.onStroke({ kind: 'crawl', side: 1, strength });
      } else if (crossed(0.5)) {
        this.events.onStroke({ kind: 'breast', side: 0, strength });
      }
    }
    if (this.depth < SWIM_OUT) {
      // Feet on the bottom again: stand up.
      this.swimming = false;
      this.running = false;
      this.events.onSwim(false);
    }
    this.applyCamera(dt);
  }

  /**
   * Under water: W/S swim where you look (look down to go deeper), A/D sideways, Space rises,
   * Shift is faster. Slightly buoyant: you drift up slowly when still. The breath runs down
   * (faster when swimming hard); out of breath you float up to the surface on your own.
   */
  private dive(dt: number): void {
    const k = this.keys;
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    this.running = fast;
    this.crawl += ((fast ? 1 : 0) - this.crawl) * damp(3, dt);
    this.breath = Math.max(0, this.breath - (dt / BREATH_SECONDS) * (fast ? 1.4 : 1));
    const out = this.breath <= 0;
    const fwd = out ? 0 : (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = out ? 0 : (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const up = out || k.has('Space') ? 1 : 0;
    const max = fast ? DIVE_SPEED.fast : DIVE_SPEED.calm;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    // Forward where the eyes look, sideways level.
    let tx = (-s * cp * fwd + c * side) * max;
    let ty = sp * fwd * max + up * (out ? 1.2 : DIVE_SPEED.up);
    let tz = (-c * cp * fwd - s * side) * max;
    const len = Math.hypot(tx, ty, tz);
    const cap = Math.max(max, up ? DIVE_SPEED.up : 0) * (out ? 1.3 : 1);
    if (len > cap) {
      tx *= cap / len;
      ty *= cap / len;
      tz *= cap / len;
    }
    // A little buoyancy near the surface (lungs full of air).
    if (fwd === 0 && side === 0 && !up) ty += 0.08;
    const a = damp(fwd !== 0 || side !== 0 || up ? 1.8 : 0.8, dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.y += (tz - this.vel.y) * a;
    this.vy += (ty - this.vy) * a;
    const x0 = this.x;
    const z0 = this.z;
    const y0 = this.bodyY;
    this.colliders.world.resolve(this.x + this.vel.x * dt, this.z + this.vel.y * dt, this.bodyY - 1, RADIUS, this.tmp);
    this.x = this.tmp.x;
    this.z = this.tmp.z;
    this.bodyY += this.vy * dt;
    const sea = this.seaAt(this.x, this.z);
    this.surfaceY += (sea - this.surfaceY) * damp(5, dt);
    if (this.colliders.world.supportAt(this.x, this.z, this.bodyY, this.sup)) {
      this.feetY = this.sup.y;
      this.surface = this.sup.surface;
      this.depth = Math.max(0, -this.sup.y);
    }
    // The seabed below, the depth limit above it.
    const floor = Math.max(this.feetY + 0.35, this.surfaceY - MAX_DIVE);
    if (this.bodyY < floor) {
      this.bodyY = floor;
      if (this.vy < 0) this.vy = 0;
    }
    this.speed = Math.hypot(this.x - x0, this.z - z0, this.bodyY - y0) / dt;
    this.swimMove += (clamp(this.speed / DIVE_SPEED.calm, 0, 1) - this.swimMove) * damp(3, dt);
    const rate = SWIM_RATE.breast + (SWIM_RATE.crawl - SWIM_RATE.breast) * this.crawl;
    this.swimPhase += dt * rate * (0.5 + 0.5 * this.swimMove);
    this.shelter = 'none';
    // Back at the surface (or the water got too shallow to stay under): swimming again.
    if ((this.bodyY > this.surfaceY - 0.2 && this.vy >= 0) || this.feetY > this.surfaceY - 0.9) {
      this.diving = false;
      this.vy = 0;
      this.events.onDive(false);
    }
    this.applyCamera(dt);
  }

  private applyCamera(dt: number): void {
    if (this.swimming) {
      this.applySwimCamera(dt);
      return;
    }
    // Knocked over: the eyes come down to the ground (lying on your back, looking up). From
    // behind, the camera only comes down part of the way (at the ground its arm would shrink to
    // nothing against it and the body would hide).
    const down = this.down;
    const target = this.feetY + EYE_HEIGHT - (this.view === 'first' ? EYE_HEIGHT - 0.3 : 0.8) * down;
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
    this.camera.rotation.set(Math.min(1.5, this.pitch + 1.2 * down), this.yaw, 0.25 * down, 'YXZ');
  }

  /** Swimming: eyes just above the surface (riding the waves), or the arm behind the head. */
  private applySwimCamera(dt: number): void {
    const target = this.diving ? this.bodyY : this.surfaceY + 0.2;
    if (dt === 0 || Math.abs(target - this.eyeY) > 3) this.eyeY = target;
    else this.eyeY += (target - this.eyeY) * damp(this.diving ? 14 : 8, dt);
    if (this.view === 'first') {
      // At the surface the eyes stay just above the water; under it, wherever the head is.
      this.camera.position.set(this.x, this.diving ? this.eyeY : Math.max(this.eyeY, this.surfaceY + 0.12), this.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      return;
    }
    const cp = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;
    const headY = this.eyeY + (this.diving ? 0.1 : 0.15);
    this.springArm(dt, headY, fx, fy, fz);
    const cx = this.x - fx * this.arm;
    const cz = this.z - fz * this.arm;
    // At the surface the camera stays above the water; diving, it stays under it.
    const cy = this.diving
      ? Math.min(headY - fy * this.arm, this.surfaceY - 0.25)
      : Math.max(headY - fy * this.arm, this.surfaceY + 0.45);
    this.camera.position.set(cx, cy, cz);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  /**
   * The arm's length this frame: as long as the wheel chose, but short of whatever is in the way
   * behind (at once when something gets in the way, easing back out after); the wheel's own
   * changes ease both ways.
   */
  private springArm(dt: number, headY: number, fx: number, fy: number, fz: number): void {
    const free = this.colliders.cameraDistance(this.x, headY, this.z, -fx, -fy, -fz, this.armWant);
    const blocked = free - 0.25 < this.armWant;
    const want = Math.max(0.3, Math.min(this.armWant, free - 0.25));
    if (dt === 0 || (blocked && want < this.arm)) this.arm = want;
    else this.arm += (want - this.arm) * damp(want < this.arm ? 8 : 3, dt);
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
    this.springArm(dt, headY, fx, fy, fz);
    const cx = this.x - fx * this.arm;
    const cz = this.z - fz * this.arm;
    // Never under the sea surface (waves would cut through the picture).
    const cy = Math.max(headY - fy * this.arm, this.colliders.waterClearance(cx, cz));
    this.camera.position.set(cx, cy, cz);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
