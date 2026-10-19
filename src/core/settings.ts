import { QUALITY_LEVELS, type QualityLevel } from './quality';
import type { TimeMode } from '../world/celestial';
import type { WalkView } from '../controls/walker';

const TIME_MODES: readonly TimeMode[] = ['real', 'cycle24', 'cycle6', 'paused'];

export const SETTINGS_KEY = 'tsw.settings';
export const SETTINGS_VERSION = 1;

export interface Settings {
  version: number;
  quality: QualityLevel;
  autoRotate: boolean;
  showDebug: boolean;
  /** Sea wave strength, 0 (glassy) … 1 (stormy). */
  waveStrength: number;
  panelCollapsed: boolean;
  /**
   * Phase 2–6 only: visuals followed the synth mixer. Since Phase 7 the scene (visual sliders,
   * scene presets) leads; kept to migrate old settings once (see App).
   */
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
  /** Walk mode view: through the eyes, or behind the character. */
  walkView: WalkView;
  /** Scene preset last applied ('' = none); its mapped recordings play. */
  activeScene: string;
  /** Play the synthesized soundscape while no recording is playing. */
  synthFallback: boolean;
  /** Open the app sitting at the desk in the house. */
  startAtDesk: boolean;
  /** Control panel: the accordion section that is open ('' = all closed). */
  panelSection: PanelSection;
}

export const PANEL_SECTIONS = ['scene', 'sound', 'time', 'view', 'settings'] as const;
export type PanelSection = (typeof PANEL_SECTIONS)[number] | '';

export type SettingsPatch = Partial<Omit<Settings, 'version'>>;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    quality: 'medium',
    autoRotate: false,
    showDebug: false,
    waveStrength: 0.45,
    panelCollapsed: false,
    weatherLinked: false,
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
    activeScene: 'b-sunny',
    synthFallback: true,
    startAtDesk: false,
    panelSection: 'scene',
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
    walkView: raw.walkView === 'first' || raw.walkView === 'third' ? raw.walkView : defaults.walkView,
    activeScene: typeof raw.activeScene === 'string' ? raw.activeScene.slice(0, 64) : defaults.activeScene,
    panelSection:
      raw.panelSection === '' || PANEL_SECTIONS.includes(raw.panelSection as (typeof PANEL_SECTIONS)[number])
        ? (raw.panelSection as PanelSection)
        : defaults.panelSection,
    synthFallback: bool(raw.synthFallback, defaults.synthFallback),
    startAtDesk: bool(raw.startAtDesk, defaults.startAtDesk),
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
    // First run with "reduce motion" turned on in Windows: the slowest day cycle (real clock).
    if (json === null && typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.settings.timeMode = 'real';
    }
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
