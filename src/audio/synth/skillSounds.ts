import { makeFilter, makeGain, type AudioEngine } from '../AudioEngine';

/**
 * The big sounds of the creatures' skills (no samples): `boom` (a blast: a falling sine thump
 * and a roar of brown noise), `thunder` (a sharp crack, then a long rolling rumble), `zap`
 * (electric crackle: a buzzing sawtooth jumping in pitch, with snaps), `whoosh` (a gust:
 * swept band-passed noise), `splash` (a burst of water: noise falling from bright to dull, with
 * droplets), `charge` (a power-up swell rising in pitch), `sonic` (a huge bark with an echo).
 */
export type SkillSound = 'boom' | 'thunder' | 'zap' | 'whoosh' | 'splash' | 'charge' | 'sonic';

/**
 * One-shots on the direct bus; every node stops and disconnects itself. `size` 0..1 scales
 * length and depth, `gain` includes the distance, `pan` −1 … 1.
 */
export class SkillSounds {
  private readonly out: GainNode;

  constructor(private readonly engine: AudioEngine) {
    this.out = makeGain(engine.ctx, 0.7);
    this.out.connect(engine.direct);
  }

  play(kind: SkillSound, size: number, gain: number, pan: number): void {
    const ctx = this.engine.ctx;
    const t = ctx.currentTime + 0.01;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan)) * 0.8;
    p.connect(this.out);
    const s = Math.max(0, Math.min(1, size));
    window.setTimeout(() => p.disconnect(), 6000);
    const n = this.engine.noise;
    switch (kind) {
      case 'boom':
        this.tone(p, 'sine', 90 + 40 * (1 - s), 32, t, 0.5 + 0.6 * s, 0.9 * gain);
        this.noise(p, n.brown, t, 'lowpass', 900, 120, 0.01, 0.6 + 1.2 * s, 0.8 * gain);
        this.noise(p, n.white, t, 'bandpass', 2400, 800, 0.002, 0.12, 0.25 * gain);
        break;
      case 'thunder':
        this.noise(p, n.white, t, 'highpass', 1800, 900, 0.002, 0.18, 0.7 * gain);
        this.noise(p, n.brown, t + 0.05, 'lowpass', 500, 90, 0.08, 1.5 + 2 * s, 0.9 * gain);
        for (let i = 0; i < 4; i++) this.noise(p, n.brown, t + 0.3 + Math.random() * (1 + s), 'lowpass', 300, 80, 0.1, 0.6, 0.35 * gain);
        break;
      case 'zap': {
        const dur = 0.25 + 0.6 * s;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        // Jumping pitch: a new random note every 25 ms, like an arc that won't settle.
        for (let k = 0; k * 0.025 < dur; k++) osc.frequency.setValueAtTime(120 + Math.random() * 380, t + k * 0.025);
        const f = makeFilter(ctx, 'bandpass', 1800, 1.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.28 * gain, t + 0.01);
        g.gain.setTargetAtTime(0, t + dur, 0.05);
        osc.connect(f).connect(g).connect(p);
        osc.start(t);
        osc.stop(t + dur + 0.3);
        osc.onended = () => {
          osc.disconnect();
          f.disconnect();
          g.disconnect();
        };
        for (let i = 0; i < 6 + 10 * s; i++) this.noise(p, n.white, t + Math.random() * dur, 'highpass', 3500, 3500, 0.001, 0.015, 0.35 * gain);
        break;
      }
      case 'whoosh':
        this.noise(p, n.pink, t, 'bandpass', 300, 1800, 0.25 + 0.3 * s, 0.6 + 0.8 * s, 0.7 * gain, 1.2);
        break;
      case 'splash':
        this.noise(p, n.white, t, 'lowpass', 5000, 700, 0.01, 0.5 + 0.9 * s, 0.6 * gain);
        this.noise(p, n.brown, t, 'lowpass', 400, 120, 0.02, 0.5 + 0.5 * s, 0.6 * gain);
        for (let i = 0; i < 10; i++) this.tone(p, 'sine', 900 + Math.random() * 1200, 400 + Math.random() * 300, t + 0.2 + Math.random() * (0.6 + s), 0.05, 0.08 * gain);
        break;
      case 'charge':
        this.tone(p, 'triangle', 180, 900 + 600 * s, t, 0.5 + 0.6 * s, 0.22 * gain, true);
        this.noise(p, n.pink, t, 'bandpass', 500, 4000, 0.4 + 0.5 * s, 0.15, 0.25 * gain, 2);
        break;
      case 'sonic':
        // A big low "WOOF", then its echo off the island.
        for (const [d, k] of [[0, 1], [0.32, 0.35], [0.6, 0.15]] as const) {
          this.tone(p, 'sawtooth', 300, 140, t + d, 0.35, 0.45 * gain * k);
          this.noise(p, n.pink, t + d, 'bandpass', 700, 300, 0.01, 0.3, 0.35 * gain * k);
        }
        this.tone(p, 'sine', 70, 35, t, 0.7, 0.6 * gain);
        break;
    }
  }

  /** A tone gliding f0 → f1 over `dur` s; `swell`: rising to its peak at the end instead of at once. */
  private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, gain: number, swell = false): void {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    if (swell) {
      g.gain.linearRampToValueAtTime(gain, t + dur);
      g.gain.setTargetAtTime(0, t + dur, 0.04);
    } else {
      g.gain.linearRampToValueAtTime(gain, t + 0.005);
      g.gain.setTargetAtTime(0, t + 0.005, dur / 3);
    }
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur * 1.8 + 0.1);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  /**
   * Filtered noise: attack, then decay; the filter swept f0 → f1 over the decay. `swell`: the
   * attack is the long part (a rise), `q` the filter's resonance.
   */
  private noise(
    dest: AudioNode,
    buffer: AudioBuffer,
    t: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    attack: number,
    decay: number,
    gain: number,
    q = 0.7,
  ): void {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = makeFilter(ctx, type, f0, q);
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay / 3);
    src.connect(f).connect(g).connect(dest);
    const length = Math.min(buffer.duration - 0.1, attack + decay * 1.5);
    src.start(t, Math.random() * Math.max(0, buffer.duration - length - 0.1), length);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  dispose(): void {
    this.out.disconnect();
  }
}
