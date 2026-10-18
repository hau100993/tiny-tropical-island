import { QUALITY_LEVELS, type QualityLevel } from './quality';
import type { TimeMode } from '../world/celestial';
import type { WalkView } from '../controls/walker';

const TIME_MODES: readonly TimeMode[] = ['real', 'cycle24', 'cycle6', 'paused'];

export const SETTINGS_KEY = 'tsw.settings';
export const SETTINGS_VERSION = 1;

export interface Settings {
  version: number;
  quality: QualityLevel;
  lowPower: boolean;
  autoRotate: boolean;
  showDebug: boolean;
  /** Sea wave strength, 0 (glassy) … 1 (stormy). */
  waveStrength: number;
  panelCollapsed: boolean;
  /** true: rain/snow/wind visuals follow the sound mixer; false: separate visual sliders. */
  weatherLinked: boolean;
  visualRain: number;
  visualSnow: number;
  visualWind: number;
  // Sky (Phase 4)
  timeMode: TimeMode;
  /** Base cloud cover, 0..1 (rain and snow add more). */
  clouds: number;
  /** Extra gloom ("âm u"): grey sky without rain, 0..1. */
  gloom: number;
  rainbow: boolean;
  stars: boolean;
  /** Shooting-star frequency, 0..1. */
  meteors: number;
  aurora: number;
  fireflies: boolean;
  // Walking (Phase 5)
  footsteps: boolean;
  /** "Chỉ ngắm cảnh": no sound (it does not start by itself, and is muted if running). */
  sceneOnly: boolean;
  /** Walk mode view: through the eyes, or behind the character. */
  walkView: WalkView;
}

export type SettingsPatch = Partial<Omit<Settings, 'version'>>;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    quality: 'medium',
    lowPower: false,
    autoRotate: false,
    showDebug: false,
    waveStrength: 0.45,
    panelCollapsed: false,
    weatherLinked: true,
    visualRain: 0,
    visualSnow: 0,
    visualWind: 0.3,
    timeMode: 'cycle24',
    clouds: 0.35,
    gloom: 0,
    rainbow: true,
    stars: true,
    meteors: 0.4,
    aurora: 0.5,
    fireflies: true,
    footsteps: true,
    walkView: 'third',
    sceneOnly: false,
  };
}

type Raw = Record<string, unknown>;

/** Upgrades older stored shapes step by step. Add `n: migrateN` entries when the schema changes. */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {};

function migrate(raw: Raw): Raw {
  let version = typeof raw.version === 'number' ? raw.version : 0;
  let out = raw;
  while (version < SETTINGS_VERSION) {
    const step = MIGRATIONS[version];
    if (step) out = step(out);
    version++;
  }
  return out;
}

/** Parses stored JSON; any missing or invalid field falls back to its default. Never throws. */
export function parseSettings(json: string | null): Settings {
  const defaults = defaultSettings();
  if (!json) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return defaults;
  }
  if (typeof parsed !== 'object' || parsed === null) return defaults;
  const raw = migrate(parsed as Raw);

  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const unit = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
  const quality = QUALITY_LEVELS.includes(raw.quality as QualityLevel)
    ? (raw.quality as QualityLevel)
    : defaults.quality;

  return {
    version: SETTINGS_VERSION,
    quality,
    lowPower: bool(raw.lowPower, defaults.lowPower),
    autoRotate: bool(raw.autoRotate, defaults.autoRotate),
    showDebug: bool(raw.showDebug, defaults.showDebug),
    waveStrength: unit(raw.waveStrength, defaults.waveStrength),
    panelCollapsed: bool(raw.panelCollapsed, defaults.panelCollapsed),
    weatherLinked: bool(raw.weatherLinked, defaults.weatherLinked),
    visualRain: unit(raw.visualRain, defaults.visualRain),
    visualSnow: unit(raw.visualSnow, defaults.visualSnow),
    visualWind: unit(raw.visualWind, defaults.visualWind),
    timeMode: TIME_MODES.includes(raw.timeMode as TimeMode) ? (raw.timeMode as TimeMode) : defaults.timeMode,
    clouds: unit(raw.clouds, defaults.clouds),
    gloom: unit(raw.gloom, defaults.gloom),
    rainbow: bool(raw.rainbow, defaults.rainbow),
    stars: bool(raw.stars, defaults.stars),
    meteors: unit(raw.meteors, defaults.meteors),
    aurora: unit(raw.aurora, defaults.aurora),
    fireflies: bool(raw.fireflies, defaults.fireflies),
    footsteps: bool(raw.footsteps, defaults.footsteps),
    sceneOnly: bool(raw.sceneOnly, defaults.sceneOnly),
    walkView: raw.walkView === 'first' || raw.walkView === 'third' ? raw.walkView : defaults.walkView,
  };
}

/** Returns localStorage, or null when it is unavailable (privacy mode, file://, etc.). */
export function safeLocalStorage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__tsw_probe__';
    s.setItem(probe, probe);
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

type Listener = (settings: Readonly<Settings>) => void;

export class SettingsStore {
  private settings: Settings;
  private listeners: Listener[] = [];

  constructor(private readonly storage: Storage | null) {
    let json: string | null = null;
    try {
      json = storage?.getItem(SETTINGS_KEY) ?? null;
    } catch {
      json = null;
    }
    this.settings = parseSettings(json);
  }

  get(): Readonly<Settings> {
    return this.settings;
  }

  update(patch: SettingsPatch): void {
    this.settings = { ...this.settings, ...patch };
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage full or blocked: keep working with in-memory settings.
    }
    for (const l of this.listeners) l(this.settings);
  }

  onChange(listener: Listener): void {
    this.listeners.push(listener);
  }
}
