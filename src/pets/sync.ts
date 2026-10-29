import { applyBackup, collectBackup, parseBackup, type BackupFile, type KeyValueStore } from '../core/backup';
import { parseJson } from '../core/storage';
import { mergeLedgers, parseLedger, type Ledger } from './ledger';
import { PETS_KEY } from './wallet';

/**
 * The Drive copy is a backup file (core/backup.ts) plus which device wrote it. Syncing: download
 * it, merge its Thú Cưng log into this device's (never loses a tomato), then upload this
 * device's data with the merged log. Settings, to-do and scenes are not merged (they have no
 * history): a copy written by another device is offered as "use that device's" instead.
 */
export const SYNC_FILE = 'dao-nhiet-doi-sync.json';

export interface SyncFile extends BackupFile {
  device: string;
}

/** What the sync needs from Google Drive (a fake one in tests). */
export interface DriveTransport {
  /** The app's file in its hidden Drive folder, if there is one. */
  find(): Promise<string | null>;
  download(id: string): Promise<string>;
  create(body: string): Promise<string>;
  update(id: string, body: string): Promise<void>;
}

export interface SyncResult {
  /** The copy found on Drive was written by another device (its settings and to-do may be newer). */
  fromOther: SyncFile | null;
}

/**
 * One round: pull, merge the log (through `mergeLog`, which writes it), push. `store` is
 * localStorage (read after the merge, so the upload has the merged log).
 */
export async function syncOnce(t: DriveTransport, store: KeyValueStore, mergeLog: (l: Ledger) => void, device: string, now: number): Promise<SyncResult> {
  const id = await t.find();
  let fromOther: SyncFile | null = null;
  if (id) {
    const remote = parseSyncFile(await t.download(id));
    if (remote) {
      const log = remote.data[PETS_KEY];
      if (log) mergeLog(parseLedger(parseJson(log)));
      if (remote.device !== device) fromOther = remote;
    }
  }
  const body = JSON.stringify({ ...collectBackup(store, now), device } satisfies SyncFile);
  if (id) await t.update(id, body);
  else await t.create(body);
  return { fromOther };
}

export function parseSyncFile(text: string): SyncFile | null {
  const backup = parseBackup(text);
  if (!backup) return null;
  const raw = parseJson(text) as { device?: unknown } | null;
  return { ...backup, device: typeof raw?.device === 'string' ? raw.device : '' };
}

/** "Use the other device's settings and to-do": like importing a backup (the log merges). */
export function adoptOther(store: KeyValueStore, file: Readonly<SyncFile>): void {
  // The log on this device already has everything merged: keep it, take the rest.
  const local = parseLedger(parseJson(store.getItem(PETS_KEY)));
  applyBackup(store, file);
  const merged = mergeLedgers(local, parseLedger(parseJson(store.getItem(PETS_KEY))));
  store.setItem(PETS_KEY, JSON.stringify(merged));
}
