import { clamp, damp, smoothstep } from '../core/math';

/**
 * Kayak physics without a physics engine: a small 2D rigid body (position, heading, velocity,
 * yaw rate) pushed by the paddle blade and held back by the water, plus heave/pitch/roll from
 * the waves for the looks.
 *
 * The paddle is kinematic: its motion comes from stroke curves (catch → pull → exit). Every
 * frame the submerged part of the blade is moved through the water; the drag on it, applied
 * where the blade is, is what drives the boat. So a stroke pushes less when the boat already
 * moves fast (the blade slips less), a sweep far out turns more, and a reverse stroke brakes,
 * with no special cases.
 *
 * Frame: the boat's local −Z is forward (bow), +X is right (starboard), origin at the
 * waterline in the middle of the hull. `yaw` is a rotation around +Y like `Object3D.rotation.y`
 * (positive turns left), so forward in the world is (−sin yaw, −cos yaw).
 */

export interface WaterSample {
  height: number;
  dhdx: number;
  dhdz: number;
}

export interface KayakEnv {
  /** Sea surface (wave height and slope) at (x, z). */
  water(x: number, z: number, out: WaterSample): WaterSample;
  /** Terrain (seabed or beach) height at (x, z). */
  ground(x: number, z: number): number;
  /** Pushes a circle of radius `r` at (x, z) out of rocks, stilts and boats (writes `out`). */
  block(x: number, z: number, y: number, r: number, out: { x: number; z: number }): void;
}

/** Sit-on-top kayak, 3.8 m. */
export const HULL = {
  length: 3.8,
  halfBeam: 0.37,
  /** Keel depth below the waterline (m). */
  draft: 0.13,
  /** The seat (where the paddler's bottom rests), boat-local. */
  seatY: 0.07,
  seatZ: 0.25,
} as const;

/** 2.2 m paddle: half length, where the blade begins (fraction of the half), grip half width. */
export const PADDLE = { half: 1.1, bladeFrom: 0.62, grip: 0.38 } as const;

/** Boat + paddler (kg) and yaw inertia (kg·m²). */
const MASS = 110;
const INERTIA = 120;
/** Blade drag: ½ · ρ · Cd · area for a ~0.1 m² touring blade (Cd ≈ 1.4: a flat plate). */
const BLADE_K = 70;
/** A paddler can't pull harder than this (N). */
const MAX_BLADE_FORCE = 260;
/** Hull drag along the boat: linear + quadratic (≈ 25 N at 1.8 m/s, like a real sea kayak). */
const DRAG_LONG = [3, 6.5] as const;
/** Sideways drag per end: much larger (the keel effect: the boat goes where it points). */
const DRAG_SIDE = [20, 80] as const;
/** The stern grips the water a bit more than the bow, so the boat tracks straight. */
const BOW_GRIP = 0.9;
const STERN_GRIP = 1.3;
const END = 1.35;
/** Open water past this radius (m) slowly pushes the boat back toward the island. */
export const SEA_LIMIT = 280;

export type StrokeKind = 'forward' | 'reverse' | 'sweep';
export type Side = -1 | 1;

export interface PaddleControls {
  /** A stroke on the left / right side is wanted (key held, or tapped a moment ago). */
  left: boolean;
  right: boolean;
  /** W: alternate sides by itself. */
  cruise: boolean;
  /** S: reverse strokes. */
  back: boolean;
  /** Shift: sweep strokes. */
  sweep: boolean;
}

/**
 * Paddle pose in the boat's frame: shaft yaw ψ (0 = across the boat; positive swings the
 * right blade aft), tilt φ (positive = right blade down), center offset from the seat.
 */
export interface PaddlePose {
  psi: number;
  phi: number;
  cx: number;
  cy: number;
  cz: number;
}

/** Keyframe: t, ψ, φ, cx (all three mirrored by the side), cy, cz. */
type Key = readonly [number, number, number, number, number, number];

