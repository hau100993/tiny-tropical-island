/**
 * The manta's entrance when whistled for (Phase 15h): it comes up out of the sea.
 *
 * 1. stir: the sea churns over it while it rises from the deep, slowly (a shadow under the water);
 * 2. breach: it bursts out, climbing steeply, water streaming off it;
 * 3. loop: a full vertical loop high over the sea, with a barrel roll on the way down;
 * 4. done: it comes out of the loop low and level (MantaActivity curves it in to you).
 *
 * Pure motion (no Three.js, no effects): MantaActivity reads the pose, MantaSkills the phase and
 * the surface crossing for the splash. Like a real manta's breach it starts deep to gather speed
 * (Klimley et al. 2024); unlike a real one (~2 m) it keeps going up.
 */
export const SUMMON = {
  /** Seconds the sea churns before it breaks out. */
  stir: 2.2,
  /** Metres it creeps up along its line during the stir (from deep under). */
  creep: 5,
  /** Its climb out of the water (rad, ~66°) and its speed leaving it (m/s). */
  pitch: 1.15,
  speed: 17,
  /** Metres from the surface to where the loop begins. */
  run: 10,
  /** The loop's radius (m): its top ~20 m up, in view from the beach 55 m off. */
  radius: 7.5,
  /** Its flight-path pitch coming out of the loop (rad: a little down). */
  exitPitch: -0.2,
  /** Never slower than this over the top (m/s). */
  minSpeed: 7,
  /** The barrel roll: one full turn between these flight-path angles of the loop (rad). */
  rollFrom: 3.7,
  rollTo: 5.7,
} as const;

/** Half of g: it trades height for speed as the flight model does (see MantaFlight). */
const G = 9.81 * 0.5;

export type SummonPhase = 'stir' | 'breach' | 'loop' | 'done';

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class MantaSummon {
  phase: SummonPhase = 'done';
  /** Seconds into the current phase. */
  t = 0;
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  roll = 0;
  speed = 0;
  /** For the model: 0 glide … 1 full beats, and the beat's speed. */
  flap = 0.3;
  rate = 0.6;
  /** Where it breaks the surface (x, z), and the sea's height there. */
  bx = 0;
  bz = 0;
  seaY = 0;
  /** Set on the frame it comes out through the surface (read and cleared by the effects). */
  breached = false;
  /** Seconds since it came out of the water (drips fall off it for a while). */
  sinceBreach = Infinity;
  /** Its heading (unit, horizontal): the way it sets off, and still so coming out of the loop. */
  fx = 0;
  fz = -1;
  /** Distance along the climb line from its deepest point. */
  private s = 0;
  /** The loop: flight-path angle φ, its centre (along the heading, and up), and the entry speed. */
  private phi = 0;
  private cAlong = 0;
  private cY = 0;
  private qSpeed = 0;
  private qY = 0;

  get active(): boolean {
    return this.phase !== 'done';
  }

  /** Under the sea at (x, z) (sea surface `seaY`), to come out heading `yaw` (across your view, see MantaActivity). */
  start(x: number, z: number, yaw: number, seaY: number): void {
    this.bx = x;
    this.bz = z;
    this.seaY = seaY;
    this.yaw = yaw;
    this.fx = -Math.sin(yaw);
    this.fz = -Math.cos(yaw);
    this.phase = 'stir';
    this.t = 0;
    this.s = 0;
    this.roll = 0;
    this.breached = false;
    this.sinceBreach = Infinity;
    this.place();
  }

  /** The point `s` m along the climb line, which crosses the surface at (bx, seaY, bz). */
  private place(): void {
    const { pitch, creep } = SUMMON;
    // The surface is crossed 2.5 m into the breach (~7 m deep at the start).
    const under = this.s - (creep + 2.5);
    const h = under * Math.cos(pitch);
    this.x = this.bx + this.fx * h;
    this.z = this.bz + this.fz * h;
    this.y = this.seaY + under * Math.sin(pitch);
  }

  update(dt: number): void {
    if (this.phase === 'done') return;
    this.t += dt;
    if (this.sinceBreach < Infinity) this.sinceBreach += dt;
    const { stir, creep, pitch, speed, run, radius, exitPitch, minSpeed } = SUMMON;
    if (this.phase === 'stir') {
      // Creeping up, gathering itself (slow, strong beats).
      const k = Math.min(1, this.t / stir);
      this.s = creep * k * k;
      this.speed = (2 * creep * k) / stir;
      this.pitch = pitch * smooth(0, 0.6, k);
      this.flap = 0.55;
      this.rate = 0.7;
      this.place();
      if (k >= 1) {
        this.phase = 'breach';
        this.t = 0;
      }
      return;
    }
    if (this.phase === 'breach') {
      // Out at full speed, slowing as it climbs; the loop takes over at `run` m above.
      const y0 = this.y;
      this.speed = Math.sqrt(Math.max(minSpeed * minSpeed, speed * speed - 2 * G * Math.max(0, this.y - this.seaY)));
      this.s += this.speed * dt;
      this.pitch = pitch;
      this.flap = this.t < 0.5 ? 1 : 0.35;
      this.rate = this.t < 0.5 ? 1.9 : 1.1;
      this.place();
      if (y0 < this.seaY && this.y >= this.seaY) {
        this.breached = true;
        this.sinceBreach = 0;
      }
      if (this.y >= this.seaY + run * Math.sin(pitch)) {
        // Into the loop where it is now: the centre sits "above" it (toward its back).
        this.phase = 'loop';
        this.t = 0;
        this.phi = pitch;
        this.qSpeed = this.speed;
        this.qY = this.y;
        const along = (this.x - this.bx) * this.fx + (this.z - this.bz) * this.fz;
        this.cAlong = along - radius * Math.sin(pitch);
        this.cY = this.y + radius * Math.cos(pitch);
      }
      return;
    }
    // The loop: φ is the flight-path angle (0 level, the way it set off; π/2 straight up; π upside down
    // heading away). Position on the circle: centre + R·(sin φ along, −cos φ up); speed from
    // the height it has traded.
    const end = Math.PI * 2 + exitPitch;
    this.speed = Math.sqrt(Math.max(minSpeed * minSpeed, this.qSpeed * this.qSpeed - 2 * G * (this.y - this.qY)));
    this.phi = Math.min(end, this.phi + (this.speed / radius) * dt);
    const along = this.cAlong + radius * Math.sin(this.phi);
    this.x = this.bx + this.fx * along;
    this.z = this.bz + this.fz * along;
    this.y = this.cY - radius * Math.cos(this.phi);
    this.pitch = this.phi;
    // One full roll on the way down the back of the loop.
    this.roll = Math.PI * 2 * smooth(SUMMON.rollFrom, SUMMON.rollTo, this.phi);
    // Gliding over the top, beating again as it pulls out.
    this.flap = this.phi < Math.PI ? 0.25 : this.phi < SUMMON.rollTo ? 0.15 : 0.6;
    this.rate = 1.2;
    if (this.phi >= end) {
      this.phase = 'done';
      this.pitch = exitPitch;
      this.roll = 0;
    }
  }
}
