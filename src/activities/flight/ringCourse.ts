/**
 * Vòng Tròn Băng Giá (Phase 15i): a course of ice rings to fly through, like an FPV drone race
 * (gates one after another; the fun is threading them fast and keeping the line). Each cast
 * draws a new course: its difficulty, number of rings, their size, the spacing and the shape
 * of the line (slalom, arc, wave, helix, zig-zag or a mix) are all random. The rings show a few
 * at a time (the next ones appear as you pass), each with a time limit; fly them all to win.
 *
 * Pure (no Three.js): the course and the pass test, so both are unit-tested.
 */

export type RingLevel = 'easy' | 'normal' | 'hard';
export type RingPattern = 'slalom' | 'arc' | 'wave' | 'helix' | 'zigzag' | 'mixed';
export const RING_LEVELS: readonly RingLevel[] = ['easy', 'normal', 'hard'];
const PATTERNS: readonly RingPattern[] = ['slalom', 'arc', 'wave', 'helix', 'zigzag', 'mixed'];

/**
 * Per difficulty: rings in a course, their radius (m; the manta spans 5 m), the gap between
 * them (m), how hard the line bends (rad of heading per ring at most) and climbs (height per
 * metre of gap at most), and the time allowed per ring: the gap at cruise speed × `slack`.
 */
export const LEVEL = {
  easy: { count: [5, 7], radius: [5, 6.2], gap: [40, 50], turn: 0.32, climb: 0.1, slack: 2 },
  normal: { count: [7, 10], radius: [4, 5], gap: [33, 43], turn: 0.5, climb: 0.18, slack: 1.6 },
  hard: { count: [9, 13], radius: [3.2, 4], gap: [27, 36], turn: 0.75, climb: 0.27, slack: 1.3 },
} as const;
/** Cruise speed the time limits are worked out at (m/s; see MantaFlight). */
const PACE = 14;
/** Extra seconds for the first ring (you see the course, then go) and for each one after. */
const FIRST_EXTRA = 2.5;
const EXTRA = 1.2;
/** The first ring this far ahead (m), at least this high over what's under it, never above `top`. */
const FIRST = { gap: [36, 44], clear: 3, top: 85 } as const;
/** Keep the course this far (m) from the island's middle at most: beyond, the line bends back. */
const RANGE = 380;
/** Passing this close to the middle (fraction of the radius) is a perfect pass. */
export const PERFECT = 0.35;
/** Rings shown ahead at a time (the current one and the next ones). */
export const SHOWN = 3;

export interface Gate {
  x: number;
  y: number;
  z: number;
  /** Which way to fly through it (unit). */
  nx: number;
  ny: number;
  nz: number;
  radius: number;
  /** Seconds allowed to reach it from the one before. */
  time: number;
  seed: number;
}

export interface Course {
  level: RingLevel;
  pattern: RingPattern;
  /** The rings' frame: a circle, or a snowflake's hexagon (random per course). */
  hex: boolean;
  gates: Gate[];
}

const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
const range = (rnd: () => number, [a, b]: readonly [number, number]): number => a + rnd() * (b - a);

/**
 * A new random course starting ahead of (x, y, z) flying `yaw` (0: −z, as MantaFlight).
 * `floor(x, z)`: the highest thing there (terrain, trees, house; the sea is 0).
 */
