import type { SpraySink } from '../../water/Spray';
import type { BubbleSink } from './airBubbles';
import type { StreamState } from './jetStream';

export const GRAVITY = 9.81;
/**
 * Launch angle above the horizon (rad): low, so the jet flies hard and flat (a fast, forceful
 * stream); steeper when the target sits higher than the mouth.
 */
const ANGLE = 0.42;
const STEEP = 0.9;
/** The fastest it can shoot (m/s). */
const MAX_SPEED = 13;
/** Per second: droplets fraying off the end, splash droplets where it lands, bubbles along it. */
const FRAY_RATE = 90;
const SPLASH_RATE = 150;
const BUBBLE_RATE = 30;
/** A ripple where it lands every this many seconds. */
const RIPPLE_EVERY = 0.07;
/** How near the landing must be to the target (m) to count as a hit on it. */
const HIT_RADIUS = 0.7;

/**
 * A creature's water jet from its mouth to a target point. The water flies a ballistic arc whose
 * launch speed is solved for a fixed angle; this keeps the arc's state (`stream`, drawn by
 * JetStream as one tube) with its two ends moving along it in time of flight: the head leaves the
 * mouth and reaches the target, and when firing stops the tail leaves the mouth and the water
 * falls away. Around it: droplets fraying off the end, a splash and ripples where it lands, and
 * air bubbles shed along the way. The landing is known from the arc, so ripples and the hit on
 * the target need no collision tests.
 */
export class WaterJet {
  readonly stream: StreamState = { ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, tail: 0, head: 0, flight: 1, opacity: 0 };
  /** Seconds of firing left (0 = stopped). */
  private left = 0;
  /** Time since the water left the mouth, and since firing stopped (Infinity: still firing). */
  private sinceStart = 0;
  private sinceStop = Infinity;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private hitDone = false;
  private frayDebt = 0;
  private splashDebt = 0;
  private bubbleDebt = 0;
  private rippleIn = 0;

  constructor(
    private readonly spray: SpraySink,
    private readonly bubbles: BubbleSink,
    /** A splash on open water at (x, z) (ignored on land). */
    private readonly ripple: (x: number, z: number, radius: number, strength: number) => void,
    /** The water landed on the target (once per firing). */
    private readonly onHit: () => void,
  ) {}

  get firing(): boolean {
    return this.left > 0;
  }

  /** Starts firing for `duration` s at the world point (x, y, z). */
  fire(x: number, y: number, z: number, duration: number): void {
    this.aim(x, y, z);
    this.left = duration;
    this.sinceStart = 0;
    this.sinceStop = Infinity;
    this.hitDone = false;
  }

  /** Moves the aim while firing (a target that walks). */
  aim(x: number, y: number, z: number): void {
    this.tx = x;
    this.ty = y;
    this.tz = z;
  }

  stop(): void {
    if (this.left > 0) {
      this.left = 0;
      this.sinceStop = 0;
    }
  }

