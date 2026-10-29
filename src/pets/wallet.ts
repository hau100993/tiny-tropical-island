import { parseJson, readStored, writeStored } from '../core/storage';
import { addStartingGift, earnFocus, emptyLedger, mergeLedgers, parseLedger, tomatoes, withEvent, type EarnResult, type Ledger } from './ledger';
import { buildRoster, type Action, type Roster } from './roster';

export const PETS_KEY = 'tsw.pets';

/** A focus session that just ended, as the Pomodoro reports it. */
export interface FocusSession {
  endedAt: number;
  /** The configured focus length (minutes). */
  minutes: number;
}

/**
 * The tomato wallet: the event log in localStorage. Every write first merges what storage holds
 * now, so a second tab's tomatoes are never overwritten; the `storage` event keeps tabs in step.
 */
export class TomatoWallet {
  private ledger: Ledger;
  private cached: Roster | null = null;
  private readonly listeners: Array<() => void> = [];
  private askedPersist = false;

  constructor() {
    this.ledger = load();
    window.addEventListener('storage', (e) => {
      if (e.key !== PETS_KEY) return;
      this.ledger = mergeLedgers(this.ledger, load());
      this.cached = null;
      this.emit();
    });
  }

  get count(): number {
    return tomatoes(this.ledger);
  }

  /** Who you have, eggs, trust, team: worked out from the log (cached until it changes). */
  get roster(): Roster {
    this.cached ??= buildRoster(this.ledger);
    return this.cached;
  }

  /** The log itself (for the Drive sync). */
  get log(): Ledger {
    return this.ledger;
  }

  /** Merges a copy of the log from elsewhere (the Drive sync). */
  mergeFrom(other: Ledger): void {
    this.commit((l) => mergeLedgers(l, other));
  }

  /**
   * Runs a game action against the latest roster (another tab's changes included) and adds its
   * event if allowed. Returns the action (with the reason when refused).
   */
  act(make: (r: Roster) => Action): Action {
    let result: Action = { ok: false, why: 'unknown' };
    this.commit((l) => {
      result = make(buildRoster(l));
      return result.ok ? withEvent(l, result.event) : l;
    });
    return result;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  /** Once per player: old 🍅 from the to-do list (capped in `addStartingGift`). */
  giveStartingGift(history: number): void {
    this.commit((l) => addStartingGift(l, history, Date.now()));
  }

  /** Returns what happened to each session, in order. */
  earn(sessions: readonly FocusSession[]): EarnResult[] {
    const now = Date.now();
    const results: EarnResult[] = [];
    this.commit((l) => {
      let next = l;
      for (const s of sessions) {
        const r = earnFocus(next, s.endedAt, s.minutes, now);
        next = r.ledger;
        results.push(r.result);
      }
      return next;
    });
    if (results.includes('earned')) this.askPersist();
    return results;
  }

  private commit(change: (l: Ledger) => Ledger): void {
    const before = this.ledger.events.length;
    const base = mergeLedgers(this.ledger, load());
    const next = change(base);
    this.ledger = next;
    this.cached = null;
    // Only when storage lags behind (a write fires `storage` in the other tabs).
    if (JSON.stringify(next) !== readStored(PETS_KEY)) writeStored(PETS_KEY, next);
    if (next.events.length !== before) this.emit();
  }

  /**
   * Asks the browser not to clear the site's data when the disk fills up (it does not protect
   * against the user clearing it). Asked after the first tomato, not at load: Firefox shows a
   * prompt for it.
   */
  private askPersist(): void {
    if (this.askedPersist) return;
    this.askedPersist = true;
    const storage = navigator.storage;
    if (!storage?.persist) return;
    void storage
      .persisted()
      .then((done) => (done ? true : storage.persist()))
      .catch(() => false);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function load(): Ledger {
  const raw = readStored(PETS_KEY);
  return raw ? parseLedger(parseJson(raw)) : emptyLedger();
}
