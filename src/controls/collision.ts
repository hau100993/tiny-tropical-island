/**
 * First-person collision in 2.5D: the walker is a vertical cylinder (radius, height) that
 * moves in the x–z plane. Everything is plain math on small arrays, no physics engine:
 *
 * - circles: tree trunks, rocks, poles (block at every height);
 * - boxes: oriented rectangles with a vertical extent (walls, railings, furniture, stilts);
 *   they only block when they overlap the walker's height span;
 * - platforms: walkable surfaces above the terrain (house floor, steps).
 *
 * Oriented rectangles use the same local frame as three's `rotation.y = rot` on a group at
 * (cx, cz): world = (cx + lx·cos + lz·sin, cz − lx·sin + lz·cos).
 */

/** How high the walker can step up in one move (stairs, roots), in meters. */
export const STEP_UP = 0.45;
/** Height of the walker's body (feet to top of head). */
export const BODY_HEIGHT = 1.8;

export interface CircleCollider {
  x: number;
  z: number;
  r: number;
}

/** Oriented frame of a rectangle in the x–z plane. */
export interface Frame {
  cx: number;
  cz: number;
  cos: number;
  sin: number;
}

export interface BoxCollider extends Frame {
  hx: number;
  hz: number;
  yMin: number;
  yMax: number;
}

export interface Platform<S extends string = string> extends Frame {
  hx: number;
  hz: number;
  /** Surface height at local coordinates inside the rectangle. */
  height: (lx: number, lz: number) => number;
  surface: S;
}

export function frame(cx: number, cz: number, rot: number): Frame {
  return { cx, cz, cos: Math.cos(rot), sin: Math.sin(rot) };
}

/** World → local (writes into `out`). */
export function toLocal(f: Frame, x: number, z: number, out: { x: number; z: number }): void {
  const dx = x - f.cx;
  const dz = z - f.cz;
  out.x = dx * f.cos - dz * f.sin;
  out.z = dx * f.sin + dz * f.cos;
}

/** Uniform grid of circles for fast neighborhood queries (trees, rocks). */
export class CircleGrid {
  private readonly cells = new Map<number, CircleCollider[]>();
  private maxR = 0;

  constructor(
    circles: readonly CircleCollider[],
    private readonly cell = 4,
  ) {
    for (const c of circles) {
      const k = this.key(Math.floor(c.x / cell), Math.floor(c.z / cell));
      const list = this.cells.get(k);
      if (list) list.push(c);
      else this.cells.set(k, [c]);
      this.maxR = Math.max(this.maxR, c.r);
    }
  }

  private key(ix: number, iz: number): number {
    // Island coordinates stay within ±2000 cells, so this packs both into one safe integer.
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  /** Calls `fn` for every circle that may lie within `reach` of (x, z). */
  forEachNear(x: number, z: number, reach: number, fn: (c: CircleCollider) => void): void {
    const r = Math.ceil((reach + this.maxR) / this.cell);
    const ix = Math.floor(x / this.cell);
    const iz = Math.floor(z / this.cell);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this.cells.get(this.key(ix + dx, iz + dz));
        if (list) for (const c of list) fn(c);
      }
    }
  }

  /** Number of circle centers within `radius` of (x, z). */
  countWithin(x: number, z: number, radius: number): number {
    let n = 0;
    const r2 = radius * radius;
    this.forEachNear(x, z, radius, (c) => {
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz < r2) n++;
    });
    return n;
  }
}

export interface Support<S extends string> {
  y: number;
  surface: S;
  /** True when standing on a platform (wood), false on terrain. */
  onPlatform: boolean;
}

export interface TerrainQuery<S extends string> {
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): S;
}

/** Everything the walker can bump into or stand on. */
export class CollisionWorld<S extends string> {
  private readonly grid: CircleGrid;
  private readonly local = { x: 0, z: 0 };

  constructor(
    private readonly terrain: TerrainQuery<S>,
    circles: readonly CircleCollider[],
    private readonly boxes: readonly BoxCollider[],
    private readonly platforms: ReadonlyArray<Platform<S>>,
  ) {
    this.grid = new CircleGrid(circles);
  }

