import type { EmberSink } from './embers';
import type { StreamState } from './jetStream';

/** The flame's hot gas bends it upward: a negative gravity for JetStream (m/s²). */
export const FLAME_LIFT = -2.5;
/** How fast the fire leaves the mouth (m/s) and how far it reaches (m). */
const SPEED = 10;
const REACH = 6.5;
/** The flame's radius at the mouth and at its full reach (m), for the hit test (as JetStream draws it). */
export const FLAME_R0 = 0.08;
export const FLAME_R1 = 0.85;
/** Samples along the flame to find where it meets the ground or the sea, and to test a hit. */
const SAMPLES = 10;
/** Per second: embers shed along the flame, puffs of steam (on water) or sparks (on land) where it ends. */
const EMBER_RATE = 110;
const STEAM_RATE = 36;
const SPARK_RATE = 40;
/** A ripple under the steam every this many seconds. */
const RIPPLE_EVERY = 0.1;

/**
 * Hỏa Long's fire breath: a tongue of flame (drawn by JetStream with the fire look) leaving the
 * mouth the way the head faces, at SPEED, bent up a little by its own heat, as far as REACH or
 * until it meets the ground or the sea (sampled along it each frame). Its two ends move along
 * it in time of flight: the fire shoots out, and when it stops the last of it drifts off.
 * Around it: embers; steam and ripples where it meets the water, sparks where it meets the sand;
 * a hit when the flame passes through the target (point-to-flame distance under its radius).
 */
export class FireBreath {
  readonly stream: StreamState = { ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, tail: 0, head: 0, flight: 0.4, opacity: 0 };
  private left = 0;
  private sinceStart = 0;
  private sinceStop = Infinity;
  /** What a hit counts against (world), when there is a target. */
  private target: { x: number; y: number; z: number } | null = null;
  private hitDone = false;
  /** Where the flame ends this frame, and whether that is on water / on the ground (or in the air). */
  private endWater = false;
  private endGround = false;
  private emberDebt = 0;
  private steamDebt = 0;
  private sparkDebt = 0;
  private rippleIn = 0;

  constructor(
    private readonly embers: EmberSink,
    private readonly steam: EmberSink,
    /** Ground height at (x, z), the sea below 0. */
    private readonly heightAt: (x: number, z: number) => number,
    private readonly ripple: (x: number, z: number, radius: number, strength: number) => void,
    /** The flame passed through the target (once per breath). */
    private readonly onHit: () => void,
  ) {}

  get firing(): boolean {
    return this.left > 0;
  }

  /** Breathes for `duration` s; a hit is tested against `target` (or nothing). */
  fire(duration: number, target: { x: number; y: number; z: number } | null): void {
    this.left = duration;
    this.sinceStart = 0;
    this.sinceStop = Infinity;
    this.hitDone = false;
    this.target = target;
  }

  /**
   * `o*`: the mouth (world) this frame; `d*`: which way the head faces (world, unit). While it
   * breathes the flame comes from there; afterwards the last of it drifts on where it was.
   */
  update(dt: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
    const s = this.stream;
    if (this.left > 0) {
      s.ox = ox;
      s.oy = oy;
      s.oz = oz;
      s.vx = dx * SPEED;
      s.vy = dy * SPEED;
      s.vz = dz * SPEED;
      s.flight = this.reach();
      this.left -= dt;
      if (this.left <= 0) this.sinceStop = 0;
    } else if (this.sinceStop === Infinity || this.sinceStop > s.flight) {
      s.opacity = 0;
      return;
    } else {
      this.sinceStop += dt;
    }
    this.sinceStart += dt;
    s.head = Math.min(this.sinceStart, s.flight);
    s.tail = this.sinceStop === Infinity ? 0 : Math.min(this.sinceStop, s.head);
    // Grows in over the first instants (no pop), fades as the last of it drifts off.
    s.opacity = Math.min(1, this.sinceStart * 8) * (this.sinceStop === Infinity ? 1 : 1 - this.sinceStop / s.flight);

    this.emberDebt += dt * EMBER_RATE;
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      if (s.head <= s.tail) break;
      const t = s.tail + (0.2 + 0.8 * Math.random()) * (s.head - s.tail);
      const r = this.radiusAt(t) * 0.8;
      this.embers.emit(
        this.at(t, 0) + (Math.random() - 0.5) * r,
        this.at(t, 1) + (Math.random() - 0.5) * r,
        this.at(t, 2) + (Math.random() - 0.5) * r,
        s.vx * 0.25 + (Math.random() - 0.5) * 1.2,
        s.vy * 0.25 - FLAME_LIFT * t + Math.random() * 1.0,
        s.vz * 0.25 + (Math.random() - 0.5) * 1.2,
        0.03 + Math.random() * 0.04,
      );
    }

