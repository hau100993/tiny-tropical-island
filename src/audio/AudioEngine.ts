import { createNoiseBank, type NoiseBank } from './noiseBuffers';
import { Scheduler } from './scheduler';

/** Time constant (s) for most gain changes: fast enough to feel instant, slow enough not to click. */
export const RAMP = 0.12;
/** Low-pass cutoff with the head under water (Hz). */
const UNDERWATER_HZ = 400;

/**
 * Owns the single AudioContext and the shared output chain:
 *
 *   layers ─▶ ambience bus ─▶ muffle lowpass ─┐
 *   snow layer ─▶ direct bus ─────────────────┼─▶ master gain ─▶ compressor ─▶ speakers
 *   Pomodoro chime ─▶ alerts bus ───────────────────────────────┘ (not affected by mute-all)
 *
 * The context is created only after a user gesture (browser autoplay policy).
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly noise: NoiseBank;
  readonly scheduler: Scheduler;
  /** Most layers connect here. */
  readonly ambience: GainNode;
  /** Layers that should not be muffled (the snow hush itself). */
  readonly direct: GainNode;
  /** Notification sounds: skip the master volume/mute so a muted soundscape still chimes. */
  readonly alerts: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly master: GainNode;
  private masterVolume = 0.8;
  private masterMuted = false;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.noise = createNoiseBank(ctx);
    this.scheduler = new Scheduler(ctx);

    const compressor = ctx.createDynamicsCompressor();
    // Gentle glue limiter: keeps a loud storm from clipping without pumping.
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.4;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(compressor);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.muffle.connect(this.master);

    this.ambience = ctx.createGain();
    this.ambience.connect(this.muffle);
    this.direct = ctx.createGain();
    this.direct.connect(this.master);
    this.alerts = ctx.createGain();
    this.alerts.connect(compressor);

    // If Windows switches audio devices or the context gets suspended, resume on next gesture.
    const resumeOnGesture = (): void => {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', resumeOnGesture);
    window.addEventListener('keydown', resumeOnGesture);
  }

  /** Must be called from a user gesture handler (click/keypress). */
  static async start(): Promise<AudioEngine> {
    // 'playback' trades latency (irrelevant for ambience) for lower CPU use.
    const ctx = new AudioContext({ latencyHint: 'playback' });
    if (ctx.state === 'suspended') await ctx.resume();
    return new AudioEngine(ctx);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  setMaster(volume: number, muted: boolean, fadeSeconds = RAMP): void {
    this.masterVolume = volume;
    this.masterMuted = muted;
    const target = muted ? 0 : volume * volume;
    const p = this.master.gain;
    p.cancelScheduledValues(this.now);
    p.setTargetAtTime(target, this.now, fadeSeconds);
  }

  get masterState(): { volume: number; muted: boolean } {
    return { volume: this.masterVolume, muted: this.masterMuted };
  }

  /** 0 = clear, 1 = heavily muffled (snow absorbs high frequencies). Exponential in frequency. */
  setMuffle(amount: number): void {
    this.muffleAmount = Math.min(1, Math.max(0, amount));
    this.applyMuffle(0.8);
  }

  /**
   * Head under water: the world above turns into a dull low rumble (~400 Hz and below), far
   * more than snow's muffle. Quick in and out, like ducking under.
   */
  setUnderwater(on: boolean): void {
    if (on === this.underwater) return;
    this.underwater = on;
    this.applyMuffle(0.06);
  }

  private muffleAmount = 0;
  private underwater = false;

  private applyMuffle(timeConstant: number): void {
    const freq = this.underwater ? UNDERWATER_HZ : 20000 * Math.pow(1500 / 20000, this.muffleAmount);
    this.muffle.frequency.setTargetAtTime(freq, this.now, timeConstant);
    // A little resonance under water gives the "boomy" sound of being submerged.
    this.muffle.Q.setTargetAtTime(this.underwater ? 1.4 : 0.5, this.now, timeConstant);
  }
}

/** Starts a looping buffer at a random offset so layers sharing a buffer never phase-align. */
export function loopNoise(ctx: BaseAudioContext, buffer: AudioBuffer, destination: AudioNode): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(destination);
  src.start(0, Math.random() * buffer.duration);
  return src;
}

export function makeFilter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  Q = 0.7,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}

export function makeGain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Wires nodes in series and returns the first one. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[0];
}
