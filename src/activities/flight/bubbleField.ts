/**
 * Săn Bong Bóng: the bubbles drifting round the manta while you ride (pure logic, no three.js).
 *
 * Each bubble's position is a closed-form function of time (see `posAt`), evaluated the same way
 * here (hit tests) and in the vertex shader (huntBubbles.ts), so nothing is read back from the GPU.
 * Motion, with τ = now − born and A = FIELD.drift:
 *   pos = p0 + (A·sin(fx·τ + φx), rise·τ + ½A·sin(fy·τ + φy), A·sin(fz·τ + φz))
 */

export const FIELD = {
  /** Spawn shell round the manta (m, horizontal). */
  shellMin: 40,
  shellMax: 140,
  /** Farther than this (horizontally) from the manta: fade out and respawn ahead. */
  behind: 200,
  /** Bubble radius (m). */
  rMin: 1.2,
  rMax: 3.5,
  /** Drift amplitude (m) and rise speed (m/s). */
  drift: 4,
  rise: 0.3,
  /** Spawned at least this far above the highest floor round it (m), plus the drift. */
  above: 3,
  /** Above this a bubble is recycled; spawns stay under it (m). */
  ceiling: 150,
  /** Spawns stay this close to the island's middle (m), as the flight limit. */
  bound: 520,
  /** A burst bubble grows back after this long (s, plus the burst). */
  respawnMin: 1,
  respawnMax: 3,
  /** The burst: the hole's rim takes this long to go round (s). */
  burst: 0.09,
  /** Growing in (and fading out) takes this long (s). */
  grow: 0.6,
  /** Hit radius × this: aiming with a mouse is hard. */
  inflate: 1.3,
} as const;

/** Spawn heading spread round the manta's heading (rad, total). */
const SPREAD = 2.4;
/** Spawn height spread round the manta's height (m, total). */
const HEIGHT_SPREAD = 40;
/** Drift frequencies (rad/s). */
const FREQ_MIN = 0.15;
const FREQ_MAX = 0.35;
const TRIES = 8;

export interface Slot {
  live: boolean;
  p0: Float32Array;
  freq: Float32Array;
  phase: Float32Array;
  born: number;
  radius: number;
  /** −1: not bursting. */
  burstAt: number;
  /** From the centre toward the hit point (unit). */
  burstDir: Float32Array;
  /** −1: none scheduled. */
  respawnAt: number;
  /** −1: not fading out. */
  fadeAt: number;
}

export type Floor = (x: number, z: number) => number;

/**
 * Nearest t ≥ 0 where the ray o + t·d (d unit) meets the sphere (c, r): the entry point from
 * outside, the exit point from inside; −1 if it misses.
 */
export function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  r: number,
): number {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t0 = b - s;
  if (t0 >= 0) return t0;
  const t1 = b + s;
  return t1 >= 0 ? t1 : -1;
}

const tmp = new Float32Array(3);

export class BubbleField {
  readonly slots: readonly Slot[];
  /** Active slots (the quality's count), ≤ capacity. */
  count: number;
  /** Bumped whenever a slot's attributes change (the renderer re-uploads them). */
  version = 0;

  constructor(
    capacity: number,
    private readonly rand: () => number = Math.random,
  ) {
    const slots: Slot[] = [];
    for (let i = 0; i < capacity; i++) {
      slots.push({
        live: false,
        p0: new Float32Array(3),
        freq: new Float32Array(3),
        phase: new Float32Array(3),
        born: 0,
        radius: 0,
        burstAt: -1,
        burstDir: new Float32Array(3),
        respawnAt: -1,
        fadeAt: -1,
      });
    }
    this.slots = slots;
    this.count = capacity;
  }