const STROKES: Record<StrokeKind, { dur: number; keys: readonly Key[] }> = {
  // Reach forward, plant the blade by the feet, pull it back to the hip turning the torso,
  // slice it out, swing the shaft over toward the other side.
  forward: {
    dur: 0.95,
    keys: [
      [0, -0.35, 0.3, 0.0, 0.5, -0.36],
      [0.18, -0.85, 0.72, 0.05, 0.45, -0.36],
      [0.62, 0.45, 0.72, 0.08, 0.44, -0.24],
      [0.8, 0.5, 0.25, 0.04, 0.5, -0.26],
      [1, 0.1, -0.2, -0.02, 0.5, -0.32],
    ],
  },
  // The same, backwards: plant behind the hip, push the blade forward.
  reverse: {
    dur: 1.2,
    keys: [
      [0, 0.25, 0.3, 0.0, 0.5, -0.28],
      [0.2, 0.5, 0.72, 0.06, 0.44, -0.22],
      [0.68, -0.35, 0.72, 0.06, 0.45, -0.34],
      [0.84, -0.6, 0.25, 0.03, 0.5, -0.34],
      [1, -0.1, -0.2, -0.02, 0.5, -0.32],
    ],
  },
  // A wide, flat arc far out from the hull, bow to stern: turns a lot, pushes little.
  sweep: {
    dur: 1.5,
    keys: [
      [0, -0.6, 0.25, 0.0, 0.48, -0.34],
      [0.16, -1.25, 0.45, 0.22, 0.26, -0.3],
      [0.8, 1.15, 0.45, 0.22, 0.26, -0.22],
      [0.9, 1.0, 0.2, 0.06, 0.48, -0.26],
      [1, 0.1, -0.2, -0.02, 0.5, -0.32],
    ],
  },
};

/** Resting across the lap, hands forward. */
const IDLE: PaddlePose = { psi: 0, phi: 0, cx: 0, cy: 0.36, cz: -0.36 };

function sampleStroke(kind: StrokeKind, side: Side, t: number, out: PaddlePose): PaddlePose {
  const keys = STROKES[kind].keys;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const f = smoothstep(a[0], b[0], t);
  out.psi = side * (a[1] + (b[1] - a[1]) * f);
  out.phi = side * (a[2] + (b[2] - a[2]) * f);
  out.cx = side * (a[3] + (b[3] - a[3]) * f);
  out.cy = a[4] + (b[4] - a[4]) * f;
  out.cz = a[5] + (b[5] - a[5]) * f;
  return out;
}

/** Shaft direction (left → right) in the boat's frame. */
export function shaftDir(p: Readonly<PaddlePose>, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const c = Math.cos(p.phi);
  out.x = c * Math.cos(p.psi);
  out.y = -Math.sin(p.phi);
  out.z = c * Math.sin(p.psi);
  return out;
}

export interface BladeEvent {
  side: Side;
  kind: 'catch' | 'exit';
  x: number;
  z: number;
  /** 0..1, how hard the blade hit or left the water. */
  strength: number;
}

/** Stroke scheduling and the paddle's motion. */
export class Paddle {
  readonly pose: PaddlePose = { ...IDLE };
  /** Current stroke, if any. */
  side: Side = 1;
  kind: StrokeKind = 'forward';
  t = 1;
  stroking = false;
  private lastSide: Side = 1;
  private readonly target: PaddlePose = { ...IDLE };

  /** Starts a new stroke when the controls ask for one and the current one allows it. */
  update(dt: number, c: Readonly<PaddleControls>): void {
    if (this.stroking) {
      this.t += dt / STROKES[this.kind].dur;
      if (this.t >= 1) this.stroking = false;
    }
    const want: Side | 0 =
      c.left && c.right ? (-this.lastSide as Side) : c.left ? -1 : c.right ? 1 : c.cruise || c.back ? (-this.lastSide as Side) : 0;
    // The shaft is one piece: the other side can start while this stroke swings over; the
    // same side again only once the blade has come all the way back.
    if (want !== 0 && (!this.stroking || (want !== this.side && this.t > 0.82))) {
      this.side = want;
      this.lastSide = want;
      this.kind = c.back ? 'reverse' : c.sweep && (c.left || c.right) ? 'sweep' : 'forward';
      this.t = 0;
      this.stroking = true;
    }
    const tg = this.stroking ? sampleStroke(this.kind, this.side, this.t, this.target) : Object.assign(this.target, IDLE);
    const k = damp(this.stroking ? 16 : 5, dt);
    const p = this.pose;
    p.psi += (tg.psi - p.psi) * k;
    p.phi += (tg.phi - p.phi) * k;
    p.cx += (tg.cx - p.cx) * k;
    p.cy += (tg.cy - p.cy) * k;
    p.cz += (tg.cz - p.cz) * k;
  }

