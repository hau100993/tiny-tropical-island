import { button, el } from '../ui/components';
import { vi } from '../ui/strings.vi';
import { safeLocalStorage } from '../core/settings';
import { isRecord, parseJson, readStored, writeStored } from '../core/storage';
import { DEVICE_ID_KEY, SYNC_STATE_KEY } from '../core/backup';
import { CLIENT_ID, DriveAuth } from './drive';
import { adoptOther, syncOnce, type SyncFile } from './sync';
import { newEventId, type Roster } from './roster';
import type { TomatoWallet } from './wallet';

/** After a change, upload this long later (ms), so a burst of feeding is one upload. */
const PUSH_DELAY = 30_000;
/** The invitation shows at these moments (and never more than this many times). */
const MAX_INVITES = 3;

export type SyncStatus = 'off' | 'syncing' | 'ok' | 'needsClick' | 'error';

interface SyncState {
  /** The player turned it on (on this device). */
  on: boolean;
  /** Last good sync (ms). */
  lastAt: number;
  /** Invitations dismissed: the milestone each was shown for (1..3). */
  invited: number;
  /** The other device's copy last offered or taken (its exportedAt), so it is offered once. */
  seenOther: number;
}

function loadState(): SyncState {
  const raw = parseJson(readStored(SYNC_STATE_KEY));
  const r = isRecord(raw) ? raw : {};
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return { on: r.on === true, lastAt: n(r.lastAt), invited: n(r.invited), seenOther: n(r.seenOther) };
}

function deviceId(): string {
  let id = readStored(DEVICE_ID_KEY);
  if (!id) {
    id = newEventId('d');
    writeStored(DEVICE_ID_KEY, id);
    return id;
  }
  return (parseJson(id) as string | null) ?? id;
}

/** Milestone reached: 1 a first Rank up, 2 a first Level 2, 3 a first hatched pet. */
function milestone(r: Roster): number {
  if (r.pets.some((p) => p.origin === 'egg')) return 3;
  if (r.pets.some((p) => p.level === 2)) return 2;
  if (r.pets.some((p) => p.rank > 1)) return 1;
  return 0;
}

/**
 * Optional saving to the player's own Google Drive (Phase 13s). Off until the player turns it
 * on; never mentioned to someone who only watches the scene (the invitation needs Thú Cưng
 * progress, and only three times, at milestones). While a token is valid it syncs by itself
 * (after changes, when the tab is hidden); when Google needs a click, a button says so.
 */
export class DriveSync {
  private readonly auth = new DriveAuth();
  private state = loadState();
  private status: SyncStatus = this.state.on ? 'needsClick' : 'off';
  private other: SyncFile | null = null;
  private timer = 0;
  private running: Promise<void> | null = null;
  private readonly listeners: Array<() => void> = [];
  private readonly device = deviceId();

  constructor(private readonly wallet: TomatoWallet) {
    wallet.onChange(() => this.schedule());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.auth.valid) void this.syncNow();
    });
  }

  /** The player turned Drive on (on this device). */
  get on(): boolean {
    return this.state.on;
  }

  /** Built with a Google client id (VITE_GOOGLE_CLIENT_ID): otherwise no Drive at all. */
  get configured(): boolean {
    return CLIENT_ID !== '';
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  /** From a click: sign in (the first time Google asks which account and to allow it), then sync. */
  async connect(): Promise<void> {
    const first = !this.state.on;
    this.setStatus('syncing');
    try {
      await this.auth.connect(first);
      this.save({ on: true });
      await this.syncNow();
    } catch (err) {
      console.warn('Drive sign-in', err);
      this.setStatus(this.state.on ? 'needsClick' : 'off');
    }
  }

  async disconnect(): Promise<void> {
    window.clearTimeout(this.timer);
    await this.auth.disconnect();
    this.save({ on: false });
    this.other = null;
    this.setStatus('off');
  }

  /** One round now (if signed in); concurrent calls share it. */
  syncNow(): Promise<void> {
    if (!this.state.on) return Promise.resolve();
    if (!this.auth.valid) {
      this.setStatus('needsClick');
      return Promise.resolve();
    }
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    const store = safeLocalStorage();
    if (!store) return;
    this.setStatus('syncing');
    try {
      const { fromOther } = await syncOnce(this.auth.transport(), store, (l) => this.wallet.mergeFrom(l), this.device, Date.now());
      if (fromOther && fromOther.exportedAt > this.state.seenOther) this.other = fromOther;
      this.save({ lastAt: Date.now() });
      this.setStatus('ok');
    } catch (err) {
      console.warn('Drive sync', err);
      this.setStatus(this.auth.valid ? 'error' : 'needsClick');
    }
  }

  private schedule(): void {
    if (!this.state.on || !this.auth.valid) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.syncNow(), PUSH_DELAY);
  }

  /** The camp's Drive rows: status and buttons when on; the invitation at milestones; or null. */
  element(roster: Roster): HTMLElement | null {
    if (!this.configured) return null;
    const t = vi.sync;
    if (this.state.on) {
      const box = el('div', 'camp-sync');
      const line = el('div', 'camp-sync-line');
      const label =
        this.status === 'syncing' ? t.syncing : this.status === 'ok' ? t.saved(clock(this.state.lastAt)) : this.status === 'error' ? t.error : t.needsClick;
      line.append(el('span', '', `☁️ ${label}`));
      if (this.status !== 'syncing') {
        const again = button(this.status === 'ok' ? t.syncNow : t.reconnect, () => void (this.auth.valid ? this.syncNow() : this.connect()), 'btn small');
        line.append(again);
      }
      box.append(line);
      const other = this.other;
      if (other) {
        const row = el('div', 'button-row');
        row.append(
          button(t.adopt(clock(other.exportedAt)), () => {
            const store = safeLocalStorage();
            if (!store || !window.confirm(t.adoptConfirm)) return;
            this.save({ seenOther: other.exportedAt });
            adoptOther(store, other);
            location.reload();
          }, 'btn small'),
          button(t.keepMine, () => {
            this.save({ seenOther: other.exportedAt });
            this.other = null;
            this.emit();
          }, 'btn small'),
        );
        box.append(el('div', 'note', t.otherDevice), row);
      }
      const off = button(t.disconnect, () => void this.disconnect(), 'camp-link');
      box.append(off);
      return box;
    }
    const m = milestone(roster);
    if (m > this.state.invited && this.state.invited < MAX_INVITES) {
      const box = el('div', 'camp-notice camp-invite');
      box.append(el('div', '', t.invite));
      const row = el('div', 'button-row');
      row.append(
        button(t.connect, () => void this.connect(), 'btn small primary'),
        button(vi.pets.later, () => {
          this.save({ invited: m });
          this.emit();
        }, 'btn small'),
      );
      box.append(row, el('div', 'note', t.privacy));
      return box;
    }
    // Always reachable, quietly, once the player has some progress.
    if (m === 0) return null;
    const quiet = button(`☁️ ${t.connect}`, () => void this.connect(), 'camp-link');
    quiet.title = t.privacy;
    return quiet;
  }

  private save(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    writeStored(SYNC_STATE_KEY, this.state);
  }

  private setStatus(s: SyncStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function clock(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${d.getDate()}/${d.getMonth() + 1}`;
}
