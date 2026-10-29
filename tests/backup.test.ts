import { describe, expect, it } from 'vitest';
import { applyBackup, backupFileName, collectBackup, parseBackup, type KeyValueStore } from '../src/core/backup';
import { earnFocus, emptyLedger, parseLedger, tomatoes } from '../src/pets/ledger';

const NOON = new Date(2026, 9, 29, 12, 0).getTime();

/** A Map behind the localStorage calls the backup uses. */
function memoryStore(init: Record<string, string> = {}): KeyValueStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const ledgerJson = (...ends: number[]): string =>
  JSON.stringify(ends.reduce((l, end) => earnFocus(l, end, 25, end).ledger, emptyLedger()));

describe('backup file', () => {
  it('holds the app’s keys only, without the recordings list', () => {
    const store = memoryStore({ 'tsw.settings': '{"quality":"high"}', 'tsw.tracks': '[]', other: '1' });
    const file = collectBackup(store, NOON);
    expect(Object.keys(file.data)).toEqual(['tsw.settings']);
    expect(parseBackup(JSON.stringify(file))).toEqual(file);
  });

  it('rejects files that are not ours', () => {
    expect(parseBackup('not json')).toBeNull();
    expect(parseBackup('{"app":"someone-else","data":{}}')).toBeNull();
  });

  it('replaces settings but merges tomatoes', () => {
    const backup = collectBackup(memoryStore({ 'tsw.settings': '{"quality":"low"}', 'tsw.pets': ledgerJson(NOON) }), NOON);
    // Since the backup, this device earned another one.
    const here = memoryStore({ 'tsw.settings': '{"quality":"high"}', 'tsw.pets': ledgerJson(NOON + 3_600_000) });
    applyBackup(here, backup);
    expect(here.map.get('tsw.settings')).toBe('{"quality":"low"}');
    expect(tomatoes(parseLedger(JSON.parse(here.map.get('tsw.pets') ?? 'null')))).toBe(2);
  });

  it('keeps only the Pomodoro’s settings, not an old running timer', () => {
    const pomodoro = JSON.stringify({ config: { focusMin: 30 }, state: { phase: 'focus', running: true, endsAt: NOON }, visible: true });
    const here = memoryStore();
    applyBackup(here, collectBackup(memoryStore({ 'tsw.pomodoro': pomodoro }), NOON));
    expect(JSON.parse(here.map.get('tsw.pomodoro') ?? '{}')).toEqual({ config: { focusMin: 30 } });
  });

  it('names the file by date', () => {
    expect(backupFileName(NOON)).toBe('dao-sao-luu-2026-10-29.json');
  });
});