  /** The stroke just started on this side (for the "tapped" key latch). */
  consumed(side: Side): boolean {
    return this.stroking && this.side === side && this.t < 0.05;
  }

  /** −1 … 1: how far the torso turns (the shoulders follow the shaft). */
  get twist(): number {
    return clamp(-this.pose.psi * 0.55, -0.5, 0.5);
  }
}

const tmpD = { x: 0, y: 0, z: 0 };

/** A blade point (boat-local) at fraction `u` of the half shaft on side `e`. */
function bladePoint(p: Readonly<PaddlePose>, e: Side, u: number, out: { x: number; y: number; z: number }): void {
  shaftDir(p, tmpD);
  const r = e * PADDLE.half * u;
  out.x = p.cx + tmpD.x * r;
  out.y = HULL.seatY + p.cy + tmpD.y * r;
  out.z = HULL.seatZ + p.cz + tmpD.z * r;
}

/** The kayak's body. */
export class KayakBody {
  x = 0;
  z = 0;
  yaw = 0;
  /** World velocity (m/s) and yaw rate (rad/s, positive = turning left). */
  vx = 0;
  vz = 0;
  w = 0;
  /** Looks: height of the waterline origin, and pitch (bow up +) / roll (right side down +). */
  y = 0;
  pitch = 0;
  roll = 0;
  /** 0 afloat … 1 firmly on the sand. */
  grounded = 0;
  private readonly ws: WaterSample = { height: 0, dhdx: 0, dhdz: 0 };
  private readonly blk = { x: 0, z: 0 };
  private readonly prevTip = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  private readonly tip = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  private readonly top = { x: 0, y: 0, z: 0 };
  private readonly end = { x: 0, y: 0, z: 0 };
  private readonly vLocal = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  private readonly wet: [number, number] = [0, 0];
  private placed = false;

  constructor(private readonly env: KayakEnv) {}

  place(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vz = this.w = 0;
    this.placed = false;
  }

  /** Forward speed (m/s, negative going backwards). */
  get speed(): number {
    return -this.vx * Math.sin(this.yaw) - this.vz * Math.cos(this.yaw);
  }

  /** Boat-local (lx, lz) → world, written into `out`. */
  toWorld(lx: number, lz: number, out: { x: number; z: number }): { x: number; z: number } {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    out.x = this.x + lx * c + lz * s;
    out.z = this.z - lx * s + lz * c;
    return out;
  }

