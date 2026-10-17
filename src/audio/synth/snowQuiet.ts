import { BaseLayer, stopAll } from '../Layer';
import { chain, loopNoise, makeFilter, makeGain, type AudioEngine } from '../AudioEngine';

/**
 * "Snow quiet": the hushed feeling of a snowy landscape. Very soft deep rumble plus a faint
 * airy hiss. The muffling of the *other* sounds is done by the engine's ambience lowpass
 * (driven by the mixer from this layer's level); this layer itself bypasses that filter.
 */
export class SnowQuietLayer extends BaseLayer {
  private nodes: AudioNode[] = [];

  constructor(engine: AudioEngine) {
    super(engine, 'snow', engine.direct, 0.3);
  }

  protected startNodes(): void {
    const { ctx, noise } = this.engine;
    const lowFilter = makeFilter(ctx, 'lowpass', 170, 0.4);
    const lowGain = makeGain(ctx, 0.6);
    chain(lowFilter, lowGain, this.output);
    const low = loopNoise(ctx, noise.brown, lowFilter);

    const airFilter = makeFilter(ctx, 'bandpass', 5200, 0.4);
    const airGain = makeGain(ctx, 0.035);
    chain(airFilter, airGain, this.output);
    const air = loopNoise(ctx, noise.pink, airFilter);

    this.nodes.push(low, lowFilter, lowGain, air, airFilter, airGain);
  }

  protected stopNodes(): void {
    stopAll(this.nodes);
  }
}
