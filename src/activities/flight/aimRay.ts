/** Ground / object search along the laser's aim ray (pure). */

/** Step (m) and halvings of the search. */
const STEP = 2;
const REFINE = 5;

/**
 * Where the ray o + t·d (d unit) first goes under `top` (the skyline floor: ground, sea level,
 * tree / house / rock tops) within maxT, or −1. Stepped every STEP m, then refined by halving.
 */
export function rayBlock(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxT: number,
  top: (x: number, z: number) => number,
): number {
  let prev = 0;
  for (let t = Math.min(STEP, maxT); ; t = Math.min(t + STEP, maxT)) {
    if (under(ox, oy, oz, dx, dy, dz, t, top)) {
      let lo = prev;
      let hi = t;
      for (let k = 0; k < REFINE; k++) {
        const mid = (lo + hi) / 2;
        if (under(ox, oy, oz, dx, dy, dz, mid, top)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    if (t >= maxT) return -1;
    prev = t;
  }
}

function under(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  t: number,
  top: (x: number, z: number) => number,
): boolean {
  return oy + dy * t <= top(ox + dx * t, oz + dz * t);
}
