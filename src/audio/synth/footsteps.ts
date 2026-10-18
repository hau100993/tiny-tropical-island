import { makeFilter, makeGain, type AudioEngine } from '../AudioEngine';

export type FootSurface = 'sand' | 'grass' | 'rock' | 'wood' | 'water' | 'snow';

/**
 * Footstep one-shots, synthesized per step (no samples). Each step is a few short noise bursts
 * and/or pitched blips with fast envelopes; every node stops itself and is disconnected when
 * it ends, so nothing accumulates. Random pitch/level and alternating left/right feet keep a
 * walk from sounding like a loop.
 *
 * - sand: soft low "thud" plus a few fine crunch grains;
 * - grass/forest floor: brighter rustle with leafy grains;
 * - rock: short hard tick;
 * - wood (porch, floor): hollow pitched knock + click;
 * - water: splash whose length and level grow with depth, plus a few droplets;
 * - snow: muffled squeaky crunch.
 */
export class Footsteps {
  private readonly out: GainNode;
  private foot = 1;

  constructor(private readonly engine: AudioEngine) {
    this.out = makeGain(engine.ctx, 0.6);
    // Direct bus: your own steps are not muffled by the snow-hush filter.
    this.out.connect(engine.direct);
  }

  /** strength: 0.4 (slow) … 1 (running); depth: water depth in meters. */
  play(surface: FootSurface, strength: number, depth: number): void {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime + 0.005;
    this.foot = -this.foot;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.foot * 0.12;
    pan.connect(this.out);
    window.setTimeout(() => pan.disconnect(), 1500);
    const v = strength * (0.8 + Math.random() * 0.4);
    const r = 0.9 + Math.random() * 0.2;
    const n = this.engine.noise;

    switch (surface) {
      case 'sand':
        this.burst(pan, n.pink, t, 'lowpass', 700 * r, 0.7, 0.012, 0.11, 0.9 * v);
        for (let i = 0; i < 4; i++) {
          this.burst(pan, n.white, t + 0.015 + Math.random() * 0.07, 'bandpass', (1800 + Math.random() * 1400) * r, 1.2, 0.002, 0.025, 0.12 * v);
        }
        break;
      case 'grass':
        this.burst(pan, n.pink, t, 'bandpass', 2600 * r, 0.6, 0.02, 0.14, 0.75 * v);
        this.burst(pan, n.brown, t, 'lowpass', 400, 0.7, 0.01, 0.06, 0.35 * v);
        for (let i = 0; i < 5; i++) {
          this.burst(pan, n.white, t + Math.random() * 0.12, 'bandpass', (3500 + Math.random() * 3000) * r, 2, 0.003, 0.02, 0.1 * v);
        }
        break;
      case 'rock':
        this.burst(pan, n.white, t, 'bandpass', 2400 * r, 1.4, 0.002, 0.035, 0.45 * v);
        this.burst(pan, n.pink, t, 'lowpass', 600, 0.7, 0.004, 0.05, 0.4 * v);
        break;
      case 'wood':
        this.blip(pan, 'sine', 150 * r, 85 * r, t, 0.1, 0.9 * v);
        this.blip(pan, 'triangle', 330 * r, 270 * r, t, 0.05, 0.22 * v);
        this.burst(pan, n.white, t, 'highpass', 2500, 0.7, 0.001, 0.015, 0.3 * v);
        break;
      case 'water': {
        const k = Math.min(1, depth / 0.9);
        this.burst(pan, n.white, t, 'bandpass', 700 * r, 0.9, 0.02, 0.2 + 0.25 * k, (0.45 + 0.45 * k) * v, 2600 * r);
        this.blip(pan, 'sine', 260 * r, 140 * r, t + 0.01, 0.12, 0.2 * v);
        for (let i = 0; i < 3; i++) {
          const f = 1200 + Math.random() * 1400;
          this.blip(pan, 'sine', f, f * 1.4, t + 0.1 + Math.random() * 0.3, 0.03, 0.06 * v);
        }
        break;
      }
      case 'snow':
        this.burst(pan, n.pink, t, 'bandpass', 1100 * r, 0.8, 0.03, 0.14, 0.7 * v);
        for (let i = 0; i < 7; i++) {
          this.burst(pan, n.white, t + 0.02 + Math.random() * 0.12, 'bandpass', (2600 + Math.random() * 1600) * r, 3, 0.002, 0.015, 0.12 * v);
        }
        break;
    }
  }

  /** Filtered noise burst: attack, then exponential decay. Optional filter sweep to `freqEnd`. */
  private burst(
    dest: AudioNode,
    buffer: AudioBuffer,
    t: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    attack: number,
    decay: number,
    gain: number,
    freqEnd?: number,
  ): void {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = makeFilter(ctx, type, freq, q);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 3);
    src.connect(f).connect(g).connect(dest);
    const length = attack + decay * 1.5;
    src.start(t, Math.random() * (buffer.duration - length - 0.1), length);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  /** Short pitched blip with a pitch glide (knocks, plops, droplets). */
  private blip(dest: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, decay: number, gain: number): void {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, decay / 3);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + decay * 1.6);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  dispose(): void {
    this.out.disconnect();
  }
}