    // The flame's end, once it is out at full length and fire still arrives there.
    if (s.head >= s.flight && s.tail < s.flight && (this.endWater || this.endGround)) {
      const ex = this.at(s.flight, 0);
      const ey = this.at(s.flight, 1);
      const ez = this.at(s.flight, 2);
      const spread = this.radiusAt(s.flight);
      if (this.endWater) {
        // Fire on the sea: steam bursts up and the water stirs.
        this.steamDebt += dt * STEAM_RATE;
        while (this.steamDebt >= 1) {
          this.steamDebt -= 1;
          this.steam.emit(ex + (Math.random() - 0.5) * spread, 0.05, ez + (Math.random() - 0.5) * spread, (Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.9, (Math.random() - 0.5) * 0.8, 0.14 + Math.random() * 0.16);
        }
        this.rippleIn -= dt;
        if (this.rippleIn <= 0) {
          this.rippleIn = RIPPLE_EVERY;
          this.ripple(ex, ez, 0.8, -0.1);
        }
      } else {
        // On the sand: sparks splash off it.
        this.sparkDebt += dt * SPARK_RATE;
        while (this.sparkDebt >= 1) {
          this.sparkDebt -= 1;
          const a = Math.random() * Math.PI * 2;
          const h = 0.8 + Math.random() * 1.6;
          this.embers.emit(ex, ey + 0.05, ez, Math.cos(a) * h, 0.6 + Math.random() * 1.4, Math.sin(a) * h, 0.025 + Math.random() * 0.03);
        }
      }
    }

    // A hit: the target within the flame's radius anywhere along its lit part.
    const tg = this.target;
    if (tg && !this.hitDone && this.left > 0 && s.head > s.tail) {
      for (let i = 0; i <= SAMPLES; i++) {
        const t = s.tail + ((s.head - s.tail) * i) / SAMPLES;
        const d = Math.hypot(this.at(t, 0) - tg.x, this.at(t, 1) - tg.y, this.at(t, 2) - tg.z);
        if (d < this.radiusAt(t) + 0.35) {
          this.hitDone = true;
          this.onHit();
          break;
        }
      }
    }
  }

  /** Along the flame at time t: p = o + v·t + ½·lift·t² (lift upward). */
  private at(t: number, axis: 0 | 1 | 2): number {
    const s = this.stream;
    return axis === 0 ? s.ox + s.vx * t : axis === 1 ? s.oy + s.vy * t - 0.5 * FLAME_LIFT * t * t : s.oz + s.vz * t;
  }

  /** The flame's radius at time t (as JetStream draws it, without its pulses). */
  private radiusAt(t: number): number {
    const k = Math.min(1, t / (REACH / SPEED));
    return FLAME_R0 + (FLAME_R1 - FLAME_R0) * k;
  }

  /**
   * How long the flame flies (s): its full reach, or less where it first dips below the ground or
   * the sea (sampled, then refined between the last two samples).
   */
  private reach(): number {
    const full = REACH / SPEED;
    this.endWater = false;
    this.endGround = false;
    let prev = 0;
    for (let i = 1; i <= SAMPLES; i++) {
      const t = (full * i) / SAMPLES;
      const x = this.at(t, 0);
      const z = this.at(t, 2);
      const ground = this.heightAt(x, z);
      const surface = Math.max(0, ground);
      if (this.at(t, 1) <= surface) {
        // Halve the step a few times for a clean contact.
        let a = prev;
        let b = t;
        for (let k = 0; k < 4; k++) {
          const m = (a + b) / 2;
          if (this.at(m, 1) <= Math.max(0, this.heightAt(this.at(m, 0), this.at(m, 2)))) b = m;
          else a = m;
        }
        this.endWater = ground < -0.05;
        this.endGround = !this.endWater;
        return b;
      }
      prev = t;
    }
    return full;
  }
}
