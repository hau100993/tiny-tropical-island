import { makeFilter, makeGain, type AudioEngine } from '../AudioEngine';
import { comboNote } from './huntNotes';

/**
 * The big sounds of the creatures' skills (no samples): `boom` (a blast: a falling sine thump
 * and a roar of brown noise), `thunder` (a sharp crack, then a long rolling rumble), `zap`
 * (electric crackle: a buzzing sawtooth jumping in pitch, with snaps), `whoosh` (a gust:
 * swept band-passed noise), `splash` (a burst of water: noise falling from bright to dull, with
 * droplets), `charge` (a power-up swell rising in pitch), `sonic` (a huge bark with an echo),
 * and the manta's: `frost` (the breath, 4.5 s: a soft thump, a cold roar sweeping up, a glassy
 * chord and tinkles, the crackle of the sea freezing),
 * `starfall` (high falling glides over a soft whoosh, then a twinkle), `aurora` (a slow
 * shimmering chord), `scrape` (one stroke of ice under a gliding body), `crack` (ice
 * spikes bursting up: a sharp snap, a dull knock and the falling "pew" of a frozen lake cracking),
 * `shatter` (a crystal breaking: glassy
 * tinkles falling), and Săn Bong Bóng's: `laser` (the frost laser's flash: a glassy FM "pew"
 * falling 2.4 kHz → 600 Hz over a tick of noise) and `bubblePop` (a bubble burst: a pop and a
 * glass chime on the combo's pentatonic step, `size` × 10 = the combo).
 */
export type SkillSound = 'boom' | 'thunder' | 'zap' | 'whoosh' | 'splash' | 'charge' | 'sonic' | 'frost' | 'starfall' | 'aurora' | 'scrape' | 'crack' | 'shatter' | 'surge' | 'breach' | 'gate' | 'perfect' | 'course' | 'fizzle' | 'laser' | 'bubblePop';

