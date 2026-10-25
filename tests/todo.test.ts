import { describe, expect, it } from 'vitest';
import {
  addPomodoro,
  addTask,
  completeTask,
  dayKey,
  emptyTodo,
  moveTask,
  parseTodo,
  removeTask,
  restoreTask,
  rollDay,
  toggleCurrent,
  type TodoState,
} from '../src/ui/todo';

const NOON = new Date(2026, 9, 25, 12, 0).getTime();
const NEXT_DAY = new Date(2026, 9, 26, 0, 1).getTime();

function withTasks(...texts: string[]): TodoState {
  return texts.reduce((s, t, i) => addTask(s, t, `t${i}`), emptyTodo(NOON));
}

describe('to-do list', () => {
  it('adds tasks at the bottom, trims them and ignores blank ones', () => {
    let s = withTasks('Viết shader', '  Sửa   layout  ');
    s = addTask(s, '   ', 'x');
    expect(s.open.map((t) => t.text)).toEqual(['Viết shader', 'Sửa layout']);
  });

  it('finishing moves a task to the top of today’s list and clears it as current', () => {
    let s = toggleCurrent(withTasks('a', 'b', 'c'), 't1');
    s = completeTask(s, 't0');
    s = completeTask(s, 't1');
    expect(s.open.map((t) => t.id)).toEqual(['t2']);
    expect(s.done.map((t) => t.id)).toEqual(['t1', 't0']);
    expect(s.current).toBeNull();
  });

  it('restoring puts a finished task back at the bottom with its tomatoes', () => {
    let s = toggleCurrent(withTasks('a', 'b'), 't0');
    s = addPomodoro(s);
    s = restoreTask(completeTask(s, 't0'), 't0');
    expect(s.open.map((t) => [t.id, t.pomos])).toEqual([
      ['t1', 0],
      ['t0', 1],
    ]);
    expect(s.done).toEqual([]);
  });

  it('reorders by drag index, clamped to the list', () => {
    const s = withTasks('a', 'b', 'c', 'd');
    expect(moveTask(s, 't3', 0).open.map((t) => t.id)).toEqual(['t3', 't0', 't1', 't2']);
    expect(moveTask(s, 't0', 2).open.map((t) => t.id)).toEqual(['t1', 't2', 't0', 't3']);
    expect(moveTask(s, 't1', 99).open.map((t) => t.id)).toEqual(['t0', 't2', 't3', 't1']);
  });

  it('counts focus sessions for the day and for the current task only', () => {
    let s = addPomodoro(withTasks('a', 'b'));
    expect(s.pomosToday).toBe(1);
    expect(s.open.every((t) => t.pomos === 0)).toBe(true);
    s = addPomodoro(toggleCurrent(s, 't1'), 2);
    expect(s.pomosToday).toBe(3);
    expect(s.open[1].pomos).toBe(2);
    expect(toggleCurrent(s, 't1').current).toBeNull();
  });

  it('a new day clears the finished list and the day’s count, keeping open tasks', () => {
    let s = addPomodoro(completeTask(withTasks('a', 'b'), 't0'));
    s = rollDay(s, NEXT_DAY);
    expect(s.done).toEqual([]);
    expect(s.pomosToday).toBe(0);
    expect(s.open.map((t) => t.id)).toEqual(['t1']);
    expect(s.day).toBe(dayKey(NEXT_DAY));
  });

  it('removes from either list', () => {
    const s = completeTask(withTasks('a', 'b'), 't0');
    const r = removeTask(removeTask(s, 't0'), 't1');
    expect(r.open).toEqual([]);
    expect(r.done).toEqual([]);
  });

  it('parses stored data defensively', () => {
    expect(parseTodo(null, NOON)).toEqual(emptyTodo(NOON));
    const s = parseTodo(
      {
        open: [{ id: 'a', text: ' x ', pomos: 2.4 }, { id: 'a', text: 'dup' }, { id: 'b', text: '' }, 'junk'],
        done: [{ id: 'c', text: 'y', pomos: -1 }],
        current: 'zzz',
        day: dayKey(NOON),
        pomosToday: 3,
      },
      NOON,
    );
    expect(s.open).toEqual([{ id: 'a', text: 'x', pomos: 2 }]);
    expect(s.done).toEqual([{ id: 'c', text: 'y', pomos: 0 }]);
    expect(s.current).toBeNull();
    expect(s.pomosToday).toBe(3);
    // Stored yesterday: finished tasks are gone.
    expect(parseTodo({ open: [], done: [{ id: 'c', text: 'y' }], day: '2000-01-01' }, NOON).done).toEqual([]);
  });
});
