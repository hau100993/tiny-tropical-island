import { safeLocalStorage } from './settings';

/** Reads a localStorage key; returns null if missing or storage is unavailable. Never throws. */
export function readStored(key: string): string | null {
  try {
    return safeLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes a localStorage key as JSON; silently ignores full or blocked storage. */
export function writeStored(key: string, value: unknown): void {
  try {
    safeLocalStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Keep working in memory.
  }
}

export function parseJson(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

export function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

export function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
