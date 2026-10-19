import { bool, clamp01, isRecord, parseJson, readStored, writeStored } from './storage';
import type { Settings } from './settings';

export const SCENE_PRESETS_KEY = 'tsw.scenePresets';
/** The user's edits of built-in presets: { [builtInId]: SceneValues }. */
export const SCENE_OVERRIDES_KEY = 'tsw.sceneOverrides';
export const MAX_USER_PRESETS = 30;
export const MAX_PRESET_NAME = 32;

/** The settings a scene preset sets: weather effects and sky options. */
export const SCENE_KEYS = [
  'visualRain',
  'visualSnow',
  'visualWind',
  'waveStrength',
  'clouds',
  'gloom',
  'rainbow',
  'stars',
  'meteors',
  'aurora',
  'moonlight',
  'fireflies',
] as const;

export type SceneKey = (typeof SCENE_KEYS)[number];
export type SceneValues = Pick<Settings, SceneKey>;

/**
 * A scene: weather and sky effects, optionally a time of day. Sound comes from the user's
 * recordings mapped to the preset (see audio/library), or the synthesized fallback.
 */
export interface ScenePreset {
  id: string;
  name: string;
  builtIn: boolean;
  values: SceneValues;
  /** Time of day to jump to (hours), or null to keep the current time. */
  hours: number | null;
  /**
   * With a time of day: turns the sky around the vertical (degrees) so the sun or moon of that
   * moment is in the desk window. 0 = the real arc (sun rises east, sets west, behind the desk).
   */
  skyTurn: number;
}

const BOOL_KEYS: ReadonlySet<SceneKey> = new Set(['rainbow', 'stars', 'fireflies']);

/** Values used for any field a (possibly older) preset doesn't have. */
export const DEFAULT_SCENE: Readonly<SceneValues> = {
  visualRain: 0,
  visualSnow: 0,
  visualWind: 0.3,
  waveStrength: 0.45,
  clouds: 0.35,
  gloom: 0,
  rainbow: true,
  stars: true,
  meteors: 0.4,
  aurora: 0.5,
  moonlight: 0.3,
  fireflies: true,
};

function builtIn(id: string, name: string, hours: number | null, v: Partial<SceneValues>, skyTurn = 0): ScenePreset {
  return { id, name, builtIn: true, values: { ...DEFAULT_SCENE, ...v }, hours, skyTurn };
}

export const BUILT_IN_SCENES: readonly ScenePreset[] = [
  // Sky turns put the sun/moon in the desk window, a little left of center (the panel covers
  // the right): sunrise ~25° left, sunset ~12° left, the full moon ~15° left and 17° up.
  builtIn('b-dawn', 'Bình minh ơi', 6.2, {
    visualWind: 0.12, waveStrength: 0.2, clouds: 0.45, gloom: 0, meteors: 0, aurora: 0, fireflies: false,
  }, 15),
  builtIn('b-sunny', 'Ngày nắng', 10, { visualWind: 0.25, waveStrength: 0.4, clouds: 0.25 }),
  builtIn('b-sunset', 'Hoàng hôn yên ả', 17.7, { visualWind: 0.15, waveStrength: 0.25, clouds: 0.4 }, -150),
  builtIn('b-storm', 'Bão nhiệt đới', null, {
    visualRain: 0.9, visualWind: 0.85, waveStrength: 0.95, clouds: 1, gloom: 0.6, fireflies: false,
  }),
  builtIn('b-jungle-rain', 'Mưa rừng', null, { visualRain: 0.55, visualWind: 0.3, waveStrength: 0.35, clouds: 0.8, gloom: 0.3 }),
  builtIn('b-campfire', 'Đêm lửa trại', 21, {
    visualWind: 0.15, waveStrength: 0.25, clouds: 0.15, meteors: 0.6, aurora: 0, fireflies: true,
  }),
  builtIn('b-full-moon', 'Đêm trăng tròn', 19.25, {
    visualWind: 0.1, waveStrength: 0.18, clouds: 0.2, meteors: 0.15, aurora: 0, moonlight: 1, fireflies: true,
  }, 15),
  builtIn('b-misty', 'Sáng sương mù', 6.4, { visualWind: 0.05, waveStrength: 0.15, clouds: 0.6, gloom: 0.4 }),
  builtIn('b-aurora', 'Đêm tuyết cực quang', 22.5, {
    visualSnow: 0.6, visualWind: 0.2, waveStrength: 0.2, clouds: 0.1, aurora: 1, meteors: 0.5, fireflies: false,
  }),
];

/** Reads the scene part of the settings (what "save as preset" stores). */
export function sceneValuesOf(s: Readonly<Settings>): SceneValues {
  const out = { ...DEFAULT_SCENE };
  for (const k of SCENE_KEYS) (out as Record<SceneKey, number | boolean>)[k] = s[k];
  return out;
}