  /**
   * Fills empty, burst and faded slots round the manta at (x, y, z) heading `yaw` (forward
   * (−sin, −cos)); starts fading bubbles left too far away, too high, or past the count.
   */
  update(now: number, x: number, y: number, z: number, yaw: number, floor: Floor): void {
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const inCount = i < this.count;
      if (s.live && s.fadeAt >= 0 && now >= s.fadeAt + FIELD.grow) s.live = false;
      if (!inCount) {
        if (s.live && s.fadeAt < 0) this.fade(s, now);
        continue;
      }
      if (!s.live || (s.respawnAt >= 0 && now >= s.respawnAt)) {
        this.spawn(s, now, x, y, z, yaw, floor);
        continue;
      }
      if (s.fadeAt >= 0 || s.burstAt >= 0) continue;
      this.posAt(i, now, tmp);
      if (Math.hypot(tmp[0] - x, tmp[2] - z) > FIELD.behind || tmp[1] > FIELD.ceiling + 10) this.fade(s, now);
    }
  }

  posAt(i: number, now: number, out: Float32Array | number[]): void {
    const s = this.slots[i];
    const tau = now - s.born;
    const a = FIELD.drift;
    out[0] = s.p0[0] + a * Math.sin(s.freq[0] * tau + s.phase[0]);
    out[1] = s.p0[1] + FIELD.rise * tau + 0.5 * a * Math.sin(s.freq[1] * tau + s.phase[1]);
    out[2] = s.p0[2] + a * Math.sin(s.freq[2] * tau + s.phase[2]);
  }

  /** Grown in, not bursting, not fading. */
  hittable(i: number, now: number): boolean {
    const s = this.slots[i];
    return i < this.count && s.live && s.burstAt < 0 && s.fadeAt < 0 && now >= s.born + FIELD.grow;
  }

  /**
   * The nearest hittable bubble along the ray (d unit) within maxT, its radius × FIELD.inflate;
   * −1 if none. Writes the distance into hit[0].
   */
  pick(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, now: number, hit: Float32Array): number {
    let best = -1;
    let bestT = maxT;
    for (let i = 0; i < this.count; i++) {
      if (!this.hittable(i, now)) continue;
      this.posAt(i, now, tmp);
      const t = raySphere(ox, oy, oz, dx, dy, dz, tmp[0], tmp[1], tmp[2], this.slots[i].radius * FIELD.inflate);
      if (t >= 0 && t <= bestT) {
        best = i;
        bestT = t;
      }
    }
    if (best >= 0) hit[0] = bestT;
    return best;
  }

  /** Starts the burst (dir: from the centre to the hit point, unit) and schedules the regrowth. */
  burst(i: number, now: number, dx: number, dy: number, dz: number): void {
    const s = this.slots[i];
    s.burstAt = now;
    s.burstDir[0] = dx;
    s.burstDir[1] = dy;
    s.burstDir[2] = dz;
    s.respawnAt = now + FIELD.burst + FIELD.respawnMin + this.rand() * (FIELD.respawnMax - FIELD.respawnMin);
    this.version++;
  }

  /** Leaving the manta: every bubble fades out now. */
  clear(now: number): void {
    for (const s of this.slots) if (s.live && s.fadeAt < 0) this.fade(s, now);
  }

  /** Anything still to draw: a bubble not fully faded, or a burst still opening. */
  visible(now: number): boolean {
    for (const s of this.slots) {
      if (!s.live) continue;
      if (s.fadeAt >= 0 ? now < s.fadeAt + FIELD.grow : s.burstAt < 0 || now < s.burstAt + FIELD.burst) return true;
    }
    return false;
  }

  private fade(s: Slot, now: number): void {
    s.fadeAt = now;
    this.version++;
  }

  private spawn(s: Slot, now: number, x: number, y: number, z: number, yaw: number, floor: Floor): void {
    const r = this.rand;
    const a = FIELD.drift;
    for (let k = 0; k < TRIES; k++) {
      const h = yaw + (r() - 0.5) * SPREAD;
      const d = FIELD.shellMin + r() * (FIELD.shellMax - FIELD.shellMin);
      const px = x - Math.sin(h) * d;
      const pz = z - Math.cos(h) * d;
      if (Math.hypot(px, pz) > FIELD.bound - a) continue;
      let top = -Infinity;
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) top = Math.max(top, floor(px + ix * a, pz + iz * a));
      const low = top + FIELD.above + a;
      if (low > FIELD.ceiling) continue;
      const py = Math.min(FIELD.ceiling, Math.max(low, y + (r() - 0.5) * HEIGHT_SPREAD));
      s.live = true;
      s.p0[0] = px;
      s.p0[1] = py;
      s.p0[2] = pz;
      for (let j = 0; j < 3; j++) {
        s.freq[j] = FREQ_MIN + r() * (FREQ_MAX - FREQ_MIN);
        s.phase[j] = r() * Math.PI * 2;
      }
      s.born = now;
      s.radius = FIELD.rMin + r() * (FIELD.rMax - FIELD.rMin);
      s.burstAt = -1;
      s.respawnAt = -1;
      s.fadeAt = -1;
      this.version++;
      return;
    }
    // Nowhere fit this frame (all forest, or the edge): try again next frame.
    s.live = false;
    s.respawnAt = -1;
  }
}
