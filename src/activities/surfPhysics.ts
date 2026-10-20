import { clamp, damp } from '../core/math';
import { SURF, surfDifficulty, type SurfSample } from '../water/surf';
import type { KayakEnv, WaterSample } from './kayakPhysics';

/**
 * Surfboard physics, arcade style (no physics engine): a 2D body (position, heading, velocity)
 * on the sea surface.
 *
 * - Gravity slides the board down the local slope of the water (the wave's face).
 * - The water itself moves with the wave (forward under the crest, back under the trough, a
 *   rush of white water behind a broken crest): the board is dragged toward that motion. Lying
 *   on the board and paddling as fast as the crest arrives, the face lifts the tail and the
 *   board starts to slide with it: that is "catching" the wave.
 * - The fin: sideways drag is much larger than drag along the board, so standing up the board
 *   goes where it points, and turning (A/D) carves the velocity round.
 * - Carving leans the rider into the turn (tan lean = v·ω / g); past ~57° the rail lets go:
 *   wipe out.
 *
 * Frame: local −Z is the nose, +X right; `yaw` like Object3D.rotation.y, forward in the world
 * is (−sin yaw, −cos yaw).
 */

/** 7'0" funboard (m): length, half width, the deck's height above the waterline when floating. */
export const BOARD = { length: 2.13, halfWidth: 0.27, deckY: 0.045 } as const;

/**
 * idle: nobody on it. prone: lying, paddling. catch: Space was pressed as a wave came, the board
 * turns, paddles and gets picked up by itself. ride: standing. wiped: fell off (a moment in the
 * white water, then lying on the board again).
 */
export type SurfState = 'idle' | 'prone' | 'catch' | 'ride' | 'wiped';

export interface SurfControls {
  /** W: paddle (lying) / pump down the face (standing). */
  forward: boolean;
  /** S: drag a hand / stall (lets the wave catch up). */
  back: boolean;
  /** A / D: +1 left … −1 right. */
  steer: number;
  /** Shift: a hard carve (turns more, leans more); lying: paddle hard (faster). */
  hard: boolean;
}

/** The board's world: the sea (with the surf), the surf terms at a point, terrain, obstacles. */
export interface SurfEnv extends KayakEnv {
  surf(x: number, z: number, out: SurfSample): SurfSample;
  /** Unit direction the waves travel (toward the beach). */
  readonly ux: number;
  readonly uz: number;
  /** The "Sóng biển" slider (0..1): bigger waves, less help (see surfDifficulty). */
  level(): number;
}

/** What happened this step (the activity turns it into a message, a splash, a mode change). */
export type SurfEvent = 'none' | 'wipeout' | 'remount' | 'stand' | 'missed' | 'waveGone' | 'beach';

/** What Space did: started catching the wave, or why not (no wave here, still far, gone by). */
export type PopUp = 'catching' | 'noWave' | 'early' | 'late';

const G = 9.81;
/** Gravity along the slope: lying (half under water), standing (planing). */
const SLIDE = { prone: 3.5, ride: 10.5 } as const;
/** Drag along the board (linear, quadratic) and sideways (the fin). */
const DRAG = {
  prone: { along: [0.5, 0.25], side: [2.0, 0.5] },
  ride: { along: [0.05, 0.015], side: [5.0, 1.5] },
} as const;
/** Arm paddling: push (m/s²) and the speed it can't go past (paddling hard, with Shift). */
const PADDLE = { accel: 1.9, top: 2.5, sprint: 3.6 } as const;
/** Seconds past the lean the rail holds (surfDifficulty) before the wipeout (a quick snap is fine). */
const LEAN_GRACE = 0.25;
/**
 * Riding help (scaled by the level's `assist`): the board is drawn to the sweet spot of the face
 * (just ahead of the crest, in wavelengths) and to the wave's speed toward the beach, so it
 * takes real effort to fall off the wave; A/D still carve freely along it.
 */
const FACE = { spot: 0.05, pull: 12, match: 0.8, max: 4 } as const;
/** v·ω (m/s²) of a normal and a hard carve. */
const TURN = 6.5;
const HARD_TURN = 15;
/** How much of the board's turn the velocity follows at once (the rest is left to the fin's drag). */
const CARVE_GRIP = 0.9;
/** Water this shallow (m): the board touches the sand. */
const BEACH_DEPTH = 0.4;
/**
 * Catching (Space): the window, in wavelengths from the crest (the face arrives from d = 0.5 down
 * to 0): a crest up to ~13 m behind, or just past. The board heads this far (rad) off straight in,
 * toward the shoulder that breaks last (+l), waits, is grabbed by the face from `grab` on and
 * stands up at `stand`.
 */