  /**
   * Advances the boat by `dt`. `paddle` is null when nobody sits in it. Blade events (catch,
   * exit) go to `onBlade` for splashes and ripples.
   */
  step(dt: number, paddle: Paddle | null, onBlade?: (e: BladeEvent) => void): void {
    dt = Math.min(dt, 0.05);
    const env = this.env;
    // Blade motion over this frame, in the boat's frame (the stroke's own velocity).
    const vLocal = this.vLocal;
    if (paddle) {
      for (let i = 0; i < 2; i++) {
        const e: Side = i === 0 ? -1 : 1;
        bladePoint(paddle.pose, e, 0.82, this.tip[i]);
        const pt = this.prevTip[i];
        if (this.placed) {
          vLocal[i].x = (this.tip[i].x - pt.x) / dt;
          vLocal[i].y = (this.tip[i].y - pt.y) / dt;
          vLocal[i].z = (this.tip[i].z - pt.z) / dt;
        }
        pt.x = this.tip[i].x;
        pt.y = this.tip[i].y;
        pt.z = this.tip[i].z;
      }
    }
    this.placed = true;

    const n = Math.max(1, Math.ceil(dt / 0.011));
    const h = dt / n;
    for (let sub = 0; sub < n; sub++) {
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      // Forward and right in the world.
      const ux = -s;
      const uz = -c;
      const rx = c;
      const rz = -s;
      let fx = 0;
      let fz = 0;
      let tq = 0;
      const addForce = (px: number, pz: number, ax: number, az: number): void => {
        fx += ax;
        fz += az;
        tq += pz * ax - px * az;
      };

      // Hull drag: along the boat at its middle, sideways at each end.
      const vl = this.vx * ux + this.vz * uz;
      const fl = -(DRAG_LONG[0] * vl + DRAG_LONG[1] * vl * Math.abs(vl));
      fx += fl * ux;
      fz += fl * uz;
      for (const [d, grip] of [[END, BOW_GRIP], [-END, STERN_GRIP]] as const) {
        const px = ux * d;
        const pz = uz * d;
        // Point velocity: v + ω × r.
        const pvx = this.vx + this.w * pz;
        const pvz = this.vz - this.w * px;
        const vt = pvx * rx + pvz * rz;
        const ft = -(DRAG_SIDE[0] * vt + DRAG_SIDE[1] * vt * Math.abs(vt)) * grip;
        addForce(px, pz, ft * rx, ft * rz);
      }
      tq -= 6 * this.w + 12 * this.w * Math.abs(this.w);

      // The paddle blades in the water.
      if (paddle) {
        for (let i = 0; i < 2; i++) {
          const e: Side = i === 0 ? -1 : 1;
          // Force at the blade's middle; how wet it is from its top down to its end.
          const tp = this.tip[i];
          bladePoint(paddle.pose, e, PADDLE.bladeFrom, this.top);
          bladePoint(paddle.pose, e, 1, this.end);
          const tw = this.toWorld(tp.x, tp.z, this.blk);
          const wx = tw.x;
          const wz = tw.z;
          const surface = env.water(wx, wz, this.ws).height;
          const tipY = this.y + this.end.y;
          const topY = this.y + this.top.y;
          const wet = clamp((surface - tipY) / Math.max(0.05, topY - tipY), 0, 1);
          if (sub === 0 && onBlade) {
            if (wet > 0.3 && this.wet[i] <= 0.3) onBlade({ side: e, kind: 'catch', x: wx, z: wz, strength: clamp(Math.hypot(vLocal[i].x, vLocal[i].y, vLocal[i].z) / 2.5, 0, 1) });
            else if (wet <= 0.1 && this.wet[i] > 0.1) onBlade({ side: e, kind: 'exit', x: wx, z: wz, strength: 0.5 });
          }
          if (sub === 0) this.wet[i] = wet;
          if (wet <= 0) continue;
          // Blade velocity relative to the (still) water: boat + rotation + stroke.
          const prx = wx - this.x;
          const prz = wz - this.z;
          const vlx = vLocal[i].x * c + vLocal[i].z * s;
          const vlz = -vLocal[i].x * s + vLocal[i].z * c;
          const bvx = this.vx + this.w * prz + vlx;
          const bvz = this.vz - this.w * prx + vlz;
          // Blade face normal: horizontal, across the shaft.
          shaftDir(paddle.pose, tmpD);
          const hl = Math.hypot(tmpD.x, tmpD.z) || 1;
          const nlx = -tmpD.z / hl;
          const nlz = tmpD.x / hl;
          const nx = nlx * c + nlz * s;
          const nz = -nlx * s + nlz * c;
          const vn = bvx * nx + bvz * nz;
          let fn = -BLADE_K * wet * vn * Math.abs(vn);
          fn = clamp(fn, -MAX_BLADE_FORCE, MAX_BLADE_FORCE);
          // A little drag along the blade's face too.
          const tvx = bvx - vn * nx;
          const tvz = bvz - vn * nz;
          addForce(prx, prz, fn * nx - 8 * wet * tvx, fn * nz - 8 * wet * tvz);
        }
      }

      // Ground under the keel (bow, middle, stern): friction, and a push toward deeper water.
      let ground = 0;
      for (const d of [1.7, 0, -1.7]) {
        const px = this.x + ux * d;
        const pz = this.z + uz * d;
        const g = env.ground(px, pz);
        const pen = g - (this.y - HULL.draft);
        if (pen <= 0) continue;
        ground = Math.max(ground, pen);
        const e = 0.5;
        const gx = (env.ground(px + e, pz) - env.ground(px - e, pz)) / (2 * e);
        const gz = (env.ground(px, pz + e) - env.ground(px, pz - e)) / (2 * e);
        const push = 260 * Math.min(pen, 0.3);
        addForce(ux * d, uz * d, -gx * push, -gz * push);
      }
      this.grounded = clamp(ground / 0.15, 0, 1);

      // Swells lean the boat down their slopes (a gentle surge back and forth).
      const w = env.water(this.x, this.z, this.ws);
      fx -= MASS * 9.81 * 0.25 * w.dhdx;
      fz -= MASS * 9.81 * 0.25 * w.dhdz;

      // Far out at sea, a current brings you back.
      const r = Math.hypot(this.x, this.z);
      if (r > SEA_LIMIT) {
        const k = (r - SEA_LIMIT) * 40;
        fx -= (this.x / r) * k;
        fz -= (this.z / r) * k;
      }

      this.vx += (fx / MASS) * h;
      this.vz += (fz / MASS) * h;
      this.w += (tq / INERTIA) * h;
      // Sand friction: the more aground, the quicker it stops.
      if (ground > 0) {
        const f = Math.exp(-(1.5 + 30 * Math.min(ground, 0.3)) * h);
        this.vx *= f;
        this.vz *= f;
        this.w *= Math.exp(-(2 + 40 * Math.min(ground, 0.3)) * h);
      }
      const nx0 = this.x + this.vx * h;
      const nz0 = this.z + this.vz * h;
      // Can't be driven up onto dry sand.
      if (env.ground(nx0 + ux * 1.7, nz0 + uz * 1.7) > this.y - HULL.draft + 0.32 && this.vx * ux + this.vz * uz > 0) {
        const v = this.vx * ux + this.vz * uz;
        this.vx -= v * ux;
        this.vz -= v * uz;
      } else {
        this.x = nx0;
        this.z = nz0;
      }
      this.yaw += this.w * h;
      this.collide(ux, uz);
    }
    this.float(dt);
  }

