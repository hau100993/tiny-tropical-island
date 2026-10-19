import { clamp01, isRecord } from '../../core/storage';
import { sanitizeTrackName, type TrackMapping } from './tracks';

/** Bundled-track ids start with this, so they never clash with the user's own recordings. */
export const BUNDLED_PREFIX = 'b:';
/** Bundled tracks the user removed from the list (they stay hidden until restored). */
export const HIDDEN_KEY = 'tsw.tracksHidden';
/**
 * Default scene mappings already offered to the user ("trackId>presetId"). A mapping added to
 * library.json later is given once to tracks already in the list; one the user removed stays
 * removed. Lists stored before this key existed had the first two defaults.
 */
export const OFFERED_KEY = 'tsw.tracksOffered';
export const FIRST_DEFAULTS: readonly string[] = ['b:island-day>b-sunny', 'b:island-night>b-campfire'];

/** A recording shipped with the app in `public/audio/library/`, listed in `library.json`. */
export interface BundledTrack {
  id: string;
  name: string;
  /** URL relative to the page, e.g. "audio/library/island-day.mp3". */
  src: string;
  size: number;
  mappings: TrackMapping[];
}

/**
 * Validates `library.json` against the manifest (files that really exist, with their sizes).
 * Entries whose file is missing are skipped, so the list can name files that aren't there yet.
 * Never throws.
 */
export function parseBundled(raw: unknown, sizes: ReadonlyMap<string, number>): BundledTrack[] {
  if (!isRecord(raw) || !Array.isArray(raw.tracks)) return [];
  const out: BundledTrack[] = [];
  for (const t of raw.tracks) {
    if (!isRecord(t) || typeof t.id !== 'string' || typeof t.file !== 'string' || typeof t.name !== 'string') continue;
    const file = t.file.replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/^audio\//, '');
    const size = sizes.get(file);
    const name = sanitizeTrackName(t.name);
    const id = BUNDLED_PREFIX + t.id.trim();
    if (size === undefined || !name || t.id.trim() === '' || out.some((b) => b.id === id)) continue;
    const mappings: TrackMapping[] = [];
    if (Array.isArray(t.mappings)) {
      for (const m of t.mappings) {
        if (!isRecord(m) || typeof m.presetId !== 'string' || mappings.some((x) => x.presetId === m.presetId)) continue;
        mappings.push({ presetId: m.presetId, volume: clamp01(m.volume, 0.7) });
      }
    }
    out.push({ id, name, src: `audio/${file}`, size, mappings });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Loads the bundled track list. The manifest (written by the Vite plugin) says whether the list
 * and its files exist, so nothing missing is ever requested (no red 404s in the console).
 */
export async function loadBundled(): Promise<BundledTrack[]> {
  const manifest = await fetchJson('audio-manifest.json');
  if (!isRecord(manifest) || manifest.library !== true || !isRecord(manifest.sizes)) return [];
  const sizes = new Map<string, number>();
  for (const [file, size] of Object.entries(manifest.sizes)) {
    if (typeof size === 'number') sizes.set(file, size);
  }
  return parseBundled(await fetchJson('audio/library/library.json'), sizes);
}
