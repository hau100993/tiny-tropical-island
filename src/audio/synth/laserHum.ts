import { makeFilter, makeGain, type AudioEngine } from '../AudioEngine';

/** Gain ramps (s, time constant): no clicks when the beam starts or stops. */
const RAMP = 0.03;
/** The lowpass opens from here to there as the beam heats up (Hz). */
const CUT_COLD = 400;
const CUT_HOT = 2200;
const LEVEL = 0.12;

/**
 * The manta's held laser beam (Săn Bong Bóng): two slightly detuned saws (110 / 110.7 Hz, a slow
 * beat) through a lowpass that opens with the heat, and a faint high whine. Oscillators exist
 * only while it is enabled (stopped after the fade), as the other synthesized layers.
 */
export class LaserHum {
  private readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private oscs: OscillatorNode[] = [];
  private enabled = false;
  private volume = 1;
  private stopTimer = 0;
  /** The last heat sent (changes under 0.02 are skipped: one automation event per step, not per frame). */
  private heat = -1;

  constructor(private readonly engine: AudioEngine) {
    const ctx = engine.ctx;
    this.filter = makeFilter(ctx, 'lowpass', CUT_COLD, 4);
    this.out = makeGain(ctx, 0);
    this.filter.connect(this.out).connect(engine.direct);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.enabled) this.out.gain.setTargetAtTime(LEVEL * this.volume, this.engine.ctx.currentTime, RAMP);
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    if (on) {
      window.clearTimeout(this.stopTimer);
      if (this.oscs.length === 0) this.startOscs();
      this.out.gain.setTargetAtTime(LEVEL * this.volume, t, RAMP);
    } else {
      this.out.gain.setTargetAtTime(0, t, RAMP);
      // Stop the oscillators once the fade has died away (~5 time constants).
      this.stopTimer = window.setTimeout(() => this.stopOscs(), RAMP * 5 * 1000 + 50);
    }
  }

  /** 0 … 1: the lowpass opens and the whine rises with the beam's heat. */
  setHeat(h: number): void {
    const k = Math.max(0, Math.min(1, h));
    if (Math.abs(k - this.heat) < 0.02) return;
    this.heat = k;
    const t = this.engine.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(CUT_COLD * Math.pow(CUT_HOT / CUT_COLD, k), t, 0.05);
    if (this.oscs[2]) this.oscs[2].frequency.setTargetAtTime(1760 + 880 * k, t, 0.05);
  }

  private startOscs(): void {
    const ctx = this.engine.ctx;
    const make = (type: OscillatorType, f: number, level: number): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = makeGain(ctx, level);
      o.connect(g).connect(this.filter);
      o.onended = () => {
        o.disconnect();
        g.disconnect();
      };
      o.start();
      return o;
    };
    this.oscs = [make('sawtooth', 110, 0.5), make('sawtooth', 110.7, 0.5), make('sine', 1760, 0.08)];
    this.heat = -1;
  }

  private stopOscs(): void {
    for (const o of this.oscs) o.stop();
    this.oscs = [];
  }

  dispose(): void {
    window.clearTimeout(this.stopTimer);
    this.stopOscs();
    this.filter.disconnect();
    this.out.disconnect();
  }
}