  /** Rocks, stilts and the rowboat: push the bow, middle and stern circles out. */
  private collide(ux: number, uz: number): void {
    let dx = 0;
    let dz = 0;
    for (const d of [1.3, 0, -1.3]) {
      const px = this.x + ux * d;
      const pz = this.z + uz * d;
      this.env.block(px, pz, this.y - HULL.draft, 0.38, this.blk);
      const ex = this.blk.x - px;
      const ez = this.blk.z - pz;
      if (ex * ex + ez * ez > dx * dx + dz * dz) {
        dx = ex;
        dz = ez;
      }
    }
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return;
    this.x += dx;
    this.z += dz;
    const nx = dx / len;
    const nz = dz / len;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      // A soft bump: most of the speed into the obstacle is lost.
      this.vx -= 1.3 * vn * nx;
      this.vz -= 1.3 * vn * nz;
      this.w *= 0.6;
    }
  }

  /** Heave, pitch and roll from the waves at bow, stern and both sides (or the sand under it). */
  private float(dt: number): void {
    const env = this.env;
    const p = this.blk;
    const level = (lx: number, lz: number): number => {
      this.toWorld(lx, lz, p);
      // On the sand it settles in a little (the keel sinks into it).
      return Math.max(env.water(p.x, p.z, this.ws).height, env.ground(p.x, p.z) + HULL.draft - 0.04);
    };
    const bow = level(0, -1.6);
    const stern = level(0, 1.6);
    const left = level(-HULL.halfBeam, 0);
    const right = level(HULL.halfBeam, 0);
    const y = (bow + stern + left + right) / 4;
    const pitch = Math.atan2(bow - stern, 3.2);
    // Leans a little into turns, like a real hull at speed.
    const roll = Math.atan2(left - right, HULL.halfBeam * 2) * 0.6 + clamp(this.w * this.speed * 0.04, -0.08, 0.08);
    if (!Number.isFinite(this.y) || Math.abs(y - this.y) > 1) this.y = y;
    // Light boat: it follows the water quickly, but not rigidly.
    this.y += (y - this.y) * damp(6, dt);
    this.pitch += (pitch - this.pitch) * damp(5, dt);
    this.roll += (roll - this.roll) * damp(5, dt);
  }
}