  /** `ox, oy, oz`: the mouth (world) this frame. */
  update(dt: number, ox: number, oy: number, oz: number): void {
    const s = this.stream;
    if (this.left > 0) {
      // Attached: the arc starts at the mouth and is re-aimed every frame.
      this.solve(ox, oy, oz);
      this.left -= dt;
      if (this.left <= 0) this.sinceStop = 0;
    } else if (this.sinceStop === Infinity || this.sinceStop > s.flight) {
      s.opacity = 0;
      return;
    } else {
      // Detached: the arc stays where it was; its tail runs down it after the head.
      this.sinceStop += dt;
    }
    this.sinceStart += dt;
    s.head = Math.min(this.sinceStart, s.flight);
    s.tail = this.sinceStop === Infinity ? 0 : Math.min(this.sinceStop, s.head);
    s.opacity = 1;

    // Along the arc at time t: x = ox + vx·t, y = oy + vy·t − g·t²/2.
    const emitAt = (t: number, k: number): void => {
      // Speed along the arc at t, scaled by k, plus a little spread.
      const x = s.ox + s.vx * t;
      const y = s.oy + s.vy * t - 0.5 * GRAVITY * t * t;
      const z = s.oz + s.vz * t;
      const j = 0.6;
      this.spray.drop(
        x, y, z,
        s.vx * k + (Math.random() - 0.5) * j,
        (s.vy - GRAVITY * t) * k + (Math.random() - 0.5) * j,
        s.vz * k + (Math.random() - 0.5) * j,
        0.02 + Math.random() * 0.025,
      );
    };

    // Droplets fray off the end of the stream (its last third).
    this.frayDebt += dt * FRAY_RATE;
    while (this.frayDebt >= 1) {
      this.frayDebt -= 1;
      const lo = Math.max(s.tail, s.head * 0.65);
      if (s.head > lo) emitAt(lo + Math.random() * (s.head - lo), 0.9 + Math.random() * 0.15);
    }

    // Air bubbles shed along the stream, thrown a little along it.
    this.bubbleDebt += dt * BUBBLE_RATE;
    while (this.bubbleDebt >= 1) {
      this.bubbleDebt -= 1;
      if (s.head <= s.tail) break;
      const t = s.tail + Math.random() * (s.head - s.tail);
      this.bubbles.blow(
        s.ox + s.vx * t,
        s.oy + s.vy * t - 0.5 * GRAVITY * t * t,
        s.oz + s.vz * t,
        s.vx * 0.25 + (Math.random() - 0.5) * 0.4,
        (s.vy - GRAVITY * t) * 0.25 + Math.random() * 0.3,
        s.vz * 0.25 + (Math.random() - 0.5) * 0.4,
        0.03 + Math.random() * 0.045,
      );
    }

    // Landed (the head is at the end of the arc and water still arrives): splash, ripples, hit.
    if (s.head >= s.flight && s.tail < s.flight) {
      const lx = s.ox + s.vx * s.flight;
      const lz = s.oz + s.vz * s.flight;
      const ly = s.oy + s.vy * s.flight - 0.5 * GRAVITY * s.flight * s.flight;
      this.splashDebt += dt * SPLASH_RATE;
      while (this.splashDebt >= 1) {
        this.splashDebt -= 1;
        const a = Math.random() * Math.PI * 2;
        // A hard jet throws its splash wide and high.
        const h = 0.5 + Math.random() * 1.2;
        this.spray.drop(lx, ly + 0.03, lz, Math.cos(a) * h + s.vx * 0.2, 1.2 + Math.random() * 2.2, Math.sin(a) * h + s.vz * 0.2, 0.02 + Math.random() * 0.025);
      }
      this.rippleIn -= dt;
      if (this.rippleIn <= 0) {
        this.rippleIn = RIPPLE_EVERY;
        this.ripple(lx, lz, 0.6, -0.25);
      }
      if (!this.hitDone && this.left > 0 && Math.hypot(lx - this.tx, lz - this.tz) < HIT_RADIUS) {
        this.hitDone = true;
        this.onHit();
      }
    }
  }

  /** The arc from the mouth to the target: launch velocity for a fixed angle, and its flight time. */
  private solve(ox: number, oy: number, oz: number): void {
    const s = this.stream;
    const dx = this.tx - ox;
    const dz = this.tz - oz;
    const d = Math.max(0.3, Math.hypot(dx, dz));
    const dh = this.ty - oy;
    // v² = g·d² / (2·cos²θ·(d·tanθ − Δh)); a steeper angle if the target is too high for ANGLE.
    let angle = ANGLE;
    let denom = d * Math.tan(angle) - dh;
    if (denom < 0.05) {
      angle = STEEP;
      denom = Math.max(0.05, d * Math.tan(angle) - dh);
    }
    const c = Math.cos(angle);
    const v = Math.min(MAX_SPEED, Math.sqrt((GRAVITY * d * d) / (2 * c * c * denom)));
    const h = v * Math.cos(angle);
    s.ox = ox;
    s.oy = oy;
    s.oz = oz;
    s.vx = (dx / d) * h;
    s.vz = (dz / d) * h;
    s.vy = v * Math.sin(angle);
    // When it comes down to the target's height: y(t) = oy + vy·t − g·t²/2 = ty.
    const disc = s.vy * s.vy + 2 * GRAVITY * (oy - this.ty);
    s.flight = disc > 0 ? (s.vy + Math.sqrt(disc)) / GRAVITY : d / Math.max(0.1, h);
  }
}
