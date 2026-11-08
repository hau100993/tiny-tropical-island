import { describe, expect, it } from 'vitest';
import { HuntScore, parseHuntSave, SCORE } from '../src/activities/flight/huntScore';
import { earnBubble, emptyLedger, tomatoes } from '../src/pets/ledger';

describe('HuntScore combo', () => {
  it('grows within the gap and resets after it', () => {
    const s = new HuntScore({ total: 0, toward: 0 });
    s.add(0, 1000);
    expect(s.combo).toBe(1);
    s.add(1.5, 2500);
    expect(s.combo).toBe(2);
    s.add(3.4, 4400);
    expect(s.combo).toBe(3);
    s.add(5.5, 6500);
    expect(s.combo).toBe(1);
  });

  it('a long jump in time (tab hidden) resets the combo', () => {
    const s = new HuntScore({ total: 0, toward: 0 });
    s.add(0, 0);
    s.add(1, 0);
    s.add(101, 0);
    expect(s.combo).toBe(1);
  });

  it('a burst exactly at the gap still chains', () => {
    const s = new HuntScore({ total: 0, toward: 0 });
    s.add(0, 0);
    s.add(SCORE.comboGap, 0);
    expect(s.combo).toBe(2);
  });
});

describe('HuntScore tomatoes', () => {
  it('the 30th burst returns a tomato id from the wall clock, then starts over', () => {
    const s = new HuntScore({ total: 0, toward: 0 });
    for (let i = 0; i < SCORE.block - 1; i++) expect(s.add(i * 10, 1000 + i)).toBeNull();
    expect(s.toward).toBe(SCORE.block - 1);
    expect(s.add(1000, 777_000)).toBe('b777000');
    expect(s.toward).toBe(0);
    expect(s.total).toBe(SCORE.block);
  });

  it('continues from a saved count', () => {
    const s = new HuntScore({ total: 100, toward: 29 });
    expect(s.add(0, 5)).toBe('b5');
    expect(s.save()).toEqual({ total: 101, toward: 0 });
  });
});

describe('parseHuntSave', () => {
  it('gives zeros for bad input', () => {
    expect(parseHuntSave(null)).toEqual({ total: 0, toward: 0 });
    expect(parseHuntSave('x')).toEqual({ total: 0, toward: 0 });
    expect(parseHuntSave({ total: 'x', toward: 3 })).toEqual({ total: 0, toward: 3 });
  });
  it('clamps toward into 0 … block − 1 and rounds', () => {
    expect(parseHuntSave({ total: 5.6, toward: 99 })).toEqual({ total: 6, toward: SCORE.block - 1 });
    expect(parseHuntSave({ total: -4, toward: -2 })).toEqual({ total: 0, toward: 0 });
  });
});

describe('earnBubble', () => {
  it('pays one tomato per id', () => {
    const l0 = emptyLedger();
    const a = earnBubble(l0, 'b123', 123);
    expect(a.earned).toBe(true);
    expect(tomatoes(a.ledger)).toBe(tomatoes(l0) + 1);
    const b = earnBubble(a.ledger, 'b123', 123);
    expect(b.earned).toBe(false);
    expect(tomatoes(b.ledger)).toBe(tomatoes(a.ledger));
  });
});

describe('HuntScore.resetClock', () => {
  it('breaks the chain when the clock restarts at 0', () => {
    const s = new HuntScore({ total: 0, toward: 0 });
    s.add(5000, 0);
    s.resetClock();
    s.add(0.5, 0);
    expect(s.combo).toBe(1);
  });
});
