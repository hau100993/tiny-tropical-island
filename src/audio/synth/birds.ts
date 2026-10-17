import { BaseLayer } from '../Layer';
import type { AudioEngine } from '../AudioEngine';
import type { ScheduleFn } from '../scheduler';

type Species = 'tweet' | 'trill' | 'whistle' | 'chirpUp' | 'warble';
const SPECIES: readonly Species[] = ['tweet', 'trill', 'whistle', 'chirpUp', 'warble'];
/** Average bird calls per second at density 1 (daytime). */
const CALLS_PER_SECOND = 0.45;

/**
 * Birdsong from short randomized oscillator calls. Each "bird" has a species, a stereo
 * position and a loudness (near/far), and repeats its call a few times like real birds do.
 * Calls are one-shot nodes scheduled ahead on the audio clock; they free themselves on end.
 */
export class BirdsLayer extends BaseLayer {
  private readonly active = new Set<AudioScheduledSourceNode>();
  private nextCall = 0;
  private density = 1;
  private readonly schedule: ScheduleFn = (until) => this.scheduleCalls(until);

  constructor(engine: AudioEngine) {
    super(engine, 'birds', engine.ambience, 3.5);
  }

  /** 1 = lively day, ~0.1 = quiet night (Phase 4). */
  setDensity(density: number): void {
    this.density = density;
  }

  protected startNodes(): void {
    this.nextCall = this.engine.now + 0.3;
    this.engine.scheduler.add(this.schedule);
  }

  private scheduleCalls(until: number): void {
    while (this.nextCall < until) {
      const species = SPECIES[Math.floor(Math.random() * SPECIES.length)];
      const pan = Math.random() * 1.6 - 0.8;
      const gain = 0.25 + Math.random() * 0.75;
      const pitch = 0.85 + Math.random() * 0.3;
      const repeats = 1 + Math.floor(Math.random() * 3);
      let t = this.nextCall;
      for (let r = 0; r < repeats; r++) {
        t += this.call(species, t, pan, gain, pitch) + 0.6 + Math.random() * 1.4;
      }
      // Exponential gaps (a Poisson process) sound natural: sometimes busy, sometimes quiet.
      const rate = Math.max(0.02, CALLS_PER_SECOND * this.density);
      this.nextCall = t + Math.max(0.2, -Math.log(1 - Math.random()) / rate);
    }
  }

  /** Schedules one call at time t; returns its duration in seconds. */
  private call(species: Species, t: number, pan: number, gain: number, pitch: number): number {
    switch (species) {
      case 'tweet': {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) this.note(t + i * 0.13, 0.07, 4200 * pitch, 2600 * pitch, gain, pan);
        return n * 0.13;
      }
      case 'chirpUp':
        for (let i = 0; i < 3; i++) this.note(t + i * 0.11, 0.06, 2200 * pitch, 4200 * pitch, gain * 0.8, pan);
        return 0.33;
      case 'whistle':
        this.note(t, 0.26, 1700 * pitch, 2300 * pitch, gain, pan);
        this.note(t + 0.3, 0.22, 2300 * pitch, 1950 * pitch, gain * 0.9, pan);
        return 0.52;
      case 'trill':
        this.note(t, 0.45, 3200 * pitch, 3000 * pitch, gain * 0.7, pan, 26);
        return 0.45;
      case 'warble':
        this.note(t, 0.6, 2600 * pitch, 2800 * pitch, gain * 0.7, pan, 0, 9);
        return 0.6;
    }
  }

  /**
   * One note: sine sweeping f0 → f1 with a short attack/decay envelope.
   * `tremoloHz` adds amplitude flutter (trills); `vibratoHz` adds pitch wobble (warbles).
   */
  private note(t: number, dur: number, f0: number, f1: number, gain: number, pan: number, tremoloHz = 0, vibratoHz = 0): void {
    const { ctx } = this.engine;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.18 * gain, t + Math.min(0.015, dur * 0.2));
    env.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.15);

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(env).connect(panner).connect(this.output);

    const extras: OscillatorNode[] = [];
    if (tremoloHz > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = tremoloHz;
      const depth = ctx.createGain();
      depth.gain.value = 0.09 * gain;
      lfo.connect(depth).connect(env.gain);
      extras.push(lfo);
    }
    if (vibratoHz > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = vibratoHz;
      const depth = ctx.createGain();
      depth.gain.value = 350;
      lfo.connect(depth).connect(osc.frequency);
      extras.push(lfo);
    }

    const end = t + dur + 0.2;
    for (const src of [osc, ...extras]) {
      src.start(t);
      src.stop(end);
      this.active.add(src);
      src.onended = () => {
        this.active.delete(src);
        src.disconnect();
      };
    }
    osc.addEventListener('ended', () => {
      env.disconnect();
      panner.disconnect();
    });
  }

  protected stopNodes(): void {
    this.engine.scheduler.remove(this.schedule);
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    }
    this.active.clear();
  }
}
