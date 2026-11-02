import { QUALITY_LEVELS, type QualityLevel } from './quality';
import type { TimeMode, TimeSpeed } from '../world/celestial';
import type { WalkView } from '../controls/walker';


export const SETTINGS_KEY = 'tsw.settings';
export const SETTINGS_VERSION = 3;

/** Who you walk around as: the built-in (code) body or a character from a .glb file. */
export const CHARACTER_IDS = ['default', 'man', 'woman'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

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
  /** The computer's clock, or the island's own clock (set by hand). */
  timeMode: TimeMode;
  /** Island clock speed (island seconds per real second). */
  timeSpeed: TimeSpeed;
  /** Island clock stopped. */
  timePaused: boolean;
  /** Base cloud cover, 0..1 (rain and snow add more). */
  clouds: number;
  /** Extra gloom ("âm u"): grey sky without rain, 0..1. */
  gloom: number;
  /** Clear air ("trời trong") by day: deeper blue sky and sea, less haze, 0..1. */
  clarity: number;
  /** Cirrus: clouds as thin streaks instead of puffs, 0..1. */
  cirrus: number;
  rainbow: boolean;
  stars: boolean;
  /** Shooting-star frequency, 0..1. */
  meteors: number;
  aurora: number;
  /** Moon brightness and size (0.3 = the normal moon, 1 = a big bright full moon). */
  moonlight: number;
  /** Sun disc brightness (0.5 = normal). */
  sunBrightness: number;
  /** Sun disc size (0.5 = normal, 0 ≈ 0.6×, 1 ≈ 2.2×). */
  sunSize: number;
  fireflies: boolean;
  // Walking (Phase 5)
  /**
   * Activity sounds ("Âm thanh hoạt động"): footsteps, paddle and swim splashes, the surf's crash
   * and rush, the creatures' voices and skills. On by default again (2026-10-25: version 3 turned
   * it on once for everyone; version 2 had turned it off).
   */
  footsteps: boolean;
  /** Walk mode view: through the eyes, or behind the character. */
  walkView: WalkView;
  /** Mouse steering speed while walking, paddling and surfing, 0..1 (see mouseLook). */
  mouseSpeed: number;
  /** Your character (third person, swimming, kayak, surfing). */
  character: CharacterId;
  /** Scene preset last applied ('' = none); its mapped recordings play. */
  activeScene: string;
  /** Play the synthesized soundscape while no recording is playing. */
  synthFallback: boolean;
  /** Control panel: the tab shown. */
  panelTab: PanelTab;
}

// The time bar is always shown above them (Panel), so it isn't one of these.
export const PANEL_TABS = ['scene', 'sound', 'view', 'pets', 'settings'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/**
 * "Bầu trời" (one two-way slider): gloom and clarity as one value, −1 (grey, gloomy) … 0 …
 * +1 (clear, deep blue). They stay two fields because the sky shader uses each on its own; only
 * one of them is ever above 0.
 */
export function skyBalance(v: { gloom: number; clarity: number }): number {
  return v.clarity - v.gloom;
}

export function fromSkyBalance(balance: number): { gloom: number; clarity: number } {
  const b = Math.min(1, Math.max(-1, balance));
  return { gloom: Math.max(0, -b), clarity: Math.max(0, b) };
}

/** The mouse speed setting as a factor on the base look rate: 0.2× … 1.2× (the default 0.4: 0.6×). */
export function mouseLook(speed: number): number {
  return 0.2 + speed;
}

export type SettingsPatch = Partial<Omit<Settings, 'version'>>;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    quality: 'medium',
    autoRotate: false,
    showDebug: false,
    waveStrength: 0.45,
    panelCollapsed: true,
    weatherLinked: false,
    visualRain: 0,
    visualSnow: 0,
    visualWind: 0.3,
    timeMode: 'free',
    timeSpeed: 1,
    timePaused: false,
    clouds: 0.35,
    gloom: 0,
    clarity: 0,
    cirrus: 0,
    rainbow: true,
    stars: true,
    meteors: 0.4,
    aurora: 0.5,
    moonlight: 0.3,
    sunBrightness: 0.5,
    sunSize: 0.5,
    fireflies: true,
    footsteps: true,
    walkView: 'third',
    mouseSpeed: 0.4,
    character: 'default',
    activeScene: 'b-sunny',
    synthFallback: true,
    panelTab: 'scene',
  };
}

type Raw = Record<string, unknown>;

