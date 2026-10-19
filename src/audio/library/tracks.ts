import { bool, clamp01, isRecord } from '../../core/storage';

export const TRACKS_KEY = 'tsw.tracks';
export const MAX_TRACK_NAME = 40;

/** A scene preset this recording plays with, and how loud. */
export interface TrackMapping {
  presetId: string;
  volume: number;
}

/**
 * One of the user's recordings. The audio data itself is in IndexedDB (key = id); this small
 * record lives in localStorage.
 */
export interface TrackMeta {
  id: string;
  name: string;
  /** Size in bytes (shown in the list). */
  size: number;
  /** Volume when played on its own (the ▶ button). */
  volume: number;
  /** Played on its own, independent of the scene. */
  playing: boolean;
  /** Plays automatically while one of these scene presets is active. */
  mappings: TrackMapping[];
  /** Shipped with the app: streamed from this URL instead of browser storage. */
  src?: string;
}

/** Trims and shortens a user-typed name; null if nothing usable is left. */
export function sanitizeTrackName(name: string): string | null {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_TRACK_NAME);
  return clean.length > 0 ? clean : null;
}

/** "Sóng biển 1h.mp3" → "Sóng biển 1h". */
export function nameFromFile(fileName: string): string {
  return sanitizeTrackName(fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')) ?? 'Âm thanh';
}

/** Validates the stored track list; invalid entries are dropped. Never throws. */
export function parseTracks(raw: unknown): TrackMeta[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackMeta[] = [];
  const ids = new Set<string>();
  for (const t of raw) {
    if (!isRecord(t) || typeof t.id !== 'string' || ids.has(t.id) || typeof t.name !== 'string') continue;
    const name = sanitizeTrackName(t.name);
    if (!name) continue;
    ids.add(t.id);
    const mappings: TrackMapping[] = [];
    if (Array.isArray(t.mappings)) {
      for (const m of t.mappings) {
        if (!isRecord(m) || typeof m.presetId !== 'string' || mappings.some((x) => x.presetId === m.presetId)) continue;
        mappings.push({ presetId: m.presetId, volume: clamp01(m.volume, 0.7) });
      }
    }
    out.push({
      id: t.id,
      name,
      size: typeof t.size === 'number' && Number.isFinite(t.size) ? Math.max(0, t.size) : 0,
      volume: clamp01(t.volume, 0.7),
      playing: bool(t.playing, false),
      mappings,
      ...(typeof t.src === 'string' ? { src: t.src } : {}),
    });
  }
  return out;
}

/**
 * Slider position (0..1) a track should play at: the active scene's volume if it is mapped to
 * it (scaled by the Pomodoro calm factor), or its own volume if it is switched on by itself;
 * the louder of the two.
 */
export function trackLevel(t: Readonly<TrackMeta>, activePreset: string, calm: number): number {
  const mapped = t.mappings.find((m) => m.presetId === activePreset);
  const scene = mapped ? mapped.volume * calm : 0;
  const own = t.playing ? t.volume : 0;
  return Math.max(scene, own);
}

/** "58.2 MB" style size label. */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
