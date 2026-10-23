/**
 * Petting Mochi with the mouse, as in virtual-pet games: press on the dog and hold to stroke
 * it (moving the mouse moves the hand along its back, head to shoulders and back); a quick,
 * still click is a pat. Pure logic: the app feeds it the pointer, the dog, the character and
 * the hearts read the result.
 */

/** A press shorter than this (s) with less travel than PAT_MOVE (px) is a pat, not a stroke. */
export const PAT_TIME = 0.3;
export const PAT_MOVE = 8;
/** Mouse travel (px) for one stroke, head to back. */
const STROKE_PX = 140;
/** Mouse travel (px) of stroking per heart. */
const HEART_PX = 260;
/** Holding the hand still on the dog: a heart every this many seconds. */
const HEART_HOLD = 1.8;
/** Hearts for a pat. */
const PAT_HEARTS = 2;
/** Affection gained per px stroked, per second held still, and lost per second after. */
const LOVE_PER_PX = 1 / 1800;
const LOVE_PER_S = 0.03;
const LOVE_FADE = 0.04;

export class Petting {
  /** The press is held on the dog. */
  active = false;
  /** Where the hand is along the stroke: 0 = on the head, 1 = down the back. */
  stroke = 0;
  /** The hand is on its way back to the head (lifted off the fur). */
  returning = false;
  /** How content the dog is (0..1): rises while you pet it, fades slowly after. */
  affection = 0;
  private phase = 0;
  private held = 0;
  private travel = 0;
  private heartTravel = 0;
  private sinceHeart = 0;
  private hearts = 0;
  private patted = false;

  /** Pressed on the dog. */
  start(): void {
    this.active = true;
    this.held = 0;
    this.travel = 0;
    this.phase = 0;
    this.stroke = 0;
    this.returning = false;
    this.heartTravel = 0;
    this.sinceHeart = 0;
  }

  /** The mouse moved by (dx, dy) px while pressed. */
  move(dx: number, dy: number): void {
    if (!this.active) return;
    const d = Math.hypot(dx, dy);
    this.travel += d;
    this.phase += d / STROKE_PX;
    const t = this.phase % 2;
    this.stroke = t < 1 ? t : 2 - t;
    this.returning = t >= 1;
    this.affection = Math.min(1, this.affection + d * LOVE_PER_PX);
    this.heartTravel += d;
    while (this.heartTravel >= HEART_PX) {
      this.heartTravel -= HEART_PX;
      this.heart();
    }
  }

  /** Released: a short, still press was a pat. */
  end(): void {
    if (!this.active) return;
    const pat = !this.stroking;
    this.active = false;
    if (pat) {
      this.patted = true;
      this.hearts += PAT_HEARTS;
      this.affection = Math.min(1, this.affection + 0.05);
    }
  }

  /** Stopped without a pat (you walked off, changed view). */
  cancel(): void {
    this.active = false;
  }

  /** Longer or further than a pat: the dog settles in and the hand goes to it. */
  get stroking(): boolean {
    return this.active && (this.held >= PAT_TIME || this.travel >= PAT_MOVE);
  }

  update(dt: number): void {
    if (this.active) {
      this.held += dt;
      this.sinceHeart += dt;
      if (this.held >= PAT_TIME) this.affection = Math.min(1, this.affection + dt * LOVE_PER_S);
      if (this.stroking && this.sinceHeart >= HEART_HOLD) this.heart();
    } else {
      this.affection = Math.max(0, this.affection - dt * LOVE_FADE);
      // The hand rests back on the head for the next time.
      this.stroke = 0;
      this.returning = false;
    }
  }

  /** Hearts to show since the last call. */
  takeHearts(): number {
    const n = this.hearts;
    this.hearts = 0;
    return n;
  }

  /** A pat happened since the last call. */
  takePat(): boolean {
    const p = this.patted;
    this.patted = false;
    return p;
  }

  private heart(): void {
    this.hearts++;
    this.sinceHeart = 0;
  }
}

/**
 * Ray against an axis-aligned ellipsoid (centre c, radii r): the distance along the ray to
 * where it enters (0 if it starts inside), or null if it misses or the ellipsoid is behind.
 * `d` need not be unit length; the distance is in units of `d`.
 */
export function rayEllipsoid(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
): number | null {
  // Scale space so the ellipsoid is a unit sphere at the origin.
  const px = (ox - cx) / rx;
  const py = (oy - cy) / ry;
  const pz = (oz - cz) / rz;
  const qx = dx / rx;
  const qy = dy / ry;
  const qz = dz / rz;
  const a = qx * qx + qy * qy + qz * qz;
  const b = 2 * (px * qx + py * qy + pz * qz);
  const c = px * px + py * py + pz * pz - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / (2 * a);
  const t1 = (-b + s) / (2 * a);
  if (t1 < 0) return null;
  return Math.max(0, t0);
}
