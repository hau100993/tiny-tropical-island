import { AudioEngine } from './AudioEngine';
import { BirdsLayer } from './synth/birds';
import { RainLayer } from './synth/rain';
import { SnowQuietLayer } from './synth/snowQuiet';
import { WavesLayer } from './synth/waves';
import { WindLayer } from './synth/wind';
import { Footsteps, type FootSurface } from './synth/footsteps';
import { spatialMix, type ListenerState } from './spatial';
import { cloneMixerState, defaultMixerState, MIXER_KEY, parseMixerState } from './mixerState';
import { LAYER_IDS, type AudioLayer, type LayerId, type LayerState, type MixerState, type SpatialMix } from './types';
import { parseJson, readStored, writeStored } from '../core/storage';

type Listener = (state: Readonly<MixerState>) => void;

/**
 * The mixer state (what the sliders show) plus the live audio graph once started.
 * State exists and persists even before audio starts; starting just applies it.
 */
export class Mixer {
  private state: MixerState;
  private engine: AudioEngine | null = null;
  private readonly layers = new Map<LayerId, AudioLayer>();
  private waves: WavesLayer | null = null;
  private birds: BirdsLayer | null = null;
  private seaState = 0.45;
  private night = 0;
  private readonly listeners: Listener[] = [];
  private saveTimer = 0;
  private footsteps: Footsteps | null = null;
  /** Last spatial mix sent per layer (only resent when it changes noticeably). */
  private readonly spatialSent = new Map<LayerId, SpatialMix>();
  private readonly spatialTmp: SpatialMix = { gain: 1, pan: 0, occlusion: 0 };

  constructor() {
    this.state = parseMixerState(parseJson(readStored(MIXER_KEY)));
  }

  get started(): boolean {
    return this.engine !== null;
  }

  get current(): Readonly<MixerState> {
    return this.state;
  }

  /** Call from a click/keypress handler (autoplay policy). Fades in over ~2 s. */
  async start(): Promise<void> {
    if (this.engine) return;
    const engine = await AudioEngine.start();
    this.engine = engine;
    this.waves = new WavesLayer(engine);
    this.waves.setSeaState(this.seaState);
    this.birds = new BirdsLayer(engine);
    this.setNight(this.night);
    const all: AudioLayer[] = [this.waves, this.birds, new WindLayer(engine), new RainLayer(engine), new SnowQuietLayer(engine)];
    for (const layer of all) this.layers.set(layer.id, layer);
    this.footsteps = new Footsteps(engine);
    this.applyAll(0.7);
    this.emit();
  }

  setLayer(id: LayerId, patch: Partial<LayerState>): void {
    Object.assign(this.state.layers[id], patch);
    this.applyLayer(id);
    if (id === 'snow') this.applyMuffle();
    this.changed();
  }

  setMaster(patch: Partial<MixerState['master']>): void {
    Object.assign(this.state.master, patch);
    this.engine?.setMaster(this.state.master.volume, this.state.master.muted);
    this.changed();
  }

  toggleMuteAll(): void {
    this.setMaster({ muted: !this.state.master.muted });
  }

  /** Replaces the whole mix (presets). */
  load(state: MixerState): void {
    this.state = cloneMixerState(state);
    this.applyAll();
    this.changed();
  }

  reset(): void {
    this.load(defaultMixerState());
  }

  /** 0 = day … 1 = night: birds fall silent and crickets take over. */
  setNight(night: number): void {
    this.night = night;
    this.birds?.setDensity(1 - 0.92 * night);
    this.birds?.setCrickets(night);
  }

  /** Wave strength of the sea (scene setting) also shapes the surf sound. */
  setSeaState(value: number): void {
    this.seaState = value;
    this.waves?.setSeaState(value);
  }

  /** Where the listener stands (walk mode); `walking: false` makes every layer neutral. */
  setListener(state: Readonly<ListenerState>): void {
    for (const [id, layer] of this.layers) {
      const mix = spatialMix(id, state, this.spatialTmp);
      let sent = this.spatialSent.get(id);
      if (
        sent &&
        Math.abs(sent.gain - mix.gain) < 0.01 &&
        Math.abs(sent.pan - mix.pan) < 0.01 &&
        Math.abs(sent.occlusion - mix.occlusion) < 0.01
      ) {
        continue;
      }
      if (!sent) {
        sent = { gain: 1, pan: 0, occlusion: 0 };
        this.spatialSent.set(id, sent);
      }
      Object.assign(sent, mix);
      layer.setSpatial(sent);
    }
  }

  playFootstep(surface: FootSurface, strength: number, depth: number): void {
    this.footsteps?.play(surface, strength, depth);
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  private applyAll(masterFade?: number): void {
    for (const id of LAYER_IDS) this.applyLayer(id);
    this.applyMuffle();
    this.engine?.setMaster(this.state.master.volume, this.state.master.muted, masterFade);
  }

  private applyLayer(id: LayerId): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    const s = this.state.layers[id];
    layer.setVolume(s.volume);
    layer.setMuted(s.muted);
    layer.setEnabled(s.enabled);
  }

  /** Falling snow absorbs sound: the louder the snow-quiet layer, the more muffled the rest. */
  private applyMuffle(): void {
    const snow = this.state.layers.snow;
    this.engine?.setMuffle(snow.enabled && !snow.muted ? snow.volume : 0);
  }

  private changed(): void {
    // Sliders fire many events per second; persist at most every 300 ms.
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => writeStored(MIXER_KEY, this.state), 300);
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
}
