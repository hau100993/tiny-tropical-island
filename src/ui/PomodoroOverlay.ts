import { button, el, onWheelNotch, slider, toggle, type SliderControl, type ToggleControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { isRecord, parseJson, readStored, writeStored } from '../core/storage';
import type { ChimeKind } from '../audio/synth/chime';
import type { FocusSession } from '../pets/wallet';
import {
  advance,
  formatRemaining,
  isBreak,
  parsePomodoro,
  pause,
  phaseMs,
  remaining,
  reset,
  skip,
  start,
  type PomodoroConfig,
  type PomodoroState,
} from './pomodoro';

const STORAGE_KEY = 'tsw.pomodoro';
/** How long the "time's up" message stays. */
const NOTICE_MS = 12_000;
/** Pointer travel (px) before a press on the card becomes a drag. */
const DRAG_START_PX = 4;
/** Progress ring stroke width (px); keep in sync with `.pomo-ring path` in styles.css. */
const RING_STROKE = 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Where the dragged card sits, as a fraction (0..1) of the free space left and above it, so it
 * keeps its corner when the window is resized. null: the default corner (CSS).
 */
interface CardPos {
  x: number;
  y: number;
}

export interface PomodoroDeps {
  /** Places a chime on the audio clock at a wall-clock time; null when sound isn't running. */
  scheduleChime: (atMs: number, kind: ChimeKind) => (() => void) | null;
  /** Sound is running and not in "Chỉ ngắm cảnh". */
  soundOn: () => boolean;
  /** A break with "Bão dịu đi khi nghỉ" started (true) or ended (false). */
  onCalm: (active: boolean) => void;
  /** Volume of the notification sounds (0..1). Called at start and on every change. */
  setAlertVolume: (volume: number) => void;
  /** Focus sessions just ended on their own (not skipped): the to-do list and 🍅 count them. */
  onFocusDone: (sessions: FocusSession[]) => void;
  /** The task being worked on (the desk's to-do list), shown under the phase; null with none. */
  currentTask: () => string | null;
}

/** What the right desk monitor shows of the timer. */
export interface PomodoroSnapshot {
  phase: string;
  remaining: string;
  progress: number;
  running: boolean;
  onBreak: boolean;
  /** "●●○○": focus sessions done before the long break ('' without long breaks). */
  dots: string;
  /** The timer was started and not reset (paused counts too). */
  started: boolean;
}

type NumberKey = 'focusMin' | 'breakMin' | 'longBreakMin' | 'longEvery';

/**
 * Small two-line Pomodoro card (bottom left): the one place for the timer in the overview. It shows
 * itself when the timer starts (T) and hides when it is ended (↺ here, ⏹ on the desk monitor);
 * ✕ hides it while the timer runs on (the ring round the panel's ☰ still shows it). The timer
 * state lives in localStorage, so a reload or a restart of the browser continues where it was. The chime is scheduled ahead on the audio
 * clock, because a hidden tab runs JS timers only about once a minute.
 */
export class PomodoroOverlay {
  private readonly root: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly taskEl: HTMLElement;
  private readonly ringSvg: SVGSVGElement;
  private readonly ringTrack: SVGPathElement;
  private readonly ringPath: SVGPathElement;
  /** Progress drawn last (0..1), to skip the transition when it goes back to 0. */
  private shownProgress = 0;
  private pos: CardPos | null;
  private readonly dots: HTMLElement;
  private readonly tomatoEl: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private readonly settingsBox: HTMLElement;
  private readonly inputs = new Map<NumberKey, HTMLInputElement>();
  private readonly toggles: Array<[keyof PomodoroConfig, ToggleControl]> = [];
  private alertSlider: SliderControl | null = null;
  private config: PomodoroConfig;
  private state: PomodoroState;
  private visible: boolean;
  private cancelChime: (() => void) | null = null;
  /** End time the scheduled chime belongs to. */
  private chimeFor = 0;
  private calm = false;
  private noticeTimer = 0;
  private readonly baseTitle = document.title;
  private shownText = '';

  constructor(parent: HTMLElement, private readonly deps: PomodoroDeps) {
    const raw = parseJson(readStored(STORAGE_KEY));
    const parsed = parsePomodoro(raw);
    this.config = parsed.config;
    this.state = parsed.state;
    this.visible = isRecord(raw) && raw.visible === true;
    this.pos = isRecord(raw) ? parsePos(raw.pos) : null;

    // A pill of two lines: "5:00 Nghỉ ngắn ●●○○ 🍅 2", then the task (or, for a while, the
    // notice). The buttons sit over the right of the first line and show only on hover or
    // keyboard focus. The pill's tint tells the phase; its outline fills as the phase runs.
    this.root = el('section', 'pomodoro');
    this.root.setAttribute('aria-label', vi.pomodoro.title);
    const head = el('div', 'pomo-head');
    this.timeEl = el('span', 'pomo-time');
    this.timeEl.setAttribute('role', 'timer');
    this.phaseEl = el('span', 'pomo-phase');
    const info = el('span', 'pomo-info');
    this.dots = el('span', 'pomo-dots');
    this.tomatoEl = el('span', 'pomo-tomatoes');
    this.tomatoEl.title = vi.pets.walletTitle;
    info.append(this.dots, this.tomatoEl);

    const controls = el('div', 'pomo-controls');
    this.playBtn = button('', () => this.toggleRunning(), 'icon-btn');
    const skipBtn = iconButton(icons.skip, vi.pomodoro.skip, () => this.skipPhase());
    const resetBtn = iconButton(icons.reset, vi.pomodoro.reset, () => this.resetTimer());
    const gearBtn = iconButton(icons.gear, vi.pomodoro.settings, () => {
      this.placeSettings();
      this.settingsBox.hidden = !this.settingsBox.hidden;
      gearBtn.setAttribute('aria-expanded', String(!this.settingsBox.hidden));
      // Open settings keep the buttons shown, so ⚙ can close them again.
      this.root.classList.toggle('settings-open', !this.settingsBox.hidden);
    });
    const close = iconButton(icons.close, vi.pomodoro.hide, () => this.setVisible(false));
    controls.append(this.playBtn, skipBtn, resetBtn, gearBtn, close);
    head.append(this.timeEl, this.phaseEl, info, controls);

    // The current task in full (up to two lines); the notice takes its place while shown.
    this.taskEl = el('div', 'pomo-task');
    this.notice = el('div', 'pomo-notice');
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;

    // The progress ring: an SVG path along the pill's outline. pathLength="1" makes the whole
    // outline 1 unit long, so a dash of length p shows p of it, evenly along the straight sides
    // and round ends alike (a conic gradient would fill by angle: fast at the ends, slow along).
    this.ringSvg = document.createElementNS(SVG_NS, 'svg');
    this.ringSvg.classList.add('pomo-ring');
    this.ringSvg.setAttribute('aria-hidden', 'true');
    this.ringTrack = document.createElementNS(SVG_NS, 'path');
    this.ringTrack.classList.add('track');
    this.ringPath = document.createElementNS(SVG_NS, 'path');
    this.ringPath.classList.add('fill');
    for (const p of [this.ringTrack, this.ringPath]) p.setAttribute('pathLength', '1');
    this.ringSvg.append(this.ringTrack, this.ringPath);

    // Settings float above (or below) the card instead of stretching it.
    this.settingsBox = this.buildSettings();
    this.settingsBox.hidden = true;

    this.root.append(this.ringSvg, head, this.taskEl, this.notice, this.settingsBox);
    parent.append(this.root);

    // The outline changes with the card's size (one or two lines, the notice); the free space
    // for a dragged card with the window's.
    new ResizeObserver(() => {
      this.drawOutline();
      this.applyPos();
    }).observe(this.root);
    window.addEventListener('resize', () => this.applyPos());
    this.initDrag();

    window.setInterval(this.tick, 1000);
    document.addEventListener('visibilitychange', this.tick);
    this.tick();
    this.updateCalm();
    this.render();
    this.deps.setAlertVolume(this.config.alertVolume);
  }

  /** For the desk monitors: phase, time left, progress; null while hidden and idle. */
  snapshot(): PomodoroSnapshot | null {
    const s = this.state;
    const full = phaseMs(s.phase, this.config);
    const left = remaining(s, Date.now());
    const started = s.running || left < full || s.completed > 0 || s.phase !== 'focus';
    if (!this.visible && !started) return null;
    return {
      phase: vi.pomodoro.phases[s.phase],
      remaining: formatRemaining(left),
      progress: 1 - left / full,
      running: s.running,
      onBreak: isBreak(s.phase),
      dots: this.dotsText(),
      started,
    };
  }

  /** "Chuyển sang phần sau". */
  skipPhase(): void {
    this.update(skip(this.state, this.config, Date.now()));
  }

  /**
   * Ends the Pomodoro: back to a fresh, stopped focus session (the monitor shows the clock).
   * The card goes too: it shows itself again on the next start (T).
   */
  resetTimer(): void {
    this.visible = false;
    this.update(reset(this.config));
  }

  get alertVolume(): number {
    return this.config.alertVolume;
  }

  /** Notification volume (0..1), from the desk monitor's slider. */
  setAlertVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    this.config = { ...this.config, alertVolume: v };
    this.alertSlider?.set(v);
    this.deps.setAlertVolume(v);
    this.save();
  }

  get chimeOn(): boolean {
    return this.config.chime;
  }

  /** The bell on the desk monitor: notification sounds on or off. */
  toggleChime(): void {
    this.config = { ...this.config, chime: !this.config.chime };
    for (const [key, t] of this.toggles) if (key === 'chime') t.set(this.config.chime);
    this.update(this.state);
  }

  private dotsText(): string {
    const every = this.config.longEvery;
    const s = this.state;
    return every > 0 ? '●'.repeat(Math.min(s.completed, every)) + '○'.repeat(Math.max(0, every - s.completed)) : '';
  }

  /** The wallet's count in the card's head ("🍅 12"); `gained` > 0 makes it pop. */
  setTomatoes(count: number, gained = 0): void {
    this.tomatoEl.textContent = `🍅 ${count}`;
    if (gained <= 0) return;
    this.tomatoEl.classList.remove('pop');
    // Restart the animation: off for a frame (a reflow), then on.
    void this.tomatoEl.offsetWidth;
    this.tomatoEl.classList.add('pop');
  }

  /** One more sentence after the "time's up" message (what the session earned). */
  addToNotice(text: string): void {
    if (this.notice.hidden) this.showNotice(text);
    else this.notice.textContent = `${this.notice.textContent ?? ''} ${text}`;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.save();
    this.render();
  }

  /** T key / panel button: shows the card and starts or pauses the timer. */
  toggleRunning(): void {
    const now = Date.now();
    if (!this.visible) this.visible = true;
    this.update(this.state.running ? pause(this.state, now) : start(this.state, now));
  }

  /**
   * A task's ▶ on the desk monitor: focus now. On a break, the rest of the break is skipped;
   * a running focus session just keeps running.
   */
  startFocus(): void {
    const now = Date.now();
    let s = this.state;
    if (isBreak(s.phase)) s = { ...skip(s, this.config, now), running: false };
    this.visible = true;
    this.update(start(s, now));
  }

  /** Call when sound starts or stops ("Chỉ ngắm cảnh"), so the chime can be (un)scheduled. */
  refreshSound(): void {
    this.scheduleChime();
    this.render();
  }

  private buildSettings(): HTMLElement {
    const box = el('div', 'pomo-settings');
    const rows: Array<[NumberKey, string, string, number, number]> = [
      ['focusMin', vi.pomodoro.focusMin, vi.pomodoro.minutes, 1, 180],
      ['breakMin', vi.pomodoro.breakMin, vi.pomodoro.minutes, 1, 60],
      ['longBreakMin', vi.pomodoro.longBreakMin, vi.pomodoro.minutes, 1, 120],
      ['longEvery', vi.pomodoro.longEvery, vi.pomodoro.sessions, 0, 12],
    ];
    for (const [key, label, unit, min, max] of rows) {
      const row = el('label', 'pomo-field');
      const input = el('input', 'text-input num');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = String(this.config[key]);
      if (key === 'longEvery') input.title = vi.pomodoro.never;
      input.addEventListener('change', () => {
        const v = Math.round(Number(input.value));
        if (!Number.isFinite(v)) return;
        this.setNumber(key, Math.min(max, Math.max(min, v)));
        input.value = String(this.config[key]);
      });
      // Wheel over the row (no need to click the box first): ±1 per notch, Shift ±5.
      onWheelNotch(row, () => true, (dir, e) => {
        const v = Math.min(max, Math.max(min, Number(input.value) + dir * (e.shiftKey ? 5 : 1)));
        if (v === Number(input.value)) return;
        input.value = String(v);
        input.dispatchEvent(new Event('change'));
      });
      row.append(el('span', '', label), input, el('span', 'unit', unit));
      box.append(row);
      this.inputs.set(key, input);
    }
    const toggleRow = el('div', 'button-row');
    const flags: Array<[keyof PomodoroConfig, string]> = [
      ['autoContinue', vi.pomodoro.autoContinue],
      ['chime', vi.pomodoro.chime],
      ['calmStorm', vi.pomodoro.calmStorm],
    ];
    for (const [key, label] of flags) {
      const t = toggle(label, this.config[key] === true, (on) => {
        this.config = { ...this.config, [key]: on };
        t.set(on);
        this.update(this.state);
      });
      this.toggles.push([key, t]);
      toggleRow.append(t.root);
    }
    box.append(toggleRow);
    this.alertSlider = slider(vi.pomodoro.alertVolume, this.config.alertVolume, (v) => this.setAlertVolume(v));
    box.append(this.alertSlider.root);
    return box;
  }

  /** A new length applies to the running phase too (its end moves by the difference). */
  private setNumber(key: NumberKey, value: number): void {
    const oldFull = phaseMs(this.state.phase, this.config);
    this.config = { ...this.config, [key]: value };
    const delta = phaseMs(this.state.phase, this.config) - oldFull;
    const s = { ...this.state };
    if (delta !== 0) {
      if (s.running) s.endsAt = Math.max(Date.now() + 1000, s.endsAt + delta);
      else s.remainingMs = Math.max(1000, s.remainingMs + delta);
    }
    this.update(s);
  }

  private update(next: PomodoroState): void {
    this.state = next;
    this.save();
    this.scheduleChime();
    this.updateCalm();
    this.render();
  }

  private tick = (): void => {
    const before = this.state;
    const { state, ended, endedAt } = advance(before, this.config, Date.now());
    if (ended.length === 0) {
      this.render();
      return;
    }
    // The chime normally already rang on the audio clock; ring now only if it wasn't scheduled.
    const kind: ChimeKind = isBreak(state.phase) ? 'toBreak' : 'toFocus';
    const rang = this.chimeFor === before.endsAt && this.cancelChime !== null;
    this.cancelChime = null;
    this.chimeFor = 0;
    if (!rang && this.config.chime && this.deps.soundOn()) this.deps.scheduleChime(Date.now(), kind);
    this.showNotice(kind === 'toBreak' ? vi.pomodoro.toBreak : vi.pomodoro.toFocus);
    this.update(state);
    const focus: FocusSession[] = [];
    for (let i = 0; i < ended.length; i++) {
      if (ended[i] === 'focus') focus.push({ endedAt: endedAt[i], minutes: this.config.focusMin });
    }
    if (focus.length > 0) this.deps.onFocusDone(focus);
  };

  private scheduleChime(): void {
    const s = this.state;
    const want = s.running && this.config.chime && this.deps.soundOn();
    if (want && this.cancelChime && this.chimeFor === s.endsAt) return;
    this.cancelChime?.();
    this.cancelChime = null;
    this.chimeFor = 0;
    if (!want) return;
    // The chime announces what comes next: a break after focus, focus after a break.
    const kind: ChimeKind = s.phase === 'focus' ? 'toBreak' : 'toFocus';
    this.cancelChime = this.deps.scheduleChime(s.endsAt, kind);
    if (this.cancelChime) this.chimeFor = s.endsAt;
  }

  private updateCalm(): void {
    const calm = this.config.calmStorm && this.state.running && isBreak(this.state.phase);
    if (calm === this.calm) return;
    this.calm = calm;
    this.deps.onCalm(calm);
  }

  private showNotice(text: string): void {
    this.notice.textContent = this.config.chime && !this.deps.soundOn() ? `${text} ${vi.pomodoro.noSound}` : text;
    this.notice.hidden = false;
    this.root.classList.add('ring', 'noticing');
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.notice.hidden = true;
      this.root.classList.remove('ring', 'noticing');
    }, NOTICE_MS);
  }

  private render(): void {
    const s = this.state;
    const left = remaining(s, Date.now());
    const text = formatRemaining(left);
    this.root.hidden = !this.visible;
    // The pill's tint (styles.css: .pomodoro[data-phase]).
    if (this.root.dataset.phase !== s.phase) this.root.dataset.phase = s.phase;
    this.root.classList.toggle('paused', !s.running);
    const phase = vi.pomodoro.phases[s.phase];
    // Only touch the DOM when something visible changed (this runs every second).
    const task = this.deps.currentTask() ?? '';
    const key = `${text}|${phase}|${s.running}|${s.completed}|${this.visible}|${task}`;
    if (key === this.shownText) return;
    this.shownText = key;
    this.phaseEl.textContent = phase;
    this.taskEl.textContent = task;
    this.taskEl.title = task;
    this.timeEl.textContent = text;
    this.setProgress(1 - left / phaseMs(s.phase, this.config));
    this.dots.textContent = this.dotsText();
    this.playBtn.innerHTML = s.running ? icons.pause : icons.play;
    const label = s.running ? vi.pomodoro.pause : vi.pomodoro.start;
    this.playBtn.title = `${label} (T)`;
    this.playBtn.setAttribute('aria-label', label);
    // The tab title shows the countdown, so it's visible from the taskbar too.
    document.title = s.running ? `${text} · ${phase} — ${this.baseTitle}` : this.baseTitle;
  }

  /** Fills `p` (0..1) of the outline; a 1 s linear transition makes the per-second steps glide. */
  private setProgress(p: number): void {
    const v = Math.min(1, Math.max(0, p));
    // Going back (a new phase, a reset): jump instead of running the ring backwards.
    this.ringPath.style.transition = v < this.shownProgress ? 'none' : '';
    this.ringPath.style.strokeDasharray = `${v.toFixed(4)} 1`;
    // A zero-length dash with round caps would still draw a dot.
    this.ringPath.style.opacity = v > 0.001 ? '' : '0';
    this.shownProgress = v;
  }

  /**
   * The pill's outline as a path starting at the middle of the top edge, clockwise, centred on
   * the 1 px border (the SVG covers the border box, see `.pomo-ring`).
   */
  private drawOutline(): void {
    const w = this.root.offsetWidth;
    const h = this.root.offsetHeight;
    if (w === 0 || h === 0) return;
    const i = RING_STROKE / 2;
    const r = h / 2 - i;
    const right = w - i - r;
    const left = i + r;
    const d =
      `M ${w / 2} ${i} H ${right} A ${r} ${r} 0 0 1 ${right} ${h - i} ` +
      `H ${left} A ${r} ${r} 0 0 1 ${left} ${i} Z`;
    this.ringSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.ringTrack.setAttribute('d', d);
    this.ringPath.setAttribute('d', d);
  }

  /** Press anywhere on the card but its buttons and settings, then move: the card follows. */
  private initDrag(): void {
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let pointer = -1;
    let dragging = false;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !(e.target instanceof Element)) return;
      if (e.target.closest('button, input, label, .pomo-settings')) return;
      pointer = e.pointerId;
      dragging = false;
      // Capture at once: a quick first move can already be off the card.
      this.root.setPointerCapture(pointer);
      startX = e.clientX;
      startY = e.clientY;
      const r = this.root.getBoundingClientRect();
      originLeft = r.left;
      originTop = r.top;
    });
    this.root.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        dragging = true;
        this.root.classList.add('dragging');
      }
      const freeX = Math.max(1, window.innerWidth - this.root.offsetWidth);
      const freeY = Math.max(1, window.innerHeight - this.root.offsetHeight);
      this.pos = {
        x: Math.min(1, Math.max(0, (originLeft + dx) / freeX)),
        y: Math.min(1, Math.max(0, (originTop + dy) / freeY)),
      };
      this.applyPos();
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pointer) return;
      pointer = -1;
      if (!dragging) return;
      dragging = false;
      this.root.classList.remove('dragging');
      this.save();
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    // Double-click: back to the default corner.
    this.root.addEventListener('dblclick', (e) => {
      if (e.target instanceof Element && e.target.closest('button, input, label, .pomo-settings')) return;
      this.pos = null;
      this.applyPos();
      this.save();
    });
  }

  /** Places a dragged card (inline left/top win over the CSS corner); clears it for the default. */
  private applyPos(): void {
    const st = this.root.style;
    if (!this.pos) {
      st.left = st.top = st.bottom = '';
    } else {
      const freeX = Math.max(0, window.innerWidth - this.root.offsetWidth);
      const freeY = Math.max(0, window.innerHeight - this.root.offsetHeight);
      st.left = `${Math.round(this.pos.x * freeX)}px`;
      st.top = `${Math.round(this.pos.y * freeY)}px`;
      st.bottom = 'auto';
    }
    if (!this.settingsBox.hidden) this.placeSettings();
  }

  /** Settings open toward the roomier side: below a card in the top half, leftward in the right half. */
  private placeSettings(): void {
    const r = this.root.getBoundingClientRect();
    this.root.classList.toggle('settings-below', r.top + r.height / 2 < window.innerHeight / 2);
    this.root.classList.toggle('settings-left', r.left + r.width / 2 > window.innerWidth / 2);
  }

  private save(): void {
    writeStored(STORAGE_KEY, { config: this.config, state: this.state, visible: this.visible, pos: this.pos });
  }
}

function parsePos(v: unknown): CardPos | null {
  if (!isRecord(v)) return null;
  const { x, y } = v;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = button('', onClick, 'icon-btn');
  b.innerHTML = icon;
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}
