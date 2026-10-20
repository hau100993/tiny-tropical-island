import { loopNoise, makeFilter, makeGain, type AudioEngine } from '../AudioEngine';

/**
 * Surfing sounds, synthesized:
 *
 * - crash: a wave breaking somewhere near you, a one-shot: a deep rumble (brown noise through a
 *   falling lowpass) under a hiss of white water (pink noise, band-passed), swelling in for a
 *   quarter second and dying away over a few seconds;
 * - rush: while riding, the water tearing past the board (band-passed pink noise rising in pitch
 *   with speed) and the wind in your ears (high-passed white noise, growing with speed²).
 *
 * The rush only runs while you ride: its sources start on the first non-zero speed and stop
 * (after fading out) when it goes back to zero, so it costs nothing otherwise.
 */
export class SurfSound {
  private readonly out: GainNode;
  private rush: { sources: AudioBufferSourceNode[]; water: BiquadFilterNode; waterGain: GainNode; windGain: GainNode } | null = null;
  private stopTimer = 0;

  constructor(private readonly engine: AudioEngine) {
    this.out = makeGain(engine.ctx, 0.8);
    // Out in the open with the rest of the scene (muffled under water like everything else).
    this.out.connect(engine.ambience);
  }

  /** A wave breaking: `gain` 0..1 from its distance, `pan` −1 (left) … 1 (right). */
  crash(gain: number, pan: number): void {
    if (gain < 0.02) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime + 0.01;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan)) * 0.8;
    p.connect(this.out);
    const n = this.engine.noise;
    const r = 0.85 + Math.random() * 0.3;
    this.burst(p, n.brown, t, 'lowpass', 700 * r, 220 * r, 0.25, 3.2, 1.0 * gain);
    this.burst(p, n.pink, t + 0.05, 'bandpass', 1400 * r, 600 * r, 0.3, 2.4, 0.45 * gain);
    window.setTimeout(() => p.disconnect(), 6000);
  }

  /** Riding speed (m/s); 0 stops the rush. */
  setRush(speed: number): void {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    if (speed <= 0.05) {
      if (!this.rush) return;
      const r = this.rush;
      r.waterGain.gain.setTargetAtTime(0, t, 0.15);
      r.windGain.gain.setTargetAtTime(0, t, 0.15);
      if (!this.stopTimer) {
        this.stopTimer = window.setTimeout(() => {
          for (const s of r.sources) {
            s.stop();
            s.disconnect();
          }
          r.waterGain.disconnect();
          r.windGain.disconnect();
          if (this.rush === r) this.rush = null;
          this.stopTimer = 0;
        }, 900);
      }
      return;
    }
    if (this.stopTimer) {
      window.clearTimeout(this.stopTimer);
      this.stopTimer = 0;
    }
    if (!this.rush) this.rush = this.startRush();
    const r = this.rush;
    const k = Math.min(1, speed / 7);
    r.water.frequency.setTargetAtTime(500 + 900 * k, t, 0.1);
    r.waterGain.gain.setTargetAtTime(0.06 + 0.3 * k, t, 0.1);
    r.windGain.gain.setTargetAtTime(0.2 * k * k, t, 0.15);
  }

  private startRush(): NonNullable<SurfSound['rush']> {
    const ctx = this.engine.ctx;
    const n = this.engine.noise;
    const water = makeFilter(ctx, 'bandpass', 600, 0.9);
    const waterGain = makeGain(ctx, 0);
    water.connect(waterGain).connect(this.out);
    const wind = makeFilter(ctx, 'highpass', 2500, 0.5);
    const windGain = makeGain(ctx, 0);
    wind.connect(windGain).connect(this.out);
    return { sources: [loopNoise(ctx, n.pink, water), loopNoise(ctx, n.white, wind)], water, waterGain, windGain };
  }

  /** A filtered noise burst: swells in over `attack`, decays over `decay` while the filter falls. */
  private burst(
    dest: AudioNode,
    buffer: AudioBuffer,
    t: number,
    type: BiquadFilterType,
    freq: number,
    freqEnd: number,
    attack: number,
    decay: number,
    gain: number,
  ): void {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = makeFilter(ctx, type, freq, 0.7);
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 3);
    src.connect(f).connect(g).connect(dest);
    const length = attack + decay * 1.5;
    src.start(t, Math.random() * Math.max(0, buffer.duration - length - 0.1), length);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }
}
