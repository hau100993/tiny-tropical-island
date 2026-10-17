import { QUALITY_LEVELS, type QualityLevel } from './quality';

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
