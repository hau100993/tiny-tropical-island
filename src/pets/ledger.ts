import { isRecord } from '../core/storage';
import { dayKey } from '../ui/todo';

/**
 * The Thú Cưng save is a log of events, not a balance: the number of tomatoes (and later Ranks,
 * eggs …) is computed from it. Every event has a unique id, so two copies of the log (a PC and a
 * phone, a backup and the current data) merge by a plain union by id without losing anything,
 * and merging the same copy twice changes nothing.
 */
export const LEDGER_VERSION = 1;

/** At most this many old 🍅 from the to-do history become the starting gift. */
export const STARTING_GIFT_MAX = 10;
/** A focus session shorter than this (minutes, as configured) earns no tomato. */
export const MIN_FOCUS_MIN = 20;
/** At most this many tomatoes from focus sessions per local day. */
export const DAILY_FOCUS_CAP = 16;
/**
 * A session only counts if the page saw it end: found later than this after its end (ms), it ran
 * out while the browser was closed or the computer asleep. Hidden tabs still tick about once a
 * minute, so a few minutes is enough slack.
 */
export const LIVE_SLACK_MS = 3 * 60_000;

/**
 * One entry of the log. `n`: how many tomatoes it moves (in or out by kind, see TOMATO_SIGN);
 * `pet`: the creature it is about; `s`: a short value (a name, an egg tier, a list of ids).
 */
export interface PetEvent {
  id: string;
  /** When it happened (ms since epoch). */
  t: number;
  kind: string;
  n: number;
  pet?: string;
  s?: string;
}

export interface Ledger {
  v: number;
  events: PetEvent[];
}

/** How each kind changes the tomato count per unit of `n`. Unknown kinds (a newer save) count 0. */
const TOMATO_SIGN: Readonly<Record<string, number>> = { focus: 1, gift: 1, feed: -1, evolve: -1, egg: -1, trust: -1 };

const GIFT_ID = 'gift';
const MAX_EVENTS = 50_000;

export function emptyLedger(): Ledger {
  return { v: LEDGER_VERSION, events: [] };
}

/**
 * Tomatoes on hand. Two devices spending the same tomatoes offline can leave the merged log
 * below zero: shown as 0, and the next ones earned pay it back.
 */
export function tomatoes(l: Readonly<Ledger>): number {
  return Math.max(0, tomatoBalance(l));
}

export function tomatoBalance(l: Readonly<Ledger>): number {
  let sum = 0;
  for (const e of l.events) sum += (TOMATO_SIGN[e.kind] ?? 0) * e.n;
  return sum;
}

/** Tomatoes from focus sessions on the local day of `now`. */
export function focusToday(l: Readonly<Ledger>, now: number): number {
  const day = dayKey(now);
  let n = 0;
  for (const e of l.events) if (e.kind === 'focus' && dayKey(e.t) === day) n += e.n;
  return n;
}

export function hasGift(l: Readonly<Ledger>): boolean {
  return l.events.some((e) => e.id === GIFT_ID);
}

/**
 * The one-time starting gift from the to-do history (capped). Its id is fixed, so it is given
 * once per player even across devices: a merge keeps the larger of two gifts.
 */
export function addStartingGift(l: Readonly<Ledger>, history: number, now: number): Ledger {
  if (hasGift(l)) return l as Ledger;
  const n = Math.min(STARTING_GIFT_MAX, Math.max(0, Math.floor(history)));
  return withEvent(l, { id: GIFT_ID, t: now, kind: 'gift', n });
}

export type EarnResult = 'earned' | 'short' | 'late' | 'cap' | 'duplicate';

/**
 * A focus session ended at `endedAt` and the page noticed it at `now`. The id comes from the end
 * time, so two tabs reporting the same session add it once.
 */
export function earnFocus(
  l: Readonly<Ledger>,
  endedAt: number,
  focusMin: number,
  now: number,
): { ledger: Ledger; result: EarnResult } {
  const id = `f${Math.round(endedAt)}`;
  if (l.events.some((e) => e.id === id)) return { ledger: l as Ledger, result: 'duplicate' };
  if (focusMin < MIN_FOCUS_MIN) return { ledger: l as Ledger, result: 'short' };
  if (now - endedAt > LIVE_SLACK_MS) return { ledger: l as Ledger, result: 'late' };
  if (focusToday(l, endedAt) >= DAILY_FOCUS_CAP) return { ledger: l as Ledger, result: 'cap' };
  return { ledger: withEvent(l, { id, t: endedAt, kind: 'focus', n: 1 }), result: 'earned' };
}

/** Union by id. The same id twice: the larger `n` wins (only the gift can differ). */
export function mergeLedgers(a: Readonly<Ledger>, b: Readonly<Ledger>): Ledger {
  const byId = new Map<string, PetEvent>();
  for (const e of [...a.events, ...b.events]) {
    const old = byId.get(e.id);
    if (!old || e.n > old.n) byId.set(e.id, e);
  }
  return { v: Math.max(a.v, b.v, LEDGER_VERSION), events: sortEvents([...byId.values()]) };
}

/** Validates stored or imported data; invalid entries are dropped. Never throws. */
export function parseLedger(raw: unknown): Ledger {
  if (!isRecord(raw) || !Array.isArray(raw.events)) return emptyLedger();
  const v = typeof raw.v === 'number' && Number.isFinite(raw.v) ? Math.max(LEDGER_VERSION, Math.floor(raw.v)) : LEDGER_VERSION;
  const parsed: Ledger = { v, events: [] };
  for (const e of raw.events) {
    if (!isRecord(e)) continue;
    const { id, t, kind, n } = e;
    if (typeof id !== 'string' || id.length === 0 || id.length > 40) continue;
    if (typeof kind !== 'string' || kind.length === 0 || kind.length > 16) continue;
    if (typeof t !== 'number' || !Number.isFinite(t) || typeof n !== 'number' || !Number.isFinite(n)) continue;
    const ev: PetEvent = { id, t, kind, n: Math.round(n) };
    if (typeof e.pet === 'string' && e.pet.length > 0 && e.pet.length <= 40) ev.pet = e.pet;
    if (typeof e.s === 'string' && e.s.length <= 200) ev.s = e.s;
    parsed.events.push(ev);
    if (parsed.events.length >= MAX_EVENTS) break;
  }
  // Through the merge: duplicates collapse and the order is canonical.
  return mergeLedgers(parsed, emptyLedger());
}

export function withEvent(l: Readonly<Ledger>, e: PetEvent): Ledger {
  return { v: l.v, events: sortEvents([...l.events, e]) };
}

function sortEvents(events: PetEvent[]): PetEvent[] {
  return events.sort((x, y) => x.t - y.t || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