/** Validates stored values; missing or invalid fields fall back to the defaults. */
export function parseSceneValues(raw: unknown): SceneValues {
  const r = isRecord(raw) ? raw : {};
  const out = { ...DEFAULT_SCENE };
  for (const k of SCENE_KEYS) {
    const d = DEFAULT_SCENE[k];
    (out as Record<SceneKey, number | boolean>)[k] = BOOL_KEYS.has(k) ? bool(r[k], d as boolean) : clamp01(r[k], d as number);
  }
  return out;
}

/** Trims and shortens a user-typed name; null if nothing usable is left. */
export function sanitizePresetName(name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME);
  return clean.length > 0 ? clean : null;
}

function parseHours(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? ((v % 24) + 24) % 24 : null;
}

/** Degrees, wrapped to [−180, 180); 0 when missing (presets saved before sky turns). */
export function parseSkyTurn(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? ((((v + 180) % 360) + 360) % 360) - 180 : 0;
}

/** Validates the stored user presets; invalid entries are dropped, the list is capped. */
export function parseUserScenes(raw: unknown): ScenePreset[] {
  if (!Array.isArray(raw)) return [];
  const out: ScenePreset[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || ids.has(item.id)) continue;
    const name = sanitizePresetName(item.name);
    if (!name) continue;
    ids.add(item.id);
    const hours = parseHours(item.hours);
    const skyTurn = hours === null ? 0 : parseSkyTurn(item.skyTurn);
    out.push({ id: item.id, name, builtIn: false, values: parseSceneValues(item.values), hours, skyTurn });
    if (out.length >= MAX_USER_PRESETS) break;
  }
  return out;
}

/** Validates stored built-in overrides; unknown ids are dropped. */
export function parseOverrides(raw: unknown): Record<string, SceneValues> {
  const out: Record<string, SceneValues> = {};
  if (!isRecord(raw)) return out;
  for (const p of BUILT_IN_SCENES) {
    if (isRecord(raw[p.id])) out[p.id] = parseSceneValues(raw[p.id]);
  }
  return out;
}

type Listener = () => void;

/** Built-in scenes plus the user's own (localStorage). Saving under an existing name overwrites it. */
export class ScenePresetStore {
  private user: ScenePreset[];
  private overrides: Record<string, SceneValues>;
  private readonly listeners: Listener[] = [];

  constructor() {
    this.user = parseUserScenes(parseJson(readStored(SCENE_PRESETS_KEY)));
    this.overrides = parseOverrides(parseJson(readStored(SCENE_OVERRIDES_KEY)));
  }

  /** Built-ins (with the user's edits applied) followed by the user's own presets. */
  all(): ScenePreset[] {
    const builtIns = BUILT_IN_SCENES.map((p) => (this.overrides[p.id] ? { ...p, values: { ...this.overrides[p.id] } } : p));
    return [...builtIns, ...this.user];
  }

  /** A built-in preset whose values the user has changed. */
  isModified(id: string): boolean {
    return id in this.overrides;
  }

  /** Restores a built-in preset's original values. */
  resetBuiltIn(id: string): void {
    if (!(id in this.overrides)) return;
    delete this.overrides[id];
    this.persist();
  }

  get(id: string): ScenePreset | undefined {
    return this.all().find((p) => p.id === id);
  }

  /** Returns the saved preset, or null if the name is empty or the list is full. */
  save(name: string, values: SceneValues, hours: number | null, skyTurn = 0): ScenePreset | null {
    const clean = sanitizePresetName(name);
    if (!clean) return null;
    const i = this.user.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase());
    if (i < 0 && this.user.length >= MAX_USER_PRESETS) return null;
    const preset: ScenePreset = {
      id: i >= 0 ? this.user[i].id : `u-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: clean,
      builtIn: false,
      values: { ...values },
      hours,
      skyTurn: hours === null ? 0 : parseSkyTurn(skyTurn),
    };
    if (i >= 0) this.user[i] = preset;
    else this.user.push(preset);
    this.persist();
    return preset;
  }

  /** Overwrites a preset's values (keeps its name and time). Built-ins keep their original for reset. */
  update(id: string, values: SceneValues): boolean {
    if (BUILT_IN_SCENES.some((b) => b.id === id)) {
      this.overrides[id] = { ...values };
      this.persist();
      return true;
    }
    const p = this.user.find((x) => x.id === id);
    if (!p) return false;
    p.values = { ...values };
    this.persist();
    return true;
  }

  remove(id: string): void {
    this.user = this.user.filter((p) => p.id !== id);
    this.persist();
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  private persist(): void {
    writeStored(SCENE_PRESETS_KEY, this.user);
    writeStored(SCENE_OVERRIDES_KEY, this.overrides);
    for (const l of this.listeners) l();
  }
}
