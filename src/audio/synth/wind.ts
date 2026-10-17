import { BaseLayer, stopAll } from '../Layer';
import { chain, loopNoise, makeFilter, makeGain, type AudioEngine } from '../AudioEngine';
import type { ScheduleFn } from '../scheduler';
import { gustShape, wallSeconds } from '../../weather/wind';

const GUST_STEP = 0.4;

/**
 * Wind in the palms:
 * - body: pink noise through a resonant bandpass whose pitch and level rise with each gust,
 * - rustle: high-passed noise for leaves, which only comes alive in stronger gusts.
 * Gusts come from gustShape(t), the same function that bends the palms on screen. Future
 * audio times are mapped to wall-clock time, so scheduled gusts match what will be seen.
 */
export class WindLayer extends BaseLayer {
  private nodes: AudioNode[] = [];
  private bodyFilter: BiquadFilterNode | null = null;
  private bodyGain: GainNode | null = null;
  private rustleGain: GainNode | null = null;
  private nextStep = 0;
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
    const wallOffset = wallSeconds() - this.engine.now;
    while (this.nextStep < until) {
      const t = this.nextStep;
      const g = gustShape(t + wallOffset);
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
