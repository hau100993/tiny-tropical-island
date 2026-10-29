import { describe, expect, it } from 'vitest';
import {
  advance,
  defaultPomodoroConfig,
  formatRemaining,
  initialState,
  parsePomodoro,
  pause,
  remaining,
  skip,
  start,
} from '../src/ui/pomodoro';

const MIN = 60_000;
const c = defaultPomodoroConfig();

describe('pomodoro state machine', () => {
  it('counts down from the focus length and pauses exactly', () => {
    let s = start(initialState(c), 0);
    expect(remaining(s, 10 * MIN)).toBe(15 * MIN);
    s = pause(s, 10 * MIN);
    expect(s.running).toBe(false);
    expect(remaining(s, 99 * MIN)).toBe(15 * MIN);
    s = start(s, 100 * MIN);
    expect(s.endsAt).toBe(115 * MIN);
  });

  it('auto-continues into a break without drift, even when noticed late', () => {
    const s = start(initialState(c), 0);
    // The tab was hidden; the timer only fires 50 s after the focus ended.
    const r = advance(s, c, 25 * MIN + 50_000);
    expect(r.ended).toEqual(['focus']);
    // When it really ended, for the tomato wallet (it only counts sessions noticed in time).
    expect(r.endedAt).toEqual([25 * MIN]);
    expect(r.state.phase).toBe('break');
    expect(r.state.endsAt).toBe(30 * MIN);
    expect(r.state.completed).toBe(1);
  });

  it('takes a long break after every 4 focus sessions', () => {
    let s = start(initialState(c), 0);
    const ended: string[] = [];
    // 4 × (25 + 5) min minus the last break, then into the long break.
    const r = advance(s, c, 4 * 25 * MIN + 3 * 5 * MIN);
    ended.push(...r.ended);
    s = r.state;
    expect(ended.filter((p) => p === 'focus')).toHaveLength(4);
    expect(s.phase).toBe('longBreak');
    const after = advance(s, c, s.endsAt);
    expect(after.state.phase).toBe('focus');
    expect(after.state.completed).toBe(0);
  });

  it('stops at the start of the next phase without auto-continue', () => {
    const manual = { ...c, autoContinue: false };
    const r = advance(start(initialState(manual), 0), manual, 26 * MIN);
    expect(r.state.phase).toBe('break');
    expect(r.state.running).toBe(false);
    expect(r.state.remainingMs).toBe(5 * MIN);
  });

  it('skip moves to the next phase', () => {
    const s = skip(start(initialState(c), 0), c, 3 * MIN);
    expect(s.phase).toBe('break');
    expect(s.endsAt).toBe(8 * MIN);
  });

  it('a long sleep is bounded and ends paused', () => {
    const r = advance(start(initialState(c), 0), c, 1000 * 24 * 60 * MIN);
    expect(r.ended.length).toBeLessThanOrEqual(64);
    expect(r.state.running).toBe(false);
  });

  it('formats time rounding up', () => {
    expect(formatRemaining(25 * MIN)).toBe('25:00');
    expect(formatRemaining(1)).toBe('0:01');
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(61 * MIN)).toBe('1:01:00');
  });

  it('parses stored data defensively', () => {
    expect(parsePomodoro(null).config).toEqual(c);
    const p = parsePomodoro({ config: { focusMin: 999, breakMin: 'x', longEvery: -3 }, state: { phase: 'nope' } });
    expect(p.config.focusMin).toBe(180);
    expect(p.config.breakMin).toBe(5);
    expect(p.config.longEvery).toBe(0);
    expect(p.state.phase).toBe('focus');
    const q = parsePomodoro({ state: { phase: 'break', running: true, endsAt: 1234, remainingMs: 1, completed: 2 } });
    expect(q.state).toMatchObject({ phase: 'break', running: true, endsAt: 1234, completed: 2 });
  });
});
