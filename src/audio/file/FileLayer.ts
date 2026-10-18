import type { AudioEngine } from '../AudioEngine';
import { BaseLayer } from '../Layer';
import type { LayerId } from '../types';
import type { AudioFileEntry, LayerFileConfig } from './config';

interface Voice {
  entry: AudioFileEntry;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** Equal-power fade curves (sin/cos), so the loudness doesn't dip in the middle of a crossfade. */
const CURVE_POINTS = 32;
const FADE_IN = new Float32Array(CURVE_POINTS);
const FADE_OUT = new Float32Array(CURVE_POINTS);
for (let i = 0; i < CURVE_POINTS; i++) {
  const t = (i / (CURVE_POINTS - 1)) * (Math.PI / 2);
  FADE_IN[i] = Math.sin(t);
  FADE_OUT[i] = Math.cos(t);
}

/** Decoded recordings kept per layer: the playing one and the one fading in. */
const CACHE_SIZE = 2;

/**
 * A layer that plays the user's own recordings (same interface and output chain as the synth
 * layers). One file loops seamlessly; with several, a random other one crossfades in every
 * `rotateEverySec`. Files are decoded on demand and only two are kept in memory.
 */
export class FileLayer extends BaseLayer {
  private voice: Voice | null = null;
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly failed = new Set<string>();
  private timer = 0;
  /** Bumped by stopNodes so a decode that finishes late doesn't start a stopped layer. */
  private generation = 0;

  /**
   * @param onUnavailable called when no file of the layer can be decoded (the slot goes back to synth).
   */
  constructor(
    engine: AudioEngine,
    id: LayerId,
    destination: AudioNode,
    private readonly config: LayerFileConfig,
    private readonly onUnavailable: () => void,
  ) {
    super(engine, id, destination);
  }

  /** Decodes the first recording; resolves false if none can be decoded. */
  async prepare(): Promise<boolean> {
    for (const entry of this.config.files) {
      if (await this.load(entry)) return true;
    }
    return false;
  }

  protected startNodes(): void {
    void this.next();
  }

  protected stopNodes(): void {
    this.generation++;
    window.clearTimeout(this.timer);
    if (this.voice) this.stopVoice(this.voice, 0);
    this.voice = null;
  }

  /** Crossfades to a random recording other than the current one. */
  private async next(): Promise<void> {
    const gen = this.generation;
    const usable = this.config.files.filter((f) => !this.failed.has(f.src));
    if (usable.length === 0) {
      this.onUnavailable();
      return;
    }
    const choices = usable.length > 1 ? usable.filter((f) => f !== this.voice?.entry) : usable;
    const entry = choices[Math.floor(Math.random() * choices.length)];
    const buffer = await this.load(entry);
    if (gen !== this.generation || !this.isRunning) return;
    if (!buffer) {
      void this.next();
      return;
    }
    this.play(entry, buffer);
  }

  private play(entry: AudioFileEntry, buffer: AudioBuffer): void {
    const ctx = this.engine.ctx;
    const now = ctx.currentTime;
    const fade = this.voice ? this.config.crossfadeSec : 0.05;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const loopEnd = Math.min(entry.loopEnd ?? buffer.duration, buffer.duration);
    const loopStart = Math.min(entry.loopStart, loopEnd);
    source.loop = entry.loop;
    if (entry.loop) {
      source.loopStart = loopStart;
      source.loopEnd = loopEnd;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueCurveAtTime(scaled(FADE_IN, entry.gain), now, fade);
    source.connect(gain).connect(this.output);
    // Loops start at a random point so the same recording never sounds like it restarts.
    const offset = entry.loop ? loopStart + Math.random() * Math.max(0, loopEnd - loopStart) : loopStart;
    source.start(now, offset);

    const previous = this.voice;
    const voice: Voice = { entry, source, gain };
    this.voice = voice;
    if (previous) this.stopVoice(previous, fade);

    window.clearTimeout(this.timer);
    const multiple = this.config.files.length - this.failed.size > 1;
    if (entry.loop) {
      if (multiple) {
        const [a, b] = this.config.rotateEverySec;
        this.timer = window.setTimeout(() => void this.next(), (a + Math.random() * (b - a)) * 1000);
      }
    } else {
      // Play once, then crossfade into the next file before this one runs out. `onended` is the
      // fallback when the timer is throttled in a hidden tab.
      const left = Math.max(0, buffer.duration - offset - this.config.crossfadeSec);
      this.timer = window.setTimeout(() => void this.next(), left * 1000);
      source.onended = () => {
        if (this.voice === voice && this.isRunning) void this.next();
      };
    }
  }

  private stopVoice(v: Voice, fade: number): void {
    const now = this.engine.ctx.currentTime;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    const from = g.value;
    if (fade > 0.06 && from > 0) {
      g.setValueCurveAtTime(scaled(FADE_OUT, from), now, fade);
    } else {
      g.setTargetAtTime(0, now, 0.03);
    }
    v.source.onended = null;
    try {
      v.source.stop(now + Math.max(fade, 0.1) + 0.05);
    } catch {
      // Already stopped.
    }
    window.setTimeout(() => {
      v.source.disconnect();
      v.gain.disconnect();
    }, (Math.max(fade, 0.1) + 0.2) * 1000);
  }

  /** Fetches and decodes one file (kept in a small cache); null if it can't be decoded. */
  private async load(entry: AudioFileEntry): Promise<AudioBuffer | null> {
    const hit = this.cache.get(entry.src);
    if (hit) {
      // Refresh its place in the LRU order.
      this.cache.delete(entry.src);
      this.cache.set(entry.src, hit);
      return hit;
    }
    if (this.failed.has(entry.src)) return null;
    try {
      const res = await fetch(`audio/${entry.src.split('/').map(encodeURIComponent).join('/')}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = await this.engine.ctx.decodeAudioData(await res.arrayBuffer());
      this.cache.set(entry.src, buffer);
      // Evict the least recently used, never the one playing or the one just decoded.
      for (const key of this.cache.keys()) {
        if (this.cache.size <= CACHE_SIZE) break;
        if (key !== this.voice?.entry.src && key !== entry.src) this.cache.delete(key);
      }
      return buffer;
    } catch (e) {
      this.failed.add(entry.src);
      console.info(`[audio] Could not decode audio/${entry.src}; skipped.`, e);
      return null;
    }
  }

  override dispose(): void {
    super.dispose();
    this.cache.clear();
  }
}

function scaled(curve: Float32Array, k: number): Float32Array {
  const out = new Float32Array(curve.length);
  for (let i = 0; i < curve.length; i++) out[i] = curve[i] * k;
  return out;
}