const CATCH = { from: 0.32, to: -0.06, angle: 0.6, grab: 0.14, stand: 0.08, timeout: 8, assist: 1.2 } as const;
/** Seconds in the white water after a wipeout before lying on the board again. */
const WIPE_TIME = 1.2;

export class SurfBody {
  x = 0;
  z = 0;
  /** Board waterline height. */
  y = 0;
  vx = 0;
  vz = 0;
  yaw = 0;
  /** Yaw rate (rad/s). */
  w = 0;
  pitch = 0;
  roll = 0;
  /** The rider's lean into the turn (rad), and how long it has been too much. */
  lean = 0;
  private over = 0;
  state: SurfState = 'idle';
  /** Arm strokes done (lying, for the avatar) and how hard it paddles (0..1). */
  stroke = 0;
  paddling = 0;
  /** Standing on a wave that's gone (seconds): the ride ends. */
  private lost = 0;
  /** Seconds in the current catch / wipeout, and since the wave grabbed the board. */
  private timer = 0;
  private grabbed = 0;
  readonly water: WaterSample = { height: 0, dhdx: 0, dhdz: 0 };
  readonly wave: SurfSample = { height: 0, dhdx: 0, dhdz: 0, push: 0, broken: 0, d: 0, size: 0, x: 0, l: 0 };
  private readonly tmp = { x: 0, z: 0 };

  constructor(private readonly env: SurfEnv) {}

  place(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = this.w = 0;
    this.lean = 0;
    this.over = 0;
    this.lost = 0;
    this.sample();
    this.y = Math.max(this.water.height, this.env.ground(x, z));
  }

  /** Speed along the nose (m/s). */
  get speed(): number {
    return -this.vx * Math.sin(this.yaw) - this.vz * Math.cos(this.yaw);
  }

  /** Water depth under the board. */
  get depth(): number {
    return this.water.height - this.env.ground(this.x, this.z);
  }

  private sample(): void {
    this.env.water(this.x, this.z, this.water);
    this.env.surf(this.x, this.z, this.wave);
  }

  /**
   * Space while lying, as a wave comes: catch it. The board then turns for the beach, paddles
   * and is picked up by the face, and the rider stands up by himself (see `catching`).
   */
  popUp(): PopUp {
    if (this.state === 'catch') return 'catching';
    if (this.state !== 'prone') return 'noWave';
    const s = this.wave;
    if (s.size < 0.25 || s.x > SURF.closeOut) return 'noWave';
    // The crest comes from behind: first its face reaches the board (d falls from 0.5 to 0),
    // then the crest passes under it (d < 0).
    if (s.d > CATCH.from) return 'early';
    if (s.d < CATCH.to) return 'late';
    this.state = 'catch';
    this.timer = 0;
    this.grabbed = 0;
    return 'catching';
  }

  /** The heading of the ride line: toward the beach, angled to the shoulder that breaks last. */
  rideYaw(): number {
    const c = Math.cos(CATCH.angle);
    const sn = Math.sin(CATCH.angle);
    // u toward the beach, +l = (−uz, ux) along it.
    const dx = this.env.ux * c - this.env.uz * sn;
    const dz = this.env.uz * c + this.env.ux * sn;
    // Forward is (−sin yaw, −cos yaw).
    return Math.atan2(-dx, -dz);
  }

