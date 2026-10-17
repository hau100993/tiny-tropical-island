import { BaseLayer, stopAll } from '../Layer';
import { chain, loopNoise, makeFilter, makeGain, type AudioEngine } from '../AudioEngine';
import type { ScheduleFn } from '../scheduler';

/**
 * Ocean surf from filtered noise:
 * - bed: brown noise through a low lowpass (constant distant rumble),
 * - surf: pink noise whose gain and brightness swell and break every 6–10 s,
 * - wash: band-passed white noise hissing as each wave runs up the sand and recedes.
 * Swells are scheduled on the audio clock with random timing, so they never sound looped.
 */
export class WavesLayer extends BaseLayer {
  private nodes: AudioNode[] = [];
  private surfGain: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;
  private washGain: GainNode | null = null;
  private nextSwell = 0;
  private seaState = 0.45;
  private readonly schedule: ScheduleFn = (until) => this.scheduleSwells(until);

  constructor(engine: AudioEngine) {
    super(engine, 'waves', engine.ambience, 0.75);
  }

  /** 0 = glassy sea (soft, slow swells) … 1 = storm (loud, frequent breakers). */
  setSeaState(value: number): void {
    this.seaState = value;
  }

  protected startNodes(): void {
    const { ctx, noise } = this.engine;
    const bedFilter = makeFilter(ctx, 'lowpass', 320, 0.5);
    const bedGain = makeGain(ctx, 0.55);
    chain(bedFilter, bedGain, this.output);
    const bed = loopNoise(ctx, noise.brown, bedFilter);

    this.surfFilter = makeFilter(ctx, 'lowpass', 500, 0.6);
    this.surfGain = makeGain(ctx, 0.12);
    chain(this.surfFilter, this.surfGain, this.output);
    const surf = loopNoise(ctx, noise.pink, this.surfFilter);

    const washFilter = makeFilter(ctx, 'bandpass', 2800, 0.6);
    this.washGain = makeGain(ctx, 0);
    chain(washFilter, this.washGain, this.output);
    const wash = loopNoise(ctx, noise.white, washFilter);

    this.nodes.push(bed, bedFilter, bedGain, surf, this.surfFilter, this.surfGain, wash, washFilter, this.washGain);
    this.nextSwell = this.engine.now + 0.5;
    this.engine.scheduler.add(this.schedule);
  }

  private scheduleSwells(until: number): void {
    if (!this.surfGain || !this.surfFilter || !this.washGain) return;
    while (this.nextSwell < until) {
      const t = this.nextSwell;
      const s = this.seaState;
      const peak = (0.3 + 0.7 * s) * (0.75 + Math.random() * 0.5);
      const rise = 1.6 + Math.random() * 1.2;
      // Swell builds, breaks, then the water rushes up the beach and drains away.
      this.surfGain.gain.setTargetAtTime(peak, t, rise / 3);
      this.surfFilter.frequency.setTargetAtTime(700 + 2200 * s * peak, t, rise / 3);
      const brk = t + rise;
      this.surfGain.gain.setTargetAtTime(0.1 + 0.1 * s, brk, 1.4);
      this.surfFilter.frequency.setTargetAtTime(450, brk, 1.6);
      this.washGain.gain.setTargetAtTime(0.35 * peak, brk - 0.2, 0.25);
      this.washGain.gain.setTargetAtTime(0, brk + 0.8, 1.1);
      const period = 9 - 3.5 * s + (Math.random() - 0.5) * 3;
      this.nextSwell = t + Math.max(3.5, period);
    }
  }

  protected stopNodes(): void {
    this.engine.scheduler.remove(this.schedule);
    stopAll(this.nodes);
    this.surfGain = null;
    this.surfFilter = null;
    this.washGain = null;
  }
}
