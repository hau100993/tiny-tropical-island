import type { AudioEngine } from '../AudioEngine';
import { readStored, parseJson, writeStored } from '../../core/storage';
import { deleteBlob, isQuotaError, putBlob, requestPersistence } from './blobStore';
import { TrackPlayer } from './TrackPlayer';
import { nameFromFile, parseTracks, sanitizeTrackName, trackLevel, TRACKS_KEY, type TrackMeta } from './tracks';

/** Fade when the scene changes (time constant, s): ~3 s crossfade between scenes. */
const SCENE_FADE = 1.0;
/** Fade for slider moves and ▶/⏸: quick but click-free. */
const QUICK_FADE = 0.12;
/** Pomodoro calm reaches its level over ~20 s. */
const CALM_FADE = 6;

export type AddResult = 'ok' | 'quota' | 'unsupported' | 'error';

type Listener = () => void;

/**
 * The user's recordings ("Âm thanh của tôi"): metadata in localStorage, audio in IndexedDB,
 * one streaming player per track once sound has started. Tracks mapped to the active scene
 * preset play automatically; any track can also be switched on by itself.
 */
export class SoundLibrary {
  private tracks: TrackMeta[];
  private activePreset = '';
  private calm = 1;
  private engine: AudioEngine | null = null;
  private readonly players = new Map<string, TrackPlayer>();
  private readonly listeners: Listener[] = [];
  private saveTimer = 0;

  constructor() {
    this.tracks = parseTracks(parseJson(readStored(TRACKS_KEY)));
  }

  list(): readonly TrackMeta[] {
    return this.tracks;
  }

  get(id: string): TrackMeta | undefined {
    return this.tracks.find((t) => t.id === id);
  }

  get active(): string {
    return this.activePreset;
  }

  /** Could not be played (missing from storage, or a format the browser can't decode). */
  failed(id: string): boolean {
    return this.players.get(id)?.failed ?? false;
  }

  /** Some recording is (or is about to be) audible: the synthesized fallback can step aside. */
  get audible(): boolean {
    return this.tracks.some((t) => trackLevel(t, this.activePreset, 1) > 0 && !this.failed(t.id));
  }

  /** Names of the recordings playing now (on their own or with the scene). */
  playingNames(): string[] {
    return this.tracks.filter((t) => trackLevel(t, this.activePreset, 1) > 0 && !this.failed(t.id)).map((t) => t.name);
  }

  /** Call once sound has started (needs the AudioContext). */
  attach(engine: AudioEngine): void {
    this.engine = engine;
    this.apply(SCENE_FADE);
  }

  /** Copies a file from the PC into browser storage. */
  async add(file: File): Promise<AddResult> {
    if (file.type && !file.type.startsWith('audio/') && file.type !== 'video/webm' && file.type !== 'video/mp4') {
      return 'unsupported';
    }
    const id = `t-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    try {
      await putBlob(id, file);
    } catch (e) {
      console.info('[audio] Could not store the recording', e);
      return isQuotaError(e) ? 'quota' : 'error';
    }
    void requestPersistence();
    this.tracks.push({ id, name: nameFromFile(file.name), size: file.size, volume: 0.7, playing: false, mappings: [] });
    this.changed(true);
    return 'ok';
  }

  async remove(id: string): Promise<void> {
    this.tracks = this.tracks.filter((t) => t.id !== id);
    this.players.get(id)?.dispose();
    this.players.delete(id);
    this.changed(true);
    try {
      await deleteBlob(id);
    } catch (e) {
      console.info('[audio] Could not delete the stored recording', e);
    }
  }

  rename(id: string, name: string): void {
    const t = this.get(id);
    const clean = sanitizeTrackName(name);
    if (!t || !clean) return;
    t.name = clean;
    this.changed(true);
  }

  setVolume(id: string, volume: number): void {
    const t = this.get(id);
    if (!t) return;
    t.volume = volume;
    this.changed(false);
  }

  setPlaying(id: string, playing: boolean): void {
    const t = this.get(id);
    if (!t) return;
    t.playing = playing;
    this.changed(false);
  }

  /** Maps a track to a scene preset at a volume, or unmaps it (null). */
  setMapping(id: string, presetId: string, volume: number | null): void {
    const t = this.get(id);
    if (!t) return;
    const i = t.mappings.findIndex((m) => m.presetId === presetId);
    if (volume === null) {
      if (i >= 0) t.mappings.splice(i, 1);
    } else if (i >= 0) {
      t.mappings[i].volume = volume;
    } else {
      t.mappings.push({ presetId, volume });
    }
    this.changed(false);
  }

  /** A preset was deleted: forget every mapping to it. */
  dropPreset(presetId: string): void {
    let any = false;
    for (const t of this.tracks) {
      const n = t.mappings.length;
      t.mappings = t.mappings.filter((m) => m.presetId !== presetId);
      any ||= t.mappings.length !== n;
    }
    if (any) this.changed(true);
  }

  /** The scene preset now on screen: its recordings fade in, the previous scene's fade out. */
  setActivePreset(id: string): void {
    if (id === this.activePreset) return;
    this.activePreset = id;
    this.apply(SCENE_FADE);
    this.emit();
  }

  /** Pomodoro "storm calms down": recordings of the scene ease to `factor` during breaks. */
  setCalm(factor: number): void {
    if (factor === this.calm) return;
    this.calm = factor;
    this.apply(CALM_FADE);
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  private changed(saveNow: boolean): void {
    this.apply(QUICK_FADE);
    window.clearTimeout(this.saveTimer);
    if (saveNow) writeStored(TRACKS_KEY, this.tracks);
    else this.saveTimer = window.setTimeout(() => writeStored(TRACKS_KEY, this.tracks), 300);
    this.emit();
  }

  private apply(timeConstant: number): void {
    const engine = this.engine;
    if (!engine) return;
    for (const t of this.tracks) {
      const level = trackLevel(t, this.activePreset, this.calm);
      let p = this.players.get(t.id);
      if (!p && level === 0) continue;
      if (!p) {
        p = new TrackPlayer(engine, t.id, engine.ambience, () => this.emit());
        this.players.set(t.id, p);
      }
      p.setLevel(level, timeConstant);
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
