import { describe, expect, it } from 'vitest';
import { syncOnce, adoptOther, parseSyncFile, type DriveTransport } from '../src/pets/sync';
import { earnFocus, emptyLedger, mergeLedgers, parseLedger, tomatoes, type Ledger } from '../src/pets/ledger';
import type { KeyValueStore } from '../src/core/backup';

const T = new Date(2026, 9, 29, 10, 0).getTime();

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

/** A Drive with one file (or none), in memory. */
function fakeDrive(): DriveTransport & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    find: async () => [...files.keys()][0] ?? null,
    download: async (id) => files.get(id) ?? '',
    create: async (body) => {
      files.set('f1', body);
      return 'f1';
    },
    update: async (id, body) => void files.set(id, body),
  };
}

const log = (...ends: number[]): Ledger => ends.reduce((l, e) => earnFocus(l, e, 25, e).ledger, emptyLedger());

/** A device: its storage and a merge that writes the log there (as the wallet does). */
function device(l: Ledger, extra: Record<string, string> = {}): { store: ReturnType<typeof memoryStore>; merge: (other: Ledger) => void } {
  const store = memoryStore({ 'tsw.pets': JSON.stringify(l), ...extra });
  return {
    store,
    merge: (other) => store.setItem('tsw.pets', JSON.stringify(mergeLedgers(parseLedger(JSON.parse(store.getItem('tsw.pets') ?? 'null')), other))),
  };
}

const count = (s: KeyValueStore): number => tomatoes(parseLedger(JSON.parse(s.getItem('tsw.pets') ?? 'null')));

describe('Drive sync', () => {
  it('two devices end up with every tomato from both', async () => {
    const drive = fakeDrive();
    const pc = device(log(T, T + 3_600_000));
    const phone = device(log(T + 7_200_000));
    await syncOnce(drive, pc.store, pc.merge, 'pc', T);
    const r = await syncOnce(drive, phone.store, phone.merge, 'phone', T + 1);
    expect(count(phone.store)).toBe(3);
    // The phone learns the copy came from the PC (its settings could be taken).
    expect(r.fromOther?.device).toBe('pc');
    await syncOnce(drive, pc.store, pc.merge, 'pc', T + 2);
    expect(count(pc.store)).toBe(3);
    expect(parseSyncFile(drive.files.get('f1') ?? '')?.device).toBe('pc');
  });

  it('never copies the device id or the Drive state', async () => {
    const drive = fakeDrive();
    const pc = device(log(T), { 'tsw.deviceId': '"pc"', 'tsw.sync': '{"on":true}', 'tsw.todo': '{"open":[]}' });
    await syncOnce(drive, pc.store, pc.merge, 'pc', T);
    const file = parseSyncFile(drive.files.get('f1') ?? '');
    expect(Object.keys(file?.data ?? {}).sort()).toEqual(['tsw.pets', 'tsw.todo']);
  });

  it('taking the other device’s settings keeps this device’s tomatoes', async () => {
    const drive = fakeDrive();
    const pc = device(log(T), { 'tsw.settings': '{"quality":"high"}' });
    await syncOnce(drive, pc.store, pc.merge, 'pc', T);
    const phone = device(log(T + 99_000_000), { 'tsw.settings': '{"quality":"low"}' });
    const { fromOther } = await syncOnce(drive, phone.store, phone.merge, 'phone', T + 1);
    adoptOther(phone.store, fromOther!);
    expect(phone.store.getItem('tsw.settings')).toBe('{"quality":"high"}');
    expect(count(phone.store)).toBe(2);
  });
});
