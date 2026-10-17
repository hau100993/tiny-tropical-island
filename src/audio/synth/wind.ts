import { BaseLayer, stopAll } from '../Layer';
import { chain, loopNoise, makeFilter, makeGain, type AudioEngine } from '../AudioEngine';
import type { ScheduleFn } from '../scheduler';

const GUST_STEP = 0.6;

/**
 * Wind in the palms:
 * - body: pink noise through a resonant bandpass whose pitch and level rise with each gust,
 * - rustle: high-passed noise for leaves, which only comes alive in stronger gusts.
 * Gusts are a smoothed random walk scheduled ahead on the audio clock.
 * (Phase 3 will drive gusts from the shared weather state so they match the swaying palms.)
 */
export class WindLayer extends BaseLayer {
  private nodes: AudioNode[] = [];
  private bodyFilter: BiquadFilterNode | null = null;
  private bodyGain: GainNode | null = null;
  private rustleGain: GainNode | null = null;
  private nextStep = 0;
  private gust = 0.4;
  private readonly schedule: ScheduleFn = (until) => this.scheduleGusts(until);

  constructor(engine: AudioEngine) {
    super(engine, 'wind', engine.ambience, 1.7);
  }

  protected startNodes(): void {
    const { ctx, noise } = this.engine;
    this.bodyFilter = makeFilter(ctx, 'bandpass', 600, 1.1);
    this.bodyGain = makeGain(ctx, 0.5);
    chain(this.bodyFilter, this.bodyGain, this.output);
    const body = loopNoise(ctx, noise.pink, this.bodyFilter);

    const rustleFilter = makeFilter(ctx, 'highpass', 3200, 0.5);
    this.rustleGain = makeGain(ctx, 0.05);
    chain(rustleFilter, this.rustleGain, this.output);
    const rustle = loopNoise(ctx, noise.white, rustleFilter);

    this.nodes.push(body, this.bodyFilter, this.bodyGain, rustle, rustleFilter, this.rustleGain);
    this.nextStep = this.engine.now;
    this.engine.scheduler.add(this.schedule);
  }

  private scheduleGusts(until: number): void {
    if (!this.bodyFilter || !this.bodyGain || !this.rustleGain) return;
    while (this.nextStep < until) {
      // Random walk pulled back toward a calm-ish mean, so gusts come and go.
      this.gust += (Math.random() - 0.5) * 0.3 + (0.45 - this.gust) * 0.08;
      this.gust = Math.min(1, Math.max(0.05, this.gust));
      const g = this.gust;
      const t = this.nextStep;
      this.bodyFilter.frequency.setTargetAtTime(320 + 900 * g, t, GUST_STEP * 0.8);
      this.bodyGain.gain.setTargetAtTime(0.25 + 0.75 * g, t, GUST_STEP * 0.8);
      this.rustleGain.gain.setTargetAtTime(0.02 + 0.22 * g * g, t, GUST_STEP * 0.5);
      this.nextStep = t + GUST_STEP;
    }
  }

  protected stopNodes(): void {
    this.engine.scheduler.remove(this.schedule);
    stopAll(this.nodes);
    this.bodyFilter = null;
    this.bodyGain = null;
    this.rustleGain = null;
  }
}
