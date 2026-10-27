import { isRecord } from '../core/storage';

/**
 * A task on the desk's to-do list. `pomos`: focus sessions finished while it was the current
 * task; `est`: how many it was expected to take (missing or 0: no estimate).
 */
export interface Task {
  id: string;
  text: string;
  pomos: number;
  est?: number;
}

/** The largest estimate (a click on 🍅 past it goes back to none). */
export const MAX_EST = 8;

/**
 * The to-do list. Open tasks are in priority order; the top one is the task being worked on (it
 * gets the 🍅 when a focus session ends). Finished ones stay in `done` (newest first) for the
 * day they were finished on; `day` is that local date, and a new day clears them and the day's
 * Pomodoro count.
 */
export interface TodoState {
  open: Task[];
  done: Task[];
  day: string;
  /** Focus sessions finished today. */
  pomosToday: number;
}

export const MAX_TEXT = 120;
const MAX_OPEN = 60;
const MAX_DONE = 100;

/** Local calendar date, "YYYY-MM-DD". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyTodo(now: number): TodoState {
  return { open: [], done: [], day: dayKey(now), pomosToday: 0 };
}

/** A new day: yesterday's finished tasks and Pomodoro count go away. */
export function rollDay(s: Readonly<TodoState>, now: number): TodoState {
  const day = dayKey(now);
  return day === s.day ? (s as TodoState) : { ...s, done: [], pomosToday: 0, day };
}

/** Adds a task at the bottom. Blank text is ignored. */
export function addTask(s: Readonly<TodoState>, text: string, id: string): TodoState {
  const t = cleanText(text);
  if (!t || s.open.length >= MAX_OPEN) return s as TodoState;
  return { ...s, open: [...s.open, { id, text: t, pomos: 0 }] };
}

/** Moves an open task to the top of today's finished list. */
export function completeTask(s: Readonly<TodoState>, id: string): TodoState {
  const task = s.open.find((t) => t.id === id);
  if (!task) return s as TodoState;
  return {
    ...s,
    open: s.open.filter((t) => t.id !== id),
    done: [task, ...s.done].slice(0, MAX_DONE),
  };
}

/** Puts a finished task back at the bottom of the open list. */
export function restoreTask(s: Readonly<TodoState>, id: string): TodoState {
  const task = s.done.find((t) => t.id === id);
  if (!task) return s as TodoState;
  return { ...s, done: s.done.filter((t) => t.id !== id), open: [...s.open, task] };
}

/** New text for a task (open or done). Blank text keeps the old one. */
export function renameTask(s: Readonly<TodoState>, id: string, text: string): TodoState {
  const t = cleanText(text);
  if (!t) return s as TodoState;
  const rename = (list: Task[]): Task[] => list.map((x) => (x.id === id ? { ...x, text: t } : x));
  return { ...s, open: rename(s.open), done: rename(s.done) };
}

/** Sets a task's estimate in focus sessions (0: none). */
export function setEstimate(s: Readonly<TodoState>, id: string, est: number): TodoState {
  const e = Math.max(0, Math.min(MAX_EST, Math.round(est)));
  const apply = (list: Task[]): Task[] => list.map((x) => (x.id === id ? withEstimate(x, e) : x));
  return { ...s, open: apply(s.open), done: apply(s.done) };
}

function withEstimate(t: Task, est: number): Task {
  const { est: _old, ...rest } = t;
  return est > 0 ? { ...rest, est } : rest;
}

/** "Xóa hết": today's finished tasks go (the day's 🍅 count stays). */
export function clearDone(s: Readonly<TodoState>): TodoState {
  return { ...s, done: [] };
}

export function removeTask(s: Readonly<TodoState>, id: string): TodoState {
  return {
    ...s,
    open: s.open.filter((t) => t.id !== id),
    done: s.done.filter((t) => t.id !== id),
  };
}

/** Moves an open task to `index` in the open list (clamped). */
export function moveTask(s: Readonly<TodoState>, id: string, index: number): TodoState {
  const from = s.open.findIndex((t) => t.id === id);
  if (from < 0) return s as TodoState;
  const open = s.open.slice();
  const [task] = open.splice(from, 1);
  open.splice(Math.max(0, Math.min(open.length, Math.round(index))), 0, task);
  return { ...s, open };
}

/** A focus session ended: counts it for today and for the task on top. */
export function addPomodoro(s: Readonly<TodoState>, count = 1): TodoState {
  return {
    ...s,
    pomosToday: s.pomosToday + count,
    open: s.open.map((t, i) => (i === 0 ? { ...t, pomos: t.pomos + count } : t)),
  };
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function parseTasks(v: unknown, max: number): Task[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const t of v) {
    if (!isRecord(t) || typeof t.id !== 'string' || typeof t.text !== 'string' || seen.has(t.id)) continue;
    const text = cleanText(t.text);
    if (!text) continue;
    seen.add(t.id);
    const pomos = typeof t.pomos === 'number' && Number.isFinite(t.pomos) ? Math.max(0, Math.round(t.pomos)) : 0;
    const est = typeof t.est === 'number' && Number.isFinite(t.est) ? Math.max(0, Math.min(MAX_EST, Math.round(t.est))) : 0;
    out.push(est > 0 ? { id: t.id.slice(0, 40), text, pomos, est } : { id: t.id.slice(0, 40), text, pomos });
    if (out.length >= max) break;
  }
  return out;
}

/** Validates stored data (and rolls to today). Anything invalid is dropped. Never throws. */
export function parseTodo(raw: unknown, now: number): TodoState {
  if (!isRecord(raw)) return emptyTodo(now);
  const open = parseTasks(raw.open, MAX_OPEN);
  const done = parseTasks(raw.done, MAX_DONE).filter((t) => !open.some((o) => o.id === t.id));
  const pomosToday = typeof raw.pomosToday === 'number' && Number.isFinite(raw.pomosToday) ? Math.max(0, Math.round(raw.pomosToday)) : 0;
  const day = typeof raw.day === 'string' ? raw.day : '';
  return rollDay({ open, done, day, pomosToday }, now);
}