/** Upgrades older stored shapes step by step. Add `n: migrateN` entries when the schema changes. */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  // 1 → 2: activity sounds became opt-in.
  1: (raw) => ({ ...raw, footsteps: false }),
  // 2 → 3: back on by default (and the creature switches are gone: they are always there).
  2: (raw) => ({ ...raw, footsteps: true }),
};

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
/**
 * Clock settings. Before 2026-10-19 one `timeMode` held everything ('real', 'cycle24' = a day
 * in 24 min, 'cycle6' = 6 min, 'paused'); those map to the free island clock, running or stopped.
 * The speed is never read back: the clock always opens at ×1 (2026-10-30), a faster speed is
 * only for the session it was picked in.
 */
function parseClock(raw: Raw, d: Settings): Pick<Settings, 'timeMode' | 'timeSpeed' | 'timePaused'> {
  const paused = typeof raw.timePaused === 'boolean' ? raw.timePaused : d.timePaused;
  switch (raw.timeMode) {
    case 'real':
    case 'free':
      return { timeMode: raw.timeMode, timeSpeed: d.timeSpeed, timePaused: paused };
    case 'cycle24':
    case 'cycle6':
      return { timeMode: 'free', timeSpeed: d.timeSpeed, timePaused: false };
    case 'paused':
      return { timeMode: 'free', timeSpeed: d.timeSpeed, timePaused: true };
    default:
      return { timeMode: d.timeMode, timeSpeed: d.timeSpeed, timePaused: d.timePaused };
  }
}

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

  // Before 2026-10-27 gloom and clarity were two sliders and could both be up: keep the net.
  const sky = fromSkyBalance(skyBalance({ gloom: unit(raw.gloom, defaults.gloom), clarity: unit(raw.clarity, defaults.clarity) }));

  return {
    version: SETTINGS_VERSION,
    quality,
    autoRotate: bool(raw.autoRotate, defaults.autoRotate),
    showDebug: bool(raw.showDebug, defaults.showDebug),
    waveStrength: unit(raw.waveStrength, defaults.waveStrength),
    // The app always opens with the scene in front, the panel shut to its ☰ (2026-10-27). Set here,
    // not by the panel: an update while the app is still being built would reach it half made.
    panelCollapsed: true,
    weatherLinked: bool(raw.weatherLinked, defaults.weatherLinked),
    visualRain: unit(raw.visualRain, defaults.visualRain),
    visualSnow: unit(raw.visualSnow, defaults.visualSnow),
    visualWind: unit(raw.visualWind, defaults.visualWind),
    ...parseClock(raw, defaults),
    clouds: unit(raw.clouds, defaults.clouds),
    ...sky,
    cirrus: unit(raw.cirrus, defaults.cirrus),
    rainbow: bool(raw.rainbow, defaults.rainbow),
    stars: bool(raw.stars, defaults.stars),
    meteors: unit(raw.meteors, defaults.meteors),
    aurora: unit(raw.aurora, defaults.aurora),
    moonlight: unit(raw.moonlight, defaults.moonlight),
    sunBrightness: unit(raw.sunBrightness, defaults.sunBrightness),
    sunSize: unit(raw.sunSize, defaults.sunSize),
    fireflies: bool(raw.fireflies, defaults.fireflies),
    footsteps: bool(raw.footsteps, defaults.footsteps),
    walkView: raw.walkView === 'first' || raw.walkView === 'third' ? raw.walkView : defaults.walkView,
    mouseSpeed: unit(raw.mouseSpeed, defaults.mouseSpeed),
    character: (CHARACTER_IDS as readonly unknown[]).includes(raw.character) ? (raw.character as CharacterId) : defaults.character,
    activeScene: typeof raw.activeScene === 'string' ? raw.activeScene.slice(0, 64) : defaults.activeScene,
    // The accordion's open sections (`panelSections`), "start at the desk" and "click the scene
    // to collapse" (2026-10-27) are dropped: unknown fields are simply ignored.
    panelTab: (PANEL_TABS as readonly unknown[]).includes(raw.panelTab) ? (raw.panelTab as PanelTab) : defaults.panelTab,
    synthFallback: bool(raw.synthFallback, defaults.synthFallback),
  };
}

/** The probe result, so storage is tested once and not on every read and write. */
let storageProbe: Storage | null | undefined;

/** Returns localStorage, or null when it is unavailable (privacy mode, file://, etc.). */
export function safeLocalStorage(): Storage | null {
  if (storageProbe !== undefined) return storageProbe;
  try {
    const s = window.localStorage;
    const probe = '__tsw_probe__';
    s.setItem(probe, probe);
    s.removeItem(probe);
    storageProbe = s;
  } catch {
    storageProbe = null;
  }
  return storageProbe;
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
