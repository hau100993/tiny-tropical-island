import { cloneMixerState, defaultMixerState, parseMixerState } from './mixerState';
import type { MixerState } from './types';
import { clamp01, isRecord, parseJson, readStored, writeStored } from '../core/storage';

export const PRESETS_KEY = 'tsw.presets';
export const MAX_USER_PRESETS = 20;
export const MAX_PRESET_NAME = 32;

/** A saved mix plus the scene settings that go with it (weather/time join in later phases). */
export interface Preset {
  id: string;
  name: string;
  builtIn: boolean;
  mixer: MixerState;
  waveStrength: number;
}

function preset(id: string, name: string, waveStrength: number, edit: (m: MixerState) => void): Preset {
  const mixer = defaultMixerState();
  edit(mixer);
  return { id, name, builtIn: true, mixer, waveStrength };
}

export const BUILT_IN_PRESETS: readonly Preset[] = [
  preset('focus', 'Tập trung', 0.45, () => {}),
  preset('storm', 'Bão', 0.95, (m) => {
    m.layers.waves = { volume: 0.85, enabled: true, muted: false };
    m.layers.wind = { volume: 0.85, enabled: true, muted: false };
    m.layers.rain = { volume: 0.9, enabled: true, muted: false };
    m.layers.birds.enabled = false;
    m.layers.snow.enabled = false;
  }),
  preset('quiet-snow', 'Tuyết yên tĩnh', 0.15, (m) => {
    m.layers.snow = { volume: 0.7, enabled: true, muted: false };
    m.layers.wind = { volume: 0.3, enabled: true, muted: false };
    m.layers.waves = { volume: 0.3, enabled: true, muted: false };
    m.layers.birds.enabled = false;
    m.layers.rain.enabled = false;
  }),
  preset('calm-dawn', 'Bình minh yên ả', 0.25, (m) => {
    m.layers.birds = { volume: 0.7, enabled: true, muted: false };
    m.layers.waves = { volume: 0.4, enabled: true, muted: false };
    m.layers.wind = { volume: 0.15, enabled: true, muted: false };
    m.layers.rain.enabled = false;
    m.layers.snow.enabled = false;
  }),
];

/** Trims and shortens a user-typed name; returns null if nothing usable is left. */
export function sanitizePresetName(name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME);
  return clean.length > 0 ? clean : null;
}

/** Validates the stored list of user presets; drops invalid entries. */
export function parseUserPresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return [];
  const out: Preset[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') continue;
    const name = sanitizePresetName(item.name);
    if (!name) continue;
    out.push({
      id: item.id,
      name,
      builtIn: false,
      mixer: parseMixerState(item.mixer),
      waveStrength: clamp01(item.waveStrength, 0.45),
    });
    if (out.length >= MAX_USER_PRESETS) break;
  }
  return out;
}

/** User presets in localStorage. Saving with an existing name overwrites that preset. */
export class PresetStore {
  private user: Preset[];

  constructor() {
    this.user = parseUserPresets(parseJson(readStored(PRESETS_KEY)));
  }

  all(): Preset[] {
    return [...BUILT_IN_PRESETS, ...this.user];
  }

  get(id: string): Preset | undefined {
    return this.all().find((p) => p.id === id);
  }

  /** Returns the saved preset, or null if the name is empty or the list is full. */
  save(name: string, mixer: MixerState, waveStrength: number): Preset | null {
    const clean = sanitizePresetName(name);
    if (!clean) return null;
    const existing = this.user.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (existing < 0 && this.user.length >= MAX_USER_PRESETS) return null;
    const preset = createUserPreset(clean, mixer, waveStrength);
    if (existing >= 0) this.user[existing] = { ...preset, id: this.user[existing].id };
    else this.user.push(preset);
    this.persist();
    return existing >= 0 ? this.user[existing] : preset;
  }

  remove(id: string): void {
    this.user = this.user.filter((p) => p.id !== id);
    this.persist();
  }

  private persist(): void {
    writeStored(PRESETS_KEY, this.user);
  }
}

export function createUserPreset(name: string, mixer: MixerState, waveStrength: number): Preset {
  return {
    id: `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    builtIn: false,
    mixer: cloneMixerState(mixer),
    waveStrength,
  };
}
