import type { AudioEngine } from './AudioEngine';
import { RAMP } from './AudioEngine';
import type { AudioLayer, LayerId, SpatialMix } from './types';

/** After switching a layer off, nodes are stopped once the fade-out has finished. */
const STOP_DELAY_MS = 1200;
/** Time constant (s) for position changes while walking: smooth, never zippery. */
const SPATIAL_RAMP = 0.25;

/**
 * Shared behavior for all layers: one output gain with smooth ramps, and starting/stopping
 * the actual sound nodes when the layer is switched on/off (disabled layers cost no CPU).
 * Subclasses only build their node graph (`startNodes`) and tear it down (`stopNodes`).
 *
 *   layer nodes ─▶ output gain ─▶ stereo pan ─▶ occlusion lowpass ─▶ destination
 *
 * Pan and occlusion are neutral (center, 20 kHz) except while walking.
 */
export abstract class BaseLayer implements AudioLayer {
  protected readonly output: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly occluder: BiquadFilterNode;
  private volume = 0.5;
  private enabled = false;
  private muted = false;
  private spatial = 1;
  private running = false;
  private stopTimer = 0;

  /**
   * @param trim fixed level correction so all layers sound balanced at the same slider position
   *   (measured RMS at volume 0.7: waves −26, rain −27, wind −30, birds −32, snow −38 dBFS).
   */
  constructor(
    protected readonly engine: AudioEngine,
    readonly id: LayerId,
    destination: AudioNode,
    private readonly trim = 1,
  ) {
    this.output = engine.ctx.createGain();
    this.output.gain.value = 0;
    this.panner = engine.ctx.createStereoPanner();
    this.occluder = engine.ctx.createBiquadFilter();
    this.occluder.type = 'lowpass';
    this.occluder.frequency.value = 20000;
    this.occluder.Q.value = 0.5;
    this.output.connect(this.panner).connect(this.occluder).connect(destination);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  setSpatial(s: Readonly<SpatialMix>): void {
    const now = this.engine.now;
    if (s.gain !== this.spatial) {
      this.spatial = s.gain;
      this.applyGain(SPATIAL_RAMP);
    }
    this.panner.pan.setTargetAtTime(s.pan, now, SPATIAL_RAMP);
    // Exponential in frequency: 0 → 20 kHz (open), 1 → 400 Hz (through a wall).
    const freq = 20000 * Math.pow(400 / 20000, Math.min(1, Math.max(0, s.occlusion)));
    this.occluder.frequency.setTargetAtTime(freq, now, SPATIAL_RAMP);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    window.clearTimeout(this.stopTimer);
    if (enabled && !this.running) {
      this.running = true;
      this.startNodes();
    }
    this.applyGain(enabled ? 0.6 : 0.4);
    if (!enabled) {
      this.stopTimer = window.setTimeout(() => {
        if (!this.enabled && this.running) {
          this.running = false;
          this.stopNodes();
        }
      }, STOP_DELAY_MS);
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Perceptual curve: slider position squared ≈ even loudness steps. */
  private applyGain(timeConstant = RAMP): void {
    const on = this.enabled && !this.muted;
    const target = on ? this.volume * this.volume * this.spatial * this.trim : 0;
    const p = this.output.gain;
    const now = this.engine.now;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(target, now, timeConstant);
  }

  protected abstract startNodes(): void;
  protected abstract stopNodes(): void;

  dispose(): void {
    window.clearTimeout(this.stopTimer);
    if (this.running) this.stopNodes();
    this.running = false;
    this.output.disconnect();
    this.panner.disconnect();
    this.occluder.disconnect();
  }
}

/** Stops and disconnects a set of nodes, ignoring ones that were never started. */
export function stopAll(nodes: Array<AudioScheduledSourceNode | AudioNode>): void {
  for (const n of nodes) {
    if ('stop' in n) {
      try {
        (n as AudioScheduledSourceNode).stop();
      } catch {
        // Already stopped.
      }
    }
    n.disconnect();
  }
  nodes.length = 0;
}
