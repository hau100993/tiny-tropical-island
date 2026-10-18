import type { AudioEngine } from '../AudioEngine';
import { getBlob } from './blobStore';

/** After fading out, the element is paused (no decoding work) once the fade is inaudible. */
const PAUSE_AFTER_MS = 5000;

/**
 * Plays one stored recording. An <audio> element streams it from the Blob (an hour-long file
 * costs a few MB of RAM instead of ~1.4 GB decoded), and a MediaElementAudioSourceNode feeds it
 * into the Web Audio graph, so master volume, mute and the snow muffle apply as to every layer:
 *
 *   <audio> ─▶ MediaElementSource ─▶ gain (fades) ─▶ ambience bus
 */
export class TrackPlayer {
  private el: HTMLAudioElement | null = null;
  private url = '';
  private readonly gain: GainNode;
  private loading: Promise<boolean> | null = null;
  private pauseTimer = 0;
  private target = 0;
  private disposed = false;
  failed = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly id: string,
    destination: AudioNode,
    private readonly onError: () => void,
  ) {
    this.gain = engine.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(destination);
  }

  /**
   * @param level slider position 0..1 (squared, like the other layers)
   * @param timeConstant fade time constant in seconds
   */
  setLevel(level: number, timeConstant: number): void {
    const target = level * level;
    this.target = target;
    const now = this.engine.now;
    if (target > 0) {
      window.clearTimeout(this.pauseTimer);
      this.pauseTimer = 0;
      void this.ensureLoaded().then((ok) => {
        if (ok && this.target > 0 && !this.disposed) this.play();
      });
    } else if (this.el && !this.el.paused && this.pauseTimer === 0) {
      this.pauseTimer = window.setTimeout(() => {
        this.pauseTimer = 0;
        if (this.target === 0) this.el?.pause();
      }, PAUSE_AFTER_MS + timeConstant * 3000);
    }
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(target, now, timeConstant);
  }

  private play(): void {
    const el = this.el;
    if (!el || !el.paused) return;
    el.play().catch((e: unknown) => {
      // Autoplay may refuse until the next click; try again then.
      if (e instanceof DOMException && e.name === 'NotAllowedError') {
        window.addEventListener('pointerdown', () => this.target > 0 && this.play(), { once: true });
      }
    });
  }

  private ensureLoaded(): Promise<boolean> {
    if (this.failed) return Promise.resolve(false);
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<boolean> {
    try {
      const blob = await getBlob(this.id);
      if (!blob || this.disposed) throw new Error('recording not found in storage');
      this.url = URL.createObjectURL(blob);
      const el = new Audio();
      el.loop = true;
      el.preload = 'auto';
      el.addEventListener('error', () => this.fail(el.error?.message ?? 'cannot play this file'));
      el.src = this.url;
      this.engine.ctx.createMediaElementSource(el).connect(this.gain);
      this.el = el;
      return true;
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  private fail(reason: string): void {
    if (this.failed) return;
    this.failed = true;
    console.info(`[audio] Recording ${this.id} can't be played: ${reason}`);
    this.onError();
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.pauseTimer);
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.gain.disconnect();
  }
}
