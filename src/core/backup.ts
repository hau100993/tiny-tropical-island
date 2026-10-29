import { isRecord, parseJson } from './storage';
import { mergeLedgers, parseLedger } from '../pets/ledger';
import { PETS_KEY } from '../pets/wallet';
import { TRACKS_KEY } from '../audio/library/tracks';

/**
 * A backup file: every `tsw.*` localStorage value as its raw JSON string. The recordings
 * themselves live in IndexedDB and are far too big for it, so their list stays out too (on
 * another device it would point at files that are not there).
 */
export interface BackupFile {
  app: typeof BACKUP_APP;
  v: number;
  exportedAt: number;
  data: Record<string, string>;
}

export const BACKUP_APP = 'tiny-tropical-island';
const BACKUP_VERSION = 1;
const PREFIX = 'tsw.';
const SKIP = new Set<string>([TRACKS_KEY]);
const POMODORO_KEY = 'tsw.pomodoro';

/** The parts of `Storage` used here (a plain object stands in for it in tests). */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function collectBackup(store: KeyValueStore, now: number): BackupFile {
  const data: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX) || SKIP.has(key)) continue;
    const value = store.getItem(key);
    if (value !== null) data[key] = value;
  }
  return { app: BACKUP_APP, v: BACKUP_VERSION, exportedAt: now, data };
}

/** Checks a file's text; null if it is not one of our backups. */
export function parseBackup(text: string): BackupFile | null {
  const raw = parseJson(text);
  if (!isRecord(raw) || raw.app !== BACKUP_APP || !isRecord(raw.data)) return null;
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.data)) {
    if (key.startsWith(PREFIX) && !SKIP.has(key) && typeof value === 'string') data[key] = value;
  }
  const exportedAt = typeof raw.exportedAt === 'number' && Number.isFinite(raw.exportedAt) ? raw.exportedAt : 0;
  const v = typeof raw.v === 'number' && Number.isFinite(raw.v) ? raw.v : BACKUP_VERSION;
  return { app: BACKUP_APP, v, exportedAt, data };
}

/**
 * Writes a backup into storage. Settings, to-do and scenes are replaced by the file's; the
 * Thú Cưng log is merged (tomatoes earned here since the backup stay). The Pomodoro keeps only
 * its settings: an old running timer would "finish" sessions that never happened.
 * Returns how many keys were written. The page must reload afterwards.
 */
export function applyBackup(store: KeyValueStore, file: Readonly<BackupFile>): number {
  let written = 0;
  for (const [key, value] of Object.entries(file.data)) {
    let next = value;
    if (key === PETS_KEY) {
      next = JSON.stringify(mergeLedgers(parseLedger(parseJson(store.getItem(key))), parseLedger(parseJson(value))));
    } else if (key === POMODORO_KEY) {
      const raw = parseJson(value);
      next = JSON.stringify(isRecord(raw) ? { config: raw.config } : {});
    }
    try {
      store.setItem(key, next);
      written++;
    } catch {
      // Storage full or blocked: skip this key.
    }
  }
  return written;
}

/** "dao-sao-luu-2026-10-29.json". */
export function backupFileName(now: number): string {
  const d = new Date(now);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `dao-sao-luu-${day}.json`;
}
