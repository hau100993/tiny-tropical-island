import { AudioEngine } from './AudioEngine';
import { BirdsLayer } from './synth/birds';
import { RainLayer } from './synth/rain';
import { SnowQuietLayer } from './synth/snowQuiet';
import { WavesLayer } from './synth/waves';
import { WindLayer } from './synth/wind';
import { Footsteps, type FootSurface } from './synth/footsteps';
import { SurfSound } from './synth/surf';
import { spatialMix, type ListenerState } from './spatial';
import { LayerSlot, type LayerSource } from './LayerSlot';
import { FileLayer } from './file/FileLayer';
import { loadAudioFileConfig } from './file/config';
import { scheduleChime, type ChimeKind } from './synth/chime';
import { MIXER_KEY, parseMixerState } from './mixerState';
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
  private readonly layers = new Map<LayerId, LayerSlot>();
  private waves: WavesLayer | null = null;
  private birds: BirdsLayer | null = null;
  private seaState = 0.45;
  private night = 0;
  private readonly listeners: Listener[] = [];
  private saveTimer = 0;
  private footsteps: Footsteps | null = null;
  private surf: SurfSound | null = null;
  /** Last spatial mix sent per layer (only resent when it changes noticeably). */
  private readonly spatialSent = new Map<LayerId, SpatialMix>();
  private readonly spatialTmp: SpatialMix = { gain: 1, pan: 0, occlusion: 0 };
  private calm = 1;
  private muffle = 0;

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
    for (const layer of all) this.layers.set(layer.id, new LayerSlot(layer.id, layer, () => this.emit()));
    this.footsteps = new Footsteps(engine);
    this.surf = new SurfSound(engine);
    this.applyAll(0.7);
    this.applyCalm(0.01);
    this.emit();
    void this.attachFiles(engine);
  }

  /** Optional recordings from public/audio/config.json replace synth layers once decoded. */
  private async attachFiles(engine: AudioEngine): Promise<void> {
    const config = await loadAudioFileConfig();
    for (const id of LAYER_IDS) {
      const cfg = config[id];
      const slot = this.layers.get(id);
      if (!cfg || !slot) continue;
      const destination = id === 'snow' ? engine.direct : engine.ambience;
      const file = new FileLayer(engine, id, destination, cfg, () => slot.detachFile());
      void slot.attachFile(file, this.state.layers[id]);
    }
  }

  /** Whether a layer currently plays the synthesized sound or the user's recordings. */
  sourceOf(id: LayerId): LayerSource {
    return this.layers.get(id)?.source ?? 'synth';
  }

  /**
   * Pomodoro "storm calms down": rain, wind and snow sounds scale to `factor` (eased over ~20 s
   * on the audio clock, so it also happens in a hidden tab).
   */
  setCalm(factor: number): void {
    if (factor === this.calm) return;
    this.calm = factor;
    this.applyCalm(6);
  }

  private applyCalm(timeConstant: number): void {
    for (const id of ['rain', 'wind', 'snow'] as const) this.layers.get(id)?.setDuck(this.calm, timeConstant);
  }

  /**
   * Schedules a chime at a wall-clock time (ms since epoch). Returns a cancel function, or null
   * when sound isn't running.
   */
  scheduleChime(atMs: number, kind: ChimeKind): (() => void) | null {
    if (!this.engine) return null;
    const when = this.engine.now + Math.max(0, (atMs - Date.now()) / 1000);
    return scheduleChime(this.engine, when, kind);
  }

  setLayer(id: LayerId, patch: Partial<LayerState>): void {
    Object.assign(this.state.layers[id], patch);
    this.applyLayer(id);
    this.changed();
  }

  /**
   * Sets the synthesized layers from the scene (0 = off). Used as the fallback soundscape when
   * no recording plays, so the sound matches what is on screen.
   */
  setSceneMix(levels: Readonly<Record<LayerId, number>>): void {
    let any = false;
    for (const id of LAYER_IDS) {
      const v = levels[id];
      const l = this.state.layers[id];
      const enabled = v > 0.01;
      if (l.enabled === enabled && (!enabled || Math.abs(l.volume - v) < 0.005) && !l.muted) continue;
      l.enabled = enabled;
      if (enabled) l.volume = v;
      l.muted = false;
      this.applyLayer(id);
      any = true;
    }
    if (any) this.changed();
  }

  /** Falling snow absorbs sound: 0 = clear … 1 = heavily muffled (all layers and recordings). */
  setMuffle(amount: number): void {
    if (Math.abs(amount - this.muffle) < 0.005) return;
    this.muffle = amount;
    this.applyMuffle();
  }

  /** Null until sound has started. */
  get audioEngine(): AudioEngine | null {
    return this.engine;
  }

  setMaster(patch: Partial<MixerState['master']>): void {
    Object.assign(this.state.master, patch);
    this.engine?.setMaster(this.state.master.volume, this.state.master.muted);
    this.changed();
  }

  toggleMuteAll(): void {
    this.setMaster({ muted: !this.state.master.muted });
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

  /** Kayak paddle splash (see Footsteps.paddle); follows the footsteps on/off setting. */
  playPaddle(kind: 'catch' | 'exit', strength: number, pan: number): void {
    this.footsteps?.paddle(kind, strength, pan);
  }

  /** A wave breaking near the surfer (see SurfSound.crash). */
  playSurfCrash(gain: number, pan: number): void {
    this.surf?.crash(gain, pan);
  }

  /** Water and wind rushing past while riding (m/s; 0 stops it). */
  setSurfRush(speed: number): void {
    this.surf?.setRush(speed);
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

  private applyMuffle(): void {
    this.engine?.setMuffle(this.muffle);
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