/** Ring `size` × 16 of a course: its note, a step up a pentatonic scale from C5 per ring. */
function gateNote(size: number): number {
  const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
  return 523.25 * Math.pow(2, steps[Math.min(steps.length - 1, Math.round(size * 16))] / 12);
}

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
    // Long enough for the longest (the frost breath and its tail).
    window.setTimeout(() => p.disconnect(), 9000);
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
      case 'frost': {
        // The breath, as long as it blows (4.5 s at full size). Not just a hiss (that drowns in
        // the waves and the wind): a soft "whumpf" as it starts, a cold rushing roar sweeping
        // upward and held, frost hissing on top, a glassy chord ringing out, bright tinkles and
        // the crackle of the sea setting.
        const dur = 1.5 + 3 * s;
        this.tone(p, 'sine', 170, 55, t, 0.35, 0.55 * gain);
        this.noise(p, n.brown, t, 'lowpass', 900, 200, 0.01, 0.35, 0.5 * gain);
        this.noise(p, n.pink, t, 'bandpass', 500, 2600, 0.12, 0.7, 1.7 * gain, 0.9, dur - 0.7);
        this.noise(p, n.white, t + 0.1, 'highpass', 3500, 7000, 0.3, 0.8, 0.45 * gain, 0.6, dur - 1);
        // E6, A6, E7, a touch detuned: swelling in, then ringing on through the breath.
        for (const f of [1318.5, 1760, 2637]) {
          this.tone(p, 'triangle', f, f * 1.004, t + 0.15, 0.8, 0.07 * gain, true);
          this.tone(p, 'sine', f * 1.004, f, t + 0.95, dur - 0.5, 0.07 * gain);
        }
        for (let i = 0; i < 10 + 8 * s; i++) this.tone(p, 'sine', 2500 + Math.random() * 3500, 2300 + Math.random() * 3000, t + 0.2 + Math.random() * dur, 0.3, 0.12 * gain);
        for (let i = 0; i < 8 + 6 * s; i++) this.noise(p, n.white, t + 0.3 + Math.random() * dur, 'bandpass', 1800 + Math.random() * 1800, 1000, 0.002, 0.05, 0.45 * gain, 4);
        break;
      }
      case 'starfall':
        // A few stars streaking down (falling whistles), the air behind them, a twinkle at the end.
        for (let i = 0; i < 3; i++) {
          const d = i * (0.35 + 0.2 * Math.random());
          this.tone(p, 'sine', 2200 + Math.random() * 900, 500 + Math.random() * 300, t + d, 1.1, 0.07 * gain);
        }
        this.noise(p, n.pink, t, 'bandpass', 2400, 500, 0.3, 1.2 + s, 0.35 * gain, 1.2);
        for (let i = 0; i < 10; i++) this.tone(p, 'triangle', 1800 + Math.random() * 2400, 1700 + Math.random() * 2400, t + 1 + Math.random() * (1 + s), 0.25, 0.05 * gain);
        break;
      case 'aurora':
        // A shimmering chord (C E G C E, a little detuned for the shimmer), swelling slowly.
        for (const f of [523.25, 659.25, 783.99, 1046.5, 1318.5]) {
          this.tone(p, 'sine', f, f * 1.003, t, 0.9 + 0.6 * s, 0.06 * gain, true);
          this.tone(p, 'sine', f * 1.004, f, t + 0.9 + 0.6 * s, 2 + 1.5 * s, 0.06 * gain);
        }
        this.noise(p, n.white, t, 'highpass', 6000, 9000, 0.9, 2 + s, 0.08 * gain);
        break;
      case 'crack':
        this.noise(p, n.white, t, 'highpass', 2200, 1200, 0.001, 0.06 + 0.05 * s, 0.7 * gain);
        this.noise(p, n.brown, t, 'lowpass', 500, 150, 0.003, 0.15 + 0.1 * s, 0.7 * gain);
        for (let i = 0; i < 3; i++) this.noise(p, n.white, t + 0.02 + Math.random() * 0.15, 'bandpass', 2500 + Math.random() * 2000, 1500, 0.001, 0.03, 0.35 * gain, 3);
        // The frozen-lake "pew": a quick falling whistle (high notes travel faster through ice),
        // and its fainter echo.
        this.tone(p, 'sine', 4200, 650, t + 0.01, 0.14, 0.3 * gain);
        this.tone(p, 'sine', 3600, 600, t + 0.09, 0.12, 0.14 * gain);
        break;
      case 'shatter':
        this.noise(p, n.white, t, 'bandpass', 4000, 2500, 0.002, 0.12, 0.5 * gain, 2);
        for (let i = 0; i < 5 + 4 * s; i++) this.tone(p, 'sine', 3000 + Math.random() * 3500, 2600 + Math.random() * 3000, t + Math.random() * 0.4, 0.15, 0.15 * gain);
        break;
      case 'surge': {
        // The sea stirring before the manta breaks out (2.2 s): a deep rumble swelling up, the
        // water churning louder, bubbles bursting faster and faster, rising in pitch.
        const dur = 1.6 + 0.6 * s;
        this.tone(p, 'sine', 48, 72, t, dur, 0.55 * gain, true);
        this.noise(p, n.brown, t, 'lowpass', 140, 480, dur, 0.5, 1.1 * gain);
        this.noise(p, n.pink, t + 0.3, 'bandpass', 350, 1100, dur - 0.3, 0.4, 0.45 * gain, 1.2);
        for (let i = 0; i < 18 + 14 * s; i++) {
          // Later ones more often (√ of a uniform crowds them toward the end).
          const at = t + Math.sqrt(Math.random()) * dur;
          const f = 160 + Math.random() * 420;
          this.tone(p, 'sine', f, f * 1.7, at, 0.07, 0.1 * gain);
        }
        break;
      }
      case 'breach':
        // Out of the sea: a thump, a great rushing roar of water torn up, the sheet of it
        // pouring off, and the crown raining back down a moment later (a patter of drops).
        this.tone(p, 'sine', 130, 38, t, 0.6, 0.8 * gain);
        this.noise(p, n.white, t, 'lowpass', 7000, 900, 0.02, 1.3 + 0.6 * s, 0.85 * gain);
        this.noise(p, n.brown, t, 'lowpass', 700, 110, 0.01, 0.9 + 0.5 * s, 0.9 * gain);
        this.noise(p, n.pink, t + 0.15, 'bandpass', 1500, 600, 0.1, 1.2, 0.35 * gain, 0.8, 0.4);
        for (let i = 0; i < 30 + 20 * s; i++) this.noise(p, n.white, t + 1.4 + Math.random() * 1.4, 'bandpass', 2500 + Math.random() * 3000, 1800, 0.002, 0.04, 0.18 * gain, 2);
        for (let i = 0; i < 12; i++) this.tone(p, 'sine', 700 + Math.random() * 900, 380 + Math.random() * 250, t + 1.4 + Math.random() * 1.3, 0.05, 0.07 * gain);
        break;
      case 'gate': {
        // A ring flown through (`size` = ring / 16), in layers: the air rushing past the frame,
        // the ice snapping (a crisp crack over a low thump for weight), a glassy bell on the
        // ring's note (a step up a pentatonic scale each ring, so a run climbs like a tune),
        // its octave shimmering, and the shards tinkling down after it.
        const f = gateNote(s);
        this.noise(p, n.pink, t, 'bandpass', 600, 2800, 0.1, 0.35, 0.45 * gain, 1.6);
        this.noise(p, n.white, t, 'highpass', 4500, 2500, 0.001, 0.06, 0.55 * gain);
        this.noise(p, n.white, t + 0.01, 'bandpass', 3200, 1800, 0.002, 0.12, 0.3 * gain, 2);
        this.tone(p, 'sine', 150, 50, t, 0.22, 0.4 * gain);
        this.bell(p, f, t + 0.015, 1.5, 0.2 * gain);
        this.bell(p, f * 2, t + 0.05, 0.9, 0.06 * gain);
        for (let i = 0; i < 14; i++) {
          // Little glass pings falling away: high, inharmonic, quieter and sparser as they go.
          const at = t + 0.06 + i * 0.035 + Math.random() * 0.05;
          const pf = 2600 + Math.random() * 3800;
          this.tone(p, 'sine', pf, pf * 0.97, at, 0.09, 0.08 * gain * (1 - i / 16));
        }
        break;
      }
      case 'perfect': {
        // Right through the middle: a quick sparkling run up from the ring's note, and a shimmer.
        const f = gateNote(s) * 2;
        [0, 4, 7, 12].forEach((st, i) => this.bell(p, f * Math.pow(2, st / 12), t + 0.08 + i * 0.055, 0.6, 0.06 * gain));
        this.noise(p, n.white, t + 0.08, 'highpass', 7000, 10000, 0.05, 0.6, 0.08 * gain);
        break;
      }
      case 'course':
        // The whole course: a rising arpeggio to a held, shimmering chord.
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
          this.tone(p, 'triangle', f, f, t + i * 0.09, 0.5, 0.12 * gain);
          this.tone(p, 'sine', f, f * 1.003, t + 0.5, 1.8, 0.07 * gain);
        });
        this.noise(p, n.white, t + 0.4, 'highpass', 6000, 9000, 0.3, 1.6, 0.1 * gain);
        break;
      case 'laser': {
        // The flash: an FM sine sweeping down (the 3.5× modulator makes it glassy), a tick of noise.
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(2400, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.12);
        const mod = ctx.createOscillator();
        mod.frequency.setValueAtTime(2400 * 3.5, t);
        mod.frequency.exponentialRampToValueAtTime(600 * 3.5, t + 0.12);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(1200, t);
        depth.gain.exponentialRampToValueAtTime(40, t + 0.12);
        mod.connect(depth).connect(osc.frequency);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.16 * gain, t + 0.004);
        g.gain.setTargetAtTime(0, t + 0.02, 0.04);
        osc.connect(g).connect(p);
        osc.start(t);
        mod.start(t);
        osc.stop(t + 0.25);
        mod.stop(t + 0.25);
        osc.onended = () => {
          osc.disconnect();
          mod.disconnect();
          depth.disconnect();
          g.disconnect();
        };
        this.noise(p, n.white, t, 'highpass', 5000, 3000, 0.001, 0.01, 0.2 * gain);
        break;
      }
      case 'bubblePop': {
        // The film snapping (a sine dropping an octave in 50 ms over a click), then a glass chime
        // a step up the pentatonic scale per combo, so a chain of bursts plays a tune.
        const f0 = 700 + Math.random() * 120;
        this.tone(p, 'sine', f0, f0 * 0.5, t, 0.05, 0.22 * gain);
        this.noise(p, n.white, t, 'highpass', 2500, 2500, 0.001, 0.015, 0.14 * gain);
        const f = comboNote(s * 10);
        this.bell(p, f, t + 0.02, 0.35, 0.09 * gain);
        this.bell(p, f * 2, t + 0.04, 0.2, 0.025 * gain);
        break;
      }
      case 'fizzle':
        // Out of time: a soft falling chime and the rings melting with a hiss.
        [784, 659.25, 523.25].forEach((f, i) => this.tone(p, 'sine', f, f * 0.98, t + i * 0.16, 0.5, 0.1 * gain));
        this.noise(p, n.pink, t, 'bandpass', 2500, 900, 0.2, 1.2, 0.2 * gain, 1);
        break;
      case 'scrape':
        // Ice under a gliding body: a short bright scrape, its pitch a little random.
        this.noise(p, n.white, t, 'bandpass', 3000 + Math.random() * 1500, 1800, 0.02, 0.18 + 0.2 * s, 1.0 * gain, 2.5);
        this.noise(p, n.brown, t, 'lowpass', 350, 200, 0.03, 0.25, 0.25 * gain);
        break;
    }
  }

  /**
   * A glassy bell (FM: a carrier modulated at 3.5× its pitch gives the inharmonic partials of
   * glass or ice; the modulation fades, so the strike is bright and the ring-out pure).
   */
  private bell(dest: AudioNode, f: number, t: number, dur: number, gain: number): void {
    const ctx = this.engine.ctx;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * 2, t);
    depth.gain.exponentialRampToValueAtTime(f * 0.03, t + dur);
    mod.connect(depth).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, dur / 4);
    car.connect(g).connect(dest);
    car.start(t);
    mod.start(t);
    car.stop(t + dur * 1.6);
    mod.stop(t + dur * 1.6);
    car.onended = () => {
      car.disconnect();
      mod.disconnect();
      depth.disconnect();
      g.disconnect();
    };
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
   * Filtered noise: attack, then held for `hold` s, then decay; the filter swept f0 → f1 over
   * all of it. `q` is the filter's resonance.
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
    hold = 0,
  ): void {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = makeFilter(ctx, type, f0, q);
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + attack + hold + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.setTargetAtTime(0, t + attack + hold, decay / 3);
    src.connect(f).connect(g).connect(dest);
    const length = Math.min(buffer.duration - 0.1, attack + hold + decay * 1.5);
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
