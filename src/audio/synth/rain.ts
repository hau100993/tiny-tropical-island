import { BaseLayer, stopAll } from '../Layer';
import { chain, loopNoise, makeFilter, makeGain, type AudioEngine } from '../AudioEngine';

/**
 * Rain without any scheduling:
 * - hiss: band-limited pink noise (the wall of countless distant drops),
 * - patter: two pre-rendered droplet loops of different lengths (5.0 s and 7.3 s), so the
 *   combined pattern only repeats every ~365 s,
 * - body: a little low rumble for weight.
 */
export class RainLayer extends BaseLayer {
  private nodes: AudioNode[] = [];

  constructor(engine: AudioEngine) {
    super(engine, 'rain', engine.ambience, 1.4);
  }

  protected startNodes(): void {
    const { ctx, noise } = this.engine;
    const hp = makeFilter(ctx, 'highpass', 450, 0.5);
    const lp = makeFilter(ctx, 'lowpass', 7000, 0.5);
    const hissGain = makeGain(ctx, 0.55);
    chain(hp, lp, hissGain, this.output);
    const hiss = loopNoise(ctx, noise.pink, hp);

    const patterGain = makeGain(ctx, 0.45);
    patterGain.connect(this.output);
    const a = loopNoise(ctx, noise.dropletsA, patterGain);
    const b = loopNoise(ctx, noise.dropletsB, patterGain);

    const rumbleFilter = makeFilter(ctx, 'lowpass', 180, 0.5);
    const rumbleGain = makeGain(ctx, 0.3);
    chain(rumbleFilter, rumbleGain, this.output);
    const rumble = loopNoise(ctx, noise.brown, rumbleFilter);

    this.nodes.push(hiss, hp, lp, hissGain, a, b, patterGain, rumble, rumbleFilter, rumbleGain);
  }

  protected stopNodes(): void {
    stopAll(this.nodes);
  }
}