  /**
   * One frame. `ctl` null: nobody on the board (it drifts with the waves and washes up on the
   * beach). Sub-stepped for stability.
   */
  step(dt: number, ctl: SurfControls | null): SurfEvent {
    let ev: SurfEvent = 'none';
    if (this.state === 'wiped') {
      // Tumbling in the white water (the board drifts), then back on it, lying.
      this.timer += dt;
      ctl = null;
      if (this.timer > WIPE_TIME) {
        this.state = 'prone';
        this.vx *= 0.3;
        this.vz *= 0.3;
        ev = 'remount';
      }
    }
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n && ev === 'none'; i++) ev = this.substep(h, ctl);
    this.attitude(dt);
    return ev;
  }

  private substep(dt: number, ctl: SurfControls | null): SurfEvent {
    this.sample();
    const ride = this.state === 'ride';
    const s = this.wave;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // Forward (nose) and right in the world.
    const fx = -sy;
    const fz = -cy;
    const rx = cy;
    const rz = -sy;
    // The water's own motion: the wave's orbit, plus the rush of white water behind a broken crest.
    let push = s.push;
    if (s.d < 0) push += SURF.speed * 0.7 * s.broken;
    // Paddling out (lying, nose to the open sea) you push the board under the oncoming waves (a
    // duck dive): they hold you back much less.
    if (this.state === 'prone') push *= 1 - 0.75 * clamp(-(fx * this.env.ux + fz * this.env.uz), 0, 1);
    const wx = this.env.ux * push;
    const wz = this.env.uz * push;
    const relX = this.vx - wx;
    const relZ = this.vz - wz;
    const along = relX * fx + relZ * fz;
    const side = relX * rx + relZ * rz;
    const d = ride ? DRAG.ride : DRAG.prone;
    let fa = d.along[0] * along + d.along[1] * along * Math.abs(along);
    const fs = d.side[0] * side + d.side[1] * side * Math.abs(side);
    // Gravity down the slope of the water.
    const slide = ride ? SLIDE.ride : SLIDE.prone;
    let ax = -slide * this.water.dhdx;
    let az = -slide * this.water.dhdz;

    let steer = 0;
    if (ctl && this.state === 'catch') {
      // Turning for the ride line and paddling hard; as the face comes under the board, the wave
      // grabs it (pulled up to the wave's speed toward the beach).
      this.timer += dt;
      const turn = Math.atan2(Math.sin(this.rideYaw() - this.yaw), Math.cos(this.rideYaw() - this.yaw));
      steer = clamp(turn * 4, -2.5, 2.5);
      // Wait for it (the board turned, a few easy strokes), then paddle hard as it gets close:
      // paddling early would just run away from the wave.
      const close = s.d < CATCH.grab ? 1 : 0.15;
      this.paddling += (close - this.paddling) * damp(6, dt);
      this.stroke += dt * (0.4 + 1.1 * this.paddling);
      const v = this.speed;
      const a = PADDLE.accel * 1.4 * close * clamp(1 - v / PADDLE.top, 0, 1);
      ax += fx * a;
      az += fz * a;
      if (s.d < CATCH.grab && s.d > CATCH.to) {
        const toBeach = this.vx * this.env.ux + this.vz * this.env.uz;
        const grab = 6 * Math.max(0, SURF.speed * 1.1 - toBeach) * s.size;
        this.grabbed += dt;
        ax += this.env.ux * grab;
        az += this.env.uz * grab;
      }
    } else if (ctl && this.state === 'prone') {
      // Arm paddling, alternating strokes; a hand in the water brakes.
      const v = this.speed;
      this.paddling += ((ctl.forward ? 1 : Math.abs(ctl.steer) * 0.5) - this.paddling) * damp(4, dt);
      if (ctl.forward) {
        const top = ctl.hard ? PADDLE.sprint : PADDLE.top;
        const a = PADDLE.accel * (ctl.hard ? 1.5 : 1) * clamp(1 - v / top, 0, 1);
        ax += fx * a;
        az += fz * a;
      }
      if (ctl.back) fa += 1.2 * along;
      this.stroke += dt * (0.4 + 1.1 * this.paddling);
      steer = ctl.steer * 1.4;
    } else if (ctl && ride) {
      // Just stood up: the wave carries the board on for a moment (the drop in), whatever the
      // rider does, so the ride always starts.
      this.timer += dt;
      if (this.timer < CATCH.assist && s.size > 0.2) {
        const toBeach = this.vx * this.env.ux + this.vz * this.env.uz;
        const grab = 4 * Math.max(0, SURF.speed * 1.15 - toBeach);
        ax += this.env.ux * grab;
        az += this.env.uz * grab;
      }
      // Held on the face (more on small waves, see FACE).
      const help = surfDifficulty(this.env.level()).assist;
      if (s.size > 0.2 && s.d > -0.25 && s.d < 0.4) {
        const toBeach = this.vx * this.env.ux + this.vz * this.env.uz;
        const a = clamp(help * (FACE.pull * (FACE.spot - s.d) + FACE.match * (SURF.speed - toBeach)), -FACE.max, FACE.max);
        ax += this.env.ux * a;
        az += this.env.uz * a;
      }
      // Pump down the face (a little speed); stall (drag the tail) to let the wave catch up.
      if (ctl.forward) {
        ax += fx * 0.9;
        az += fz * 0.9;
      }
      if (ctl.back) fa += 0.5 * along;
      // Turn rate for a given lean (tan lean = v·ω / g): a normal carve leans ~33°, a hard one
      // (Shift) ~57°, past what the rail holds if kept up; slow, both just turn tightly.
      const v = Math.max(1, Math.abs(this.speed));
      steer = ctl.steer * (ctl.hard ? Math.min(3.0, HARD_TURN / v) : Math.min(1.7, TURN / v));
      this.paddling += (0 - this.paddling) * damp(6, dt);
    } else {
      this.paddling = 0;
    }
    ax -= fx * fa + rx * fs;
    az -= fz * fa + rz * fs;
    // Open water far out pushes back toward the island (like the kayak).
    const r = Math.hypot(this.x, this.z);
    if (r > 280) {
      ax -= (this.x / r) * 0.8;
      az -= (this.z / r) * 0.8;
    }
    this.vx += ax * dt;
    this.vz += az * dt;
    this.w += (steer - this.w) * damp(ride ? 7 : 5, dt);
    if (!ctl) this.w *= 1 - damp(2, dt);
    this.yaw += this.w * dt;
    if (ride) {
      // The fin's lift turns the velocity with the board (a carve keeps its speed), instead of
      // the sideways drag just eating it.
      const a = this.w * dt * CARVE_GRIP;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const vx = this.vx;
      this.vx = vx * c + this.vz * sn;
      this.vz = -vx * sn + this.vz * c;
    }

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    // Sand under the board: it stops; rocks push it away.
    const ground = this.env.ground(nx, nz);
    if (this.water.height - ground < 0.12) {
      this.vx *= 1 - damp(6, dt);
      this.vz *= 1 - damp(6, dt);
      this.w *= 1 - damp(6, dt);
      nx = this.x + this.vx * dt;
      nz = this.z + this.vz * dt;
    }
    this.env.block(nx, nz, this.y, 0.45, this.tmp);
    if (this.tmp.x !== nx || this.tmp.z !== nz) {
      // Bumped: lose the speed into the obstacle.
      this.vx = (this.tmp.x - this.x) / dt;
      this.vz = (this.tmp.z - this.z) / dt;
    }
    this.x = this.tmp.x;
    this.z = this.tmp.z;

    if (!ctl) return 'none';
    if (this.state === 'catch') {
      // Up once the wave has carried the board for a moment (or it is right at the crest).
      if ((this.grabbed > 0.6 || s.d < CATCH.stand) && s.d > CATCH.to && s.size > 0.2) {
        // Up! Moving with the wave at least as fast as it goes.
        const toBeach = this.vx * this.env.ux + this.vz * this.env.uz;
        const add = Math.max(0, SURF.speed * 1.1 - toBeach);
        this.vx += this.env.ux * add;
        this.vz += this.env.uz * add;
        this.state = 'ride';
        this.lost = 0;
        this.timer = 0;
        return 'stand';
      }
      if (s.d < CATCH.to - 0.04 || s.size < 0.15 || this.timer > CATCH.timeout) {
        this.state = 'prone';
        return 'missed';
      }
    }
    if (this.depth < BEACH_DEPTH) {
      // Reported once: the rider steps off, the board lies there.
      this.state = 'idle';
      return 'beach';
    }
    if (!ride) return 'none';
    // Leaning into the carve; too far and the rail lets go.
    const target = Math.atan2(this.speed * this.w, G);
    this.lean += (target - this.lean) * damp(10, dt);
    const diff = surfDifficulty(this.env.level());
    this.over = Math.abs(this.lean) > diff.maxLean ? this.over + dt : 0;
    if (this.over > LEAN_GRACE) return this.wipe();
    // Under the falling lip of a big breaking wave (not the close-out at the beach: that one just
    // washes you in).
    if (diff.lipWipe && s.broken > 0.8 && s.d > -0.02 && s.d < 0.09 && s.x < SURF.closeOut - 6) return this.wipe();
    // The wave has passed (or died): the ride is over.
    const gone = s.size < 0.08 || s.d < -0.15 || s.broken > 0.85;
    this.lost = gone && Math.abs(this.speed) < 3 ? this.lost + dt : gone ? this.lost + dt * 0.3 : 0;
    if (this.lost > 0.8) {
      this.state = 'prone';
      this.lean = 0;
      return 'waveGone';
    }
    return 'none';
  }

  private wipe(): SurfEvent {
    this.state = 'wiped';
    this.timer = 0;
    this.lean = 0;
    this.over = 0;
    return 'wipeout';
  }

  /** Height, pitch and roll from the water under the board (and the rider's lean), smoothed. */
  private attitude(dt: number): void {
    this.sample();
    const ground = this.env.ground(this.x, this.z);
    const y = Math.max(this.water.height, ground + 0.04);
    this.y += (y - this.y) * damp(12, dt);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // Slope along the nose and to the right.
    const sf = -this.water.dhdx * sy - this.water.dhdz * cy;
    const sr = this.water.dhdx * cy - this.water.dhdz * sy;
    const pitch = Math.atan(sf);
    const roll = Math.atan(sr) + (this.state === 'ride' ? this.lean * 0.55 : 0);
    this.pitch += (pitch - this.pitch) * damp(8, dt);
    this.roll += (roll - this.roll) * damp(8, dt);
  }

  /** Board-local point → world (x, z). */
  toWorld(lx: number, lz: number, out: { x: number; z: number }): { x: number; z: number } {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    out.x = this.x + lx * c + lz * s;
    out.z = this.z - lx * s + lz * c;
    return out;
  }
}