  /**
   * The surface the feet rest on at (x, z), for a walker whose feet are at `feetY`: the highest
   * surface not more than STEP_UP above the feet. Returns false when the spot is blocked: the
   * terrain is a step too high, or a platform hangs at head height (e.g. under the house floor).
   */
  supportAt(x: number, z: number, feetY: number, out: Support<S>): boolean {
    const ground = this.terrain.heightAt(x, z);
    if (ground > feetY + STEP_UP) return false;
    out.y = ground;
    out.onPlatform = false;
    let best = -Infinity;
    for (const p of this.platforms) {
      toLocal(p, x, z, this.local);
      if (Math.abs(this.local.x) > p.hx || Math.abs(this.local.z) > p.hz) continue;
      const h = p.height(this.local.x, this.local.z);
      if (h <= ground) continue;
      if (h > feetY + STEP_UP) {
        // Too high to step on, but low enough to hit the head: blocked.
        if (h < feetY + BODY_HEIGHT) return false;
        continue;
      }
      if (h > best) {
        best = h;
        out.y = h;
        out.surface = p.surface;
        out.onPlatform = true;
      }
    }
    if (!out.onPlatform) out.surface = this.terrain.surfaceAt(x, z);
    return true;
  }

  /**
   * Pushes a walker of `radius` at (x, z) out of every circle and box it overlaps (two passes,
   * so corners between two colliders settle). Writes the corrected position into `out`.
   */
  resolve(x: number, z: number, feetY: number, radius: number, out: { x: number; z: number }): void {
    let px = x;
    let pz = z;
    for (let pass = 0; pass < 2; pass++) {
      this.grid.forEachNear(px, pz, radius, (c) => {
        const dx = px - c.x;
        const dz = pz - c.z;
        const min = c.r + radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) return;
        const d = Math.sqrt(d2);
        if (d < 1e-6) {
          px = c.x + min;
          return;
        }
        px = c.x + (dx / d) * min;
        pz = c.z + (dz / d) * min;
      });
      for (const b of this.boxes) {
        // Only boxes that overlap the body's height span and can't simply be stepped over.
        if (b.yMax <= feetY + 0.05 || b.yMin >= feetY + BODY_HEIGHT) continue;
        toLocal(b, px, pz, this.local);
        const lx = this.local.x;
        const lz = this.local.z;
        if (Math.abs(lx) > b.hx + radius || Math.abs(lz) > b.hz + radius) continue;
        const qx = Math.max(-b.hx, Math.min(b.hx, lx));
        const qz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ex = lx - qx;
        let ez = lz - qz;
        const d = Math.hypot(ex, ez);
        if (d >= radius) continue;
        if (d > 1e-6) {
          const k = (radius - d) / d;
          ex *= k;
          ez *= k;
        } else {
          // Center inside the box: leave along the axis with the least penetration.
          const penX = b.hx - Math.abs(lx) + radius;
          const penZ = b.hz - Math.abs(lz) + radius;
          if (penX < penZ) {
            ex = Math.sign(lx || 1) * penX;
            ez = 0;
          } else {
            ex = 0;
            ez = Math.sign(lz || 1) * penZ;
          }
        }
        // Local push → world push (inverse rotation).
        px += ex * b.cos + ez * b.sin;
        pz += -ex * b.sin + ez * b.cos;
      }
    }
    out.x = px;
    out.z = pz;
  }

  /** Trunks/rocks near (x, z): a cheap "how much forest is around me" measure. */
  countNear(x: number, z: number, radius: number): number {
    return this.grid.countWithin(x, z, radius);
  }
}

/**
 * Distance along a ray (origin o, unit direction d) to where it enters box `b`, or Infinity.
 * Slab method in the box's local frame (the frame only rotates around Y, so y passes through).
 */
export function rayBox(b: BoxCollider, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  const rx = ox - b.cx;
  const rz = oz - b.cz;
  const lo = [rx * b.cos - rz * b.sin, oy, rx * b.sin + rz * b.cos];
  const ld = [dx * b.cos - dz * b.sin, dy, dx * b.sin + dz * b.cos];
  const min = [-b.hx, b.yMin, -b.hz];
  const max = [b.hx, b.yMax, b.hz];
  let t0 = 0;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) {
      if (lo[i] < min[i] || lo[i] > max[i]) return Infinity;
      continue;
    }
    let a = (min[i] - lo[i]) / ld[i];
    let c = (max[i] - lo[i]) / ld[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Distance along a ray to where it hits an (infinitely tall) vertical cylinder, or Infinity. */
export function rayCircle(c: CircleCollider, ox: number, oz: number, dx: number, dz: number): number {
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return Infinity;
  const fx = ox - c.x;
  const fz = oz - c.z;
  const b = fx * dx + fz * dz;
  const cc = fx * fx + fz * fz - c.r * c.r;
  if (cc <= 0) return Infinity; // starts inside: ignore (the walker never is)
  const disc = b * b - a * cc;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 ? t : Infinity;
}
