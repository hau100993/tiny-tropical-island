import { describe, expect, it } from 'vitest';
import {
  addStartingGift,
  DAILY_FOCUS_CAP,
  earnFocus,
  emptyLedger,
  focusToday,
  LIVE_SLACK_MS,
  mergeLedgers,
  MIN_FOCUS_MIN,
  parseLedger,
  STARTING_GIFT_MAX,
  tomatoes,
  type Ledger,
} from '../src/pets/ledger';

const NOON = new Date(2026, 9, 29, 12, 0).getTime();
const MIN = 60_000;

/** `count` sessions of 25 min ending 30 min apart from `start`, each noticed right away. */
function sessions(l: Ledger, start: number, count: number): Ledger {
  let next = l;
  for (let i = 0; i < count; i++) {
    const end = start + i * 30 * MIN;
    next = earnFocus(next, end, 25, end + 1000).ledger;
  }
  return next;
}

describe('tomato ledger', () => {
  it('a finished focus session earns one tomato', () => {
    const r = earnFocus(emptyLedger(), NOON, 25, NOON + 500);
    expect(r.result).toBe('earned');
    expect(tomatoes(r.ledger)).toBe(1);
  });

  it('the same session reported twice (two tabs) counts once', () => {
    const once = earnFocus(emptyLedger(), NOON, 25, NOON).ledger;
    const twice = earnFocus(once, NOON, 25, NOON + 2000);
    expect(twice.result).toBe('duplicate');
    expect(tomatoes(twice.ledger)).toBe(1);
  });

  it('short sessions earn nothing', () => {
    const r = earnFocus(emptyLedger(), NOON, MIN_FOCUS_MIN - 1, NOON);
    expect(r.result).toBe('short');
    expect(tomatoes(r.ledger)).toBe(0);
    expect(earnFocus(emptyLedger(), NOON, MIN_FOCUS_MIN, NOON).result).toBe('earned');
  });

  it('sessions that ran out while the page was closed earn nothing', () => {
    expect(earnFocus(emptyLedger(), NOON, 25, NOON + LIVE_SLACK_MS + 1).result).toBe('late');
    // A hidden tab ticks about once a minute: still counts.
    expect(earnFocus(emptyLedger(), NOON, 25, NOON + 70_000).result).toBe('earned');
  });

  it('caps focus tomatoes per local day', () => {
    const morning = new Date(2026, 9, 29, 0, 30).getTime();
    const full = sessions(emptyLedger(), morning, DAILY_FOCUS_CAP);
    expect(focusToday(full, morning)).toBe(DAILY_FOCUS_CAP);
    const end = morning + DAILY_FOCUS_CAP * 30 * MIN;
    expect(earnFocus(full, end, 25, end).result).toBe('cap');
    const tomorrow = new Date(2026, 9, 30, 9, 0).getTime();
    expect(earnFocus(full, tomorrow, 25, tomorrow).result).toBe('earned');
  });

  it('the starting gift is capped and given once', () => {
    const l = addStartingGift(emptyLedger(), 37, NOON);
    expect(tomatoes(l)).toBe(STARTING_GIFT_MAX);
    expect(tomatoes(addStartingGift(l, 5, NOON + 1))).toBe(STARTING_GIFT_MAX);
    expect(tomatoes(addStartingGift(emptyLedger(), 3, NOON))).toBe(3);
  });

  it('merging two devices keeps every tomato, and merging again changes nothing', () => {
    const pc = sessions(addStartingGift(emptyLedger(), 10, NOON - 5 * MIN), NOON, 3);
    const phone = sessions(addStartingGift(emptyLedger(), 0, NOON - 4 * MIN), NOON + 7 * MIN, 2);
    const merged = mergeLedgers(pc, phone);
    // The larger gift (10) once, plus 3 + 2 sessions.
    expect(tomatoes(merged)).toBe(15);
    expect(mergeLedgers(merged, phone)).toEqual(merged);
    expect(mergeLedgers(phone, pc)).toEqual(merged);
  });

  it('parsing drops broken entries and survives junk', () => {
    expect(parseLedger(null)).toEqual(emptyLedger());
    expect(parseLedger({ events: 'x' })).toEqual(emptyLedger());
    const l = parseLedger({
      v: 1,
      events: [
        { id: 'f1', t: NOON, kind: 'focus', n: 1 },
        { id: 'f1', t: NOON, kind: 'focus', n: 1 },
        { id: '', t: NOON, kind: 'focus', n: 1 },
        { id: 'f2', t: 'noon', kind: 'focus', n: 1 },
        { id: 'z9', t: NOON, kind: 'fromTheFuture', n: 4 },
      ],
    });
    // The unknown kind is kept (a newer save) but counts nothing here.
    expect(l.events.map((e) => e.id)).toEqual(['f1', 'z9']);
    expect(tomatoes(l)).toBe(1);
  });
});
