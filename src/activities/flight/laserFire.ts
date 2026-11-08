/**
 * The manta's frost laser (Săn Bong Bóng): a click flashes it, holding it turns the flash into
 * a beam that heats up. Pure state, driven by press / release and the shared clock (s).
 */

export const FIRE = {
  /** A flash lasts this long (s). */
  flash: 0.15,
  /** At most one press per this long (s), from the last accepted press. */
  cooldown: 0.12,
  /** Held this long (s), the flash becomes a beam. */
  hold: 0.15,
  /** The beam heats up from 0 to 1 over this long (s). */
  heat: 1.5,
  /** The beam bursts a bubble after this much time on it (s, summed). */
  exposure: 0.08,
} as const;

/** The beam's width fades in over this long (s). */
const BEAM_IN = 0.05;
/** A flash swells over this fraction of its life, then thins. */
const FLASH_PEAK = 0.2;

export type FireMode = 'off' | 'flash' | 'beam';

export class LaserFire {
  private _mode: FireMode = 'off';
  private _strength = 0;
  private _heat = 0;
  private _fired = false;
  private pressed = false;
  private pressAt = -Infinity;
  private flashPending = false;

  get mode(): FireMode {
    return this._mode;
  }

  /** 0 … 1: the width envelope of the flash or the beam. */
  get strength(): number {
    return this._strength;
  }

  /** 0 … 1 over FIRE.heat while the beam stays on. */
  get heat(): number {
    return this._heat;
  }

  /** True for exactly one update after a flash starts (a flash hits at once). */
  get flashFired(): boolean {
    return this._fired;
  }

  press(now: number): void {
    if (this.pressed || now - this.pressAt < FIRE.cooldown) return;
    this.pressed = true;
    this.pressAt = now;
    this.flashPending = true;
    this._mode = 'flash';
  }

  release(_now: number): void {
    this.pressed = false;
    if (this._mode === 'beam') this.stop();
  }

  /** Not flying any more: everything off at once. */
  cancel(): void {
    this.pressed = false;
    this.stop();
  }

  update(now: number): void {
    this._fired = this.flashPending;
    this.flashPending = false;
    const held = now - this.pressAt;
    if (this.pressed && held >= FIRE.hold) {
      this._mode = 'beam';
      const on = held - FIRE.hold;
      this._heat = Math.min(1, on / FIRE.heat);
      this._strength = Math.min(1, on / BEAM_IN);
      return;
    }
    if (this._mode !== 'flash') return;
    const u = held / FIRE.flash;
    if (u >= 1 && !this.pressed) {
      this.stop();
      return;
    }
    const k = Math.min(u, 1);
    this._strength = k < FLASH_PEAK ? 0.4 + (0.6 * k) / FLASH_PEAK : 1 - (0.7 * (k - FLASH_PEAK)) / (1 - FLASH_PEAK);
  }

  private stop(): void {
    this._mode = 'off';
    this._strength = 0;
    this._heat = 0;
  }
}

/** How long the beam has been on each bubble (s, summed while it stays on it). */
export class Exposure {
  private readonly t: Float32Array;

  constructor(capacity: number) {
    this.t = new Float32Array(capacity);
  }

  /** Adds `dt` on slot i; true once it reaches FIRE.exposure (then starts over). */
  add(i: number, dt: number): boolean {
    this.t[i] += dt;
    if (this.t[i] + 1e-6 < FIRE.exposure) return false;
    this.t[i] = 0;
    return true;
  }

  reset(i: number): void {
    this.t[i] = 0;
  }

  clearAll(): void {
    this.t.fill(0);
  }
}
