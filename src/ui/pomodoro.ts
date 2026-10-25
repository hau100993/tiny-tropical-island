import { bool, isRecord } from '../core/storage';

export type PomodoroPhase = 'focus' | 'break' | 'longBreak';

export interface PomodoroConfig {
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  /** A long break after this many focus sessions; 0 = never. */
  longEvery: number;
  /** Start the next phase by itself when one ends. */
  autoContinue: boolean;
  chime: boolean;
  /** Volume of the notification sounds (chime, to-do pops), 0..1, apart from the master volume. */
  alertVolume: number;
  /** "Bão dịu đi khi nghỉ": rain, wind and snow ease to 30% during breaks. */
  calmStorm: boolean;
}

/**
 * Timer state. Time is kept as an absolute end time (`Date.now()` based) while running, so a
 * throttled or sleeping tab never drifts: on wake-up `advance` catches up exactly.
 */
export interface PomodoroState {
  phase: PomodoroPhase;
  running: boolean;
  /** While running: when the phase ends (ms since epoch). */
  endsAt: number;
  /** While paused: time left in the phase (ms). */
  remainingMs: number;
  /** Focus sessions finished since the last long break. */
  completed: number;
}

export function defaultPomodoroConfig(): PomodoroConfig {
  return { focusMin: 25, breakMin: 5, longBreakMin: 15, longEvery: 4, autoContinue: true, chime: true, alertVolume: 0.8, calmStorm: true };
}

export function phaseMs(phase: PomodoroPhase, c: Readonly<PomodoroConfig>): number {
  const min = phase === 'focus' ? c.focusMin : phase === 'break' ? c.breakMin : c.longBreakMin;
  return min * 60_000;
}

export function initialState(c: Readonly<PomodoroConfig>): PomodoroState {
  return { phase: 'focus', running: false, endsAt: 0, remainingMs: phaseMs('focus', c), completed: 0 };
}

export function remaining(s: Readonly<PomodoroState>, now: number): number {
  return s.running ? Math.max(0, s.endsAt - now) : s.remainingMs;
}

export function start(s: Readonly<PomodoroState>, now: number): PomodoroState {
  if (s.running) return { ...s };
  return { ...s, running: true, endsAt: now + s.remainingMs };
}

export function pause(s: Readonly<PomodoroState>, now: number): PomodoroState {
  if (!s.running) return { ...s };
  return { ...s, running: false, remainingMs: Math.max(0, s.endsAt - now) };
}

export function reset(c: Readonly<PomodoroConfig>): PomodoroState {
  return initialState(c);
}

/** The phase after `s.phase` ends (counts the focus session it closes). */
function following(s: Readonly<PomodoroState>, c: Readonly<PomodoroConfig>): { phase: PomodoroPhase; completed: number } {
  if (s.phase !== 'focus') return { phase: 'focus', completed: s.phase === 'longBreak' ? 0 : s.completed };
  const completed = s.completed + 1;
  const long = c.longEvery > 0 && completed >= c.longEvery;
  return { phase: long ? 'longBreak' : 'break', completed };
}

/** Ends the current phase now (the "skip" button). */
export function skip(s: Readonly<PomodoroState>, c: Readonly<PomodoroConfig>, now: number): PomodoroState {
  const n = following(s, c);
  const ms = phaseMs(n.phase, c);
  const running = s.running && c.autoContinue;
  return { phase: n.phase, completed: n.completed, running, endsAt: running ? now + ms : 0, remainingMs: ms };
}

export interface AdvanceResult {
  state: PomodoroState;
  /** Phases that ended since the last call, in order (usually zero or one). */
  ended: PomodoroPhase[];
}

/**
 * Moves past every phase whose end time has passed. With auto-continue, each next phase starts
 * exactly at the previous end (no drift); without it the timer stops at the start of the next one.
 */
export function advance(s: Readonly<PomodoroState>, c: Readonly<PomodoroConfig>, now: number): AdvanceResult {
  let state: PomodoroState = { ...s };
  const ended: PomodoroPhase[] = [];
  // Bounded: after a long sleep, don't spin through hundreds of cycles.
  for (let i = 0; i < 64 && state.running && state.endsAt <= now; i++) {
    ended.push(state.phase);
    const n = following(state, c);
    const ms = phaseMs(n.phase, c);
    state = c.autoContinue
      ? { phase: n.phase, completed: n.completed, running: true, endsAt: state.endsAt + ms, remainingMs: ms }
      : { phase: n.phase, completed: n.completed, running: false, endsAt: 0, remainingMs: ms };
  }
  if (state.running && state.endsAt <= now) state = { ...state, running: false, remainingMs: phaseMs(state.phase, c) };
  return { state, ended };
}

export function isBreak(phase: PomodoroPhase): boolean {
  return phase !== 'focus';
}

/** "mm:ss" (or "h:mm:ss" past an hour), rounding up so 0:00 only shows at the very end. */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mmss = `${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

const PHASES: readonly PomodoroPhase[] = ['focus', 'break', 'longBreak'];

const minutes = (v: unknown, fallback: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(1, Math.round(v))) : fallback;

/** Validates stored data; anything invalid falls back to defaults. Never throws. */
export function parsePomodoro(raw: unknown): { config: PomodoroConfig; state: PomodoroState } {
  const d = defaultPomodoroConfig();
  const rc = isRecord(raw) && isRecord(raw.config) ? raw.config : {};
  const config: PomodoroConfig = {
    focusMin: minutes(rc.focusMin, d.focusMin, 180),
    breakMin: minutes(rc.breakMin, d.breakMin, 60),
    longBreakMin: minutes(rc.longBreakMin, d.longBreakMin, 120),
    longEvery: typeof rc.longEvery === 'number' && Number.isFinite(rc.longEvery) ? Math.min(12, Math.max(0, Math.round(rc.longEvery))) : d.longEvery,
    autoContinue: bool(rc.autoContinue, d.autoContinue),
    chime: bool(rc.chime, d.chime),
    alertVolume: typeof rc.alertVolume === 'number' && Number.isFinite(rc.alertVolume) ? Math.min(1, Math.max(0, rc.alertVolume)) : d.alertVolume,
    calmStorm: bool(rc.calmStorm, d.calmStorm),
  };
  const rs = isRecord(raw) && isRecord(raw.state) ? raw.state : null;
  if (!rs || !PHASES.includes(rs.phase as PomodoroPhase)) return { config, state: initialState(config) };
  const phase = rs.phase as PomodoroPhase;
  const full = phaseMs(phase, config);
  const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const state: PomodoroState = {
    phase,
    running: rs.running === true && finite(rs.endsAt) > 0,
    endsAt: finite(rs.endsAt),
    remainingMs: Math.min(full, Math.max(0, finite(rs.remainingMs) || full)),
    completed: Math.max(0, Math.floor(finite(rs.completed))),
  };
  return { config, state };
}
