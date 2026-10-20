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
  'cirrus',
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
  cirrus: 0,
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
    visualWind: 0.08, waveStrength: 0.15, clouds: 0.3, cirrus: 0.6, gloom: 0, meteors: 0, aurora: 0, fireflies: false,
  }, 15),
  builtIn('b-sunny', 'Ngày nắng', 10, { visualWind: 0.25, waveStrength: 0.4, clouds: 0.25 }),
  builtIn('b-sunset', 'Hoàng hôn yên ả', 17.9, { visualWind: 0.12, waveStrength: 0.2, clouds: 0.35, cirrus: 0.35 }, -152),
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

/** The user's edit of a built-in scene: its effects and its time (name and id stay). */
export interface BuiltInEdit {
  values: SceneValues;
  hours: number | null;
  skyTurn: number;
}

/**
 * Validates stored built-in edits; unknown ids are dropped. Before 2026-10-20 only the effect
 * values were stored ({ [id]: SceneValues }); those keep the built-in's time.
 */
export function parseOverrides(raw: unknown): Record<string, BuiltInEdit> {
  const out: Record<string, BuiltInEdit> = {};
  if (!isRecord(raw)) return out;
  for (const p of BUILT_IN_SCENES) {
    const r = raw[p.id];
    if (!isRecord(r)) continue;
    if (isRecord(r.values)) {
      const hours = 'hours' in r ? parseHours(r.hours) : p.hours;
      out[p.id] = { values: parseSceneValues(r.values), hours, skyTurn: hours === null ? 0 : parseSkyTurn(r.skyTurn) };
    } else {
      out[p.id] = { values: parseSceneValues(r), hours: p.hours, skyTurn: p.skyTurn };
    }
  }
  return out;
}

/** What the scene editor saves. */
export interface SceneDraft {
  name: string;
  values: SceneValues;
  hours: number | null;
  /** Degrees; ignored without a time of day. */
  skyTurn: number;
}

export type SaveError = 'empty' | 'taken' | 'full';

type Listener = () => void;

/** Built-in scenes plus the user's own (localStorage). */
export class ScenePresetStore {
  private user: ScenePreset[];
  private overrides: Record<string, BuiltInEdit>;
  private readonly listeners: Listener[] = [];

  constructor() {
    this.user = parseUserScenes(parseJson(readStored(SCENE_PRESETS_KEY)));
    this.overrides = parseOverrides(parseJson(readStored(SCENE_OVERRIDES_KEY)));
  }

  /** Built-ins (with the user's edits applied) followed by the user's own scenes. */
  all(): ScenePreset[] {
    const builtIns = BUILT_IN_SCENES.map((p) => {
      const o = this.overrides[p.id];
      return o ? { ...p, values: { ...o.values }, hours: o.hours, skyTurn: o.skyTurn } : p;
    });
    return [...builtIns, ...this.user];
  }

  /** A built-in scene the user has changed. */
  isModified(id: string): boolean {
    return id in this.overrides;
  }

  /** Restores a built-in scene's original effects and time. */
  resetBuiltIn(id: string): void {
    if (!(id in this.overrides)) return;
    delete this.overrides[id];
    this.persist();
  }

  get(id: string): ScenePreset | undefined {
    return this.all().find((p) => p.id === id);
  }

  /** A new scene of the user's, or why it can't be saved. */
  create(draft: SceneDraft): ScenePreset | SaveError {
    const name = sanitizePresetName(draft.name);
    if (!name) return 'empty';
    if (this.nameTaken(name, '')) return 'taken';
    if (this.user.length >= MAX_USER_PRESETS) return 'full';
    const preset: ScenePreset = {
      id: `u-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      builtIn: false,
      values: { ...draft.values },
      hours: draft.hours,
      skyTurn: draft.hours === null ? 0 : parseSkyTurn(draft.skyTurn),
    };
    this.user.push(preset);
    this.persist();
    return preset;
  }

  /**
   * Saves an edited scene: effects and time, and the name for the user's own (a built-in keeps
   * its name, and its original stays available for "Khôi phục gốc").
   */
  edit(id: string, draft: SceneDraft): ScenePreset | SaveError {
    const hours = draft.hours;
    const skyTurn = hours === null ? 0 : parseSkyTurn(draft.skyTurn);
    if (BUILT_IN_SCENES.some((b) => b.id === id)) {
      this.overrides[id] = { values: { ...draft.values }, hours, skyTurn };
      this.persist();
      return this.get(id) ?? 'empty';
    }
    const p = this.user.find((x) => x.id === id);
    const name = sanitizePresetName(draft.name);
    if (!p || !name) return 'empty';
    if (this.nameTaken(name, id)) return 'taken';
    Object.assign(p, { name, values: { ...draft.values }, hours, skyTurn });
    this.persist();
    return p;
  }

  remove(id: string): void {
    this.user = this.user.filter((p) => p.id !== id);
    this.persist();
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }

  private nameTaken(name: string, exceptId: string): boolean {
    const n = name.toLowerCase();
    return this.all().some((p) => p.id !== exceptId && p.name.toLowerCase() === n);
  }

  private persist(): void {
    writeStored(SCENE_PRESETS_KEY, this.user);
    writeStored(SCENE_OVERRIDES_KEY, this.overrides);
    for (const l of this.listeners) l();
  }
}