export function makeCourse(
  rnd: () => number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  floor: (x: number, z: number) => number,
  level: RingLevel = pick(rnd, RING_LEVELS),
  pattern: RingPattern = pick(rnd, PATTERNS),
): Course {
  const L = LEVEL[level];
  const count = Math.round(range(rnd, L.count));
  const side = rnd() < 0.5 ? 1 : -1;
  const up = rnd() < 0.5 ? 1 : -1;
  let heading = yaw;
  let px = x;
  let py = y;
  let pz = z;
  let seg: Exclude<RingPattern, 'mixed'> = 'slalom';
  const pts: { x: number; y: number; z: number; r: number; gap: number }[] = [];
  for (let i = 0; i < count; i++) {
    const gap = i === 0 ? range(rnd, FIRST.gap) : range(rnd, L.gap);
    let turn = 0;
    let climb = 0;
    if (i > 0) {
      // The line's shape: how the heading and the height change from ring to ring.
      if (pattern === 'mixed') {
        if ((i - 1) % 3 === 0) seg = pick(rnd, ['slalom', 'arc', 'wave', 'helix', 'zigzag'] as const);
      } else seg = pattern;
      const j = 0.75 + 0.5 * rnd();
      switch (seg) {
        case 'slalom':
          turn = L.turn * j * (i % 2 === 0 ? side : -side);
          climb = (rnd() - 0.5) * L.climb * 0.5;
          break;
        case 'arc':
          turn = L.turn * 0.8 * j * side;
          climb = (rnd() - 0.5) * L.climb * 0.4;
          break;
        case 'wave':
          turn = (rnd() - 0.5) * L.turn * 0.5;
          climb = L.climb * Math.sin(i * 1.4) * up;
          break;
        case 'helix':
          turn = L.turn * 0.9 * j * side;
          climb = L.climb * 0.8 * up;
          break;
        case 'zigzag':
          turn = L.turn * j * (Math.floor(i / 2) % 2 === 0 ? side : -side);
          climb = (Math.floor(i / 2) % 2 === 0 ? 1 : -1) * L.climb * 0.6 * up;
          break;
      }
    }
    heading += turn;
    // Far out: bend back toward the island (an FPV track stays in the arena).
    const nx = px - Math.sin(heading) * gap;
    const nz = pz - Math.cos(heading) * gap;
    if (Math.hypot(nx, nz) > RANGE) {
      const home = Math.atan2(px, pz);
      heading += Math.max(-L.turn, Math.min(L.turn, angle(heading, home)));
    }
    px -= Math.sin(heading) * gap;
    pz -= Math.cos(heading) * gap;
    const r = range(rnd, L.radius) * (0.9 + 0.2 * rnd());
    py += climb * gap;
    // Clear of what stands there (a ring's bottom never in the trees), never too high.
    py = Math.min(FIRST.top, Math.max(py, floor(px, pz) + r + FIRST.clear));
    pts.push({ x: px, y: py, z: pz, r, gap });
  }
  const gates: Gate[] = pts.map((p, i) => {
    // Through it along the line: from the ring before (or the start) to the one after.
    const a = i > 0 ? pts[i - 1] : { x, y, z };
    const b = i < pts.length - 1 ? pts[i + 1] : p;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let dz = b.z - a.z;
    if (i === pts.length - 1) {
      dx = p.x - a.x;
      dy = p.y - a.y;
      dz = p.z - a.z;
    }
    const d = Math.hypot(dx, dy, dz) || 1;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      nx: dx / d,
      ny: dy / d,
      nz: dz / d,
      radius: p.r,
      time: (p.gap / PACE) * L.slack + (i === 0 ? FIRST_EXTRA : EXTRA),
      seed: rnd(),
    };
  });
  return { level, pattern, hex: rnd() < 0.5, gates };
}

/** −π … π from `a` to `b`. */
function angle(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Crossing a ring's plane between two positions, going its way: how far from its middle (m),
 * or null if not crossed (or crossed backwards, or far beside it: more than 3 radii).
 */
export function crossing(g: Readonly<Gate>, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number | null {
  const da = (ax - g.x) * g.nx + (ay - g.y) * g.ny + (az - g.z) * g.nz;
  const db = (bx - g.x) * g.nx + (by - g.y) * g.ny + (bz - g.z) * g.nz;
  if (!(da < 0 && db >= 0)) return null;
  const t = da / (da - db);
  const r = Math.hypot(ax + (bx - ax) * t - g.x, ay + (by - ay) * t - g.y, az + (bz - az) * t - g.z);
  return r <= g.radius * 3 ? r : null;
}

export type RingEvent =
  | { kind: 'pass'; index: number; perfect: boolean }
  | { kind: 'miss'; index: number }
  | { kind: 'timeout'; index: number };

/** A course being flown: which ring is next, the time left for it, how it went. */
export class RingRun {
  next = 0;
  /** Seconds since the start, and left to reach the next ring. */
  elapsed = 0;
  left: number;
  perfect = 0;
  state: 'run' | 'done' | 'failed' = 'run';

  constructor(readonly course: Course) {
    this.left = course.gates[0].time;
  }

  get total(): number {
    return this.course.gates.length;
  }

  /** One frame: the manta moved from a to b. At most one event (after the last pass: state 'done'). */
  update(dt: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): RingEvent | null {
    if (this.state !== 'run') return null;
    this.elapsed += dt;
    this.left -= dt;
    const g = this.course.gates[this.next];
    const r = crossing(g, ax, ay, az, bx, by, bz);
    if (r !== null) {
      // Wing tips a little outside still count (the middle is inside): no clipping game.
      if (r > g.radius) return { kind: 'miss', index: this.next };
      const perfect = r < g.radius * PERFECT;
      if (perfect) this.perfect++;
      const index = this.next++;
      if (this.next >= this.total) {
        this.state = 'done';
        return { kind: 'pass', index, perfect };
      }
      this.left = this.course.gates[this.next].time;
      return { kind: 'pass', index, perfect };
    }
    if (this.left <= 0) {
      this.state = 'failed';
      return { kind: 'timeout', index: this.next };
    }
    return null;
  }
}
