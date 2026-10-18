import { isRecord } from '../../core/storage';
import { LAYER_IDS, type LayerId } from '../types';

/** One recording of a layer (see public/audio/README.md). */
export interface AudioFileEntry {
  /** Path relative to the audio folder, forward slashes, e.g. "waves/beach1.ogg". */
  src: string;
  /** Linear gain for this file (level matching between recordings). */
  gain: number;
  /** Loop the file (true) or play it once and move on to the next one. */
  loop: boolean;
  /** Loop points in seconds; `loopEnd` null = end of file. Trims MP3 encoder padding. */
  loopStart: number;
  loopEnd: number | null;
}

export interface LayerFileConfig {
  files: AudioFileEntry[];
  /** Equal-power crossfade length when switching recordings, seconds. */
  crossfadeSec: number;
  /** With several files: switch to another one after a random time in this range, seconds. */
  rotateEverySec: [number, number];
}

export type AudioFileConfig = Partial<Record<LayerId, LayerFileConfig>>;

export interface ParsedAudioConfig {
  layers: AudioFileConfig;
  /** Files named in the config that don't exist (reported once as a console note, not an error). */
  missing: string[];
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** "./waves\a.ogg", "/audio/waves/a.ogg" → "waves/a.ogg" (the form the manifest uses). */
export function normalizeSrc(src: string): string {
  let s = src.trim().replace(/\\/g, '/');
  while (s.startsWith('./') || s.startsWith('/')) s = s.startsWith('./') ? s.slice(2) : s.slice(1);
  if (s.startsWith('audio/')) s = s.slice(6);
  return s;
}

function parseEntry(raw: unknown): AudioFileEntry | null {
  const r = typeof raw === 'string' ? { src: raw } : raw;
  if (!isRecord(r) || typeof r.src !== 'string' || r.src.trim() === '') return null;
  const loopStart = num(r.loopStart, 0, 0, 36000);
  const loopEnd = typeof r.loopEnd === 'number' && Number.isFinite(r.loopEnd) && r.loopEnd > loopStart ? r.loopEnd : null;
  return {
    src: normalizeSrc(r.src),
    gain: num(r.gain, 1, 0, 4),
    loop: typeof r.loop === 'boolean' ? r.loop : true,
    loopStart,
    loopEnd,
  };
}

/**
 * Validates `audio/config.json` against the files that really exist (`available`, from the
 * manifest). Anything malformed is skipped; a layer with no usable file keeps its synth sound.
 * Never throws.
 */
export function parseAudioConfig(raw: unknown, available: ReadonlySet<string>): ParsedAudioConfig {
  const out: ParsedAudioConfig = { layers: {}, missing: [] };
  if (!isRecord(raw) || !isRecord(raw.layers)) return out;
  for (const id of LAYER_IDS) {
    const l = raw.layers[id];
    if (!isRecord(l) || !Array.isArray(l.files)) continue;
    const files: AudioFileEntry[] = [];
    for (const f of l.files) {
      const entry = parseEntry(f);
      if (!entry) continue;
      if (available.has(entry.src)) files.push(entry);
      else out.missing.push(entry.src);
    }
    if (files.length === 0) continue;
    const rot = Array.isArray(l.rotateEverySec) ? l.rotateEverySec : [];
    const a = num(rot[0], 90, 5, 36000);
    const b = num(rot[1], a * 2, a, 36000);
    out.layers[id] = { files, crossfadeSec: num(l.crossfadeSec, 4, 0.05, 30), rotateEverySec: [a, b] };
  }
  return out;
}

/** Fetches a same-origin JSON file; null on any failure. */
async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as unknown) : null;
  } catch {
    return null;
  }
}

/**
 * Loads the optional file configuration. The manifest (written by the Vite plugin) says which
 * files exist, so nothing missing is ever requested. Problems become one `console.info`.
 */
export async function loadAudioFileConfig(): Promise<AudioFileConfig> {
  const manifest = await fetchJson('audio-manifest.json');
  if (!isRecord(manifest) || !Array.isArray(manifest.files) || manifest.config !== true) return {};
  const available = new Set(manifest.files.filter((f): f is string => typeof f === 'string'));
  if (available.size === 0) return {};
  const raw = await fetchJson('audio/config.json');
  if (raw === null) {
    console.info('[audio] audio/config.json is not valid JSON; using synthesized sound.');
    return {};
  }
  const parsed = parseAudioConfig(raw, available);
  if (parsed.missing.length > 0) {
    console.info(`[audio] Not found in public/audio (synth used instead): ${parsed.missing.join(', ')}`);
  }
  return parsed.layers;
}
