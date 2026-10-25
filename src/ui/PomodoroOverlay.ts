import { button, el, onWheelNotch, slider, toggle, type ToggleControl } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { isRecord, parseJson, readStored, writeStored } from '../core/storage';
import type { ChimeKind } from '../audio/synth/chime';
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

export interface PomodoroDeps {
  /** Places a chime on the audio clock at a wall-clock time; null when sound isn't running. */
  scheduleChime: (atMs: number, kind: ChimeKind) => (() => void) | null;
  /** Sound is running and not in "Chỉ ngắm cảnh". */
  soundOn: () => boolean;
  /** A break with "Bão dịu đi khi nghỉ" started (true) or ended (false). */
  onCalm: (active: boolean) => void;
  /** Volume of the notification sounds (0..1). Called at start and on every change. */
  setAlertVolume: (volume: number) => void;
  /** `count` focus sessions just ended (the to-do list counts them). */
  onFocusDone: (count: number) => void;
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
 * Small Pomodoro card (bottom left). The timer state lives in localStorage, so a reload or a
 * restart of the browser continues where it was. The chime is scheduled ahead on the audio
 * clock, because a hidden tab runs JS timers only about once a minute.
 */
export class PomodoroOverlay {
  private readonly root: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly notice: HTMLElement;
  private readonly settingsBox: HTMLElement;
  private readonly inputs = new Map<NumberKey, HTMLInputElement>();
  private readonly toggles: Array<[keyof PomodoroConfig, ToggleControl]> = [];
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

    this.root = el('section', 'pomodoro');
    this.root.setAttribute('aria-label', vi.pomodoro.title);
    const head = el('div', 'pomo-head');
    this.phaseEl = el('span', 'pomo-phase');
    this.dots = el('span', 'pomo-dots');
    const close = button('', () => this.setVisible(false), 'icon-btn small');
    close.innerHTML = icons.close;
    close.title = vi.pomodoro.hide;
    close.setAttribute('aria-label', vi.pomodoro.hide);
    head.append(this.phaseEl, this.dots, close);

    this.timeEl = el('div', 'pomo-time');
    this.timeEl.setAttribute('role', 'timer');
    const track = el('div', 'pomo-track');
    this.bar = el('div', 'pomo-bar');
    track.append(this.bar);

    const controls = el('div', 'pomo-controls');
    this.playBtn = button('', () => this.toggleRunning(), 'icon-btn');
    const skipBtn = iconButton(icons.skip, vi.pomodoro.skip, () => this.skipPhase());
    const resetBtn = iconButton(icons.reset, vi.pomodoro.reset, () => this.update(reset(this.config)));
    const gearBtn = iconButton(icons.gear, vi.pomodoro.settings, () => {
      this.settingsBox.hidden = !this.settingsBox.hidden;
      gearBtn.setAttribute('aria-expanded', String(!this.settingsBox.hidden));
    });
    controls.append(this.playBtn, skipBtn, resetBtn, gearBtn);

    this.notice = el('div', 'pomo-notice');
    this.notice.setAttribute('role', 'status');
    this.notice.hidden = true;
    this.settingsBox = this.buildSettings();
    this.settingsBox.hidden = true;

    this.root.append(head, this.timeEl, track, controls, this.notice, this.settingsBox);
    parent.append(this.root);

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
    const volume = slider(vi.pomodoro.alertVolume, this.config.alertVolume, (v) => {
      this.config = { ...this.config, alertVolume: v };
      this.deps.setAlertVolume(v);
      this.save();
    });
    box.append(volume.root);
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
    const { state, ended } = advance(before, this.config, Date.now());
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
    const focus = ended.filter((p) => p === 'focus').length;
    if (focus > 0) this.deps.onFocusDone(focus);
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
    this.root.classList.add('ring');
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.notice.hidden = true;
      this.root.classList.remove('ring');
    }, NOTICE_MS);
  }

  private render(): void {
    const s = this.state;
    const left = remaining(s, Date.now());
    const text = formatRemaining(left);
    this.root.hidden = !this.visible;
    this.root.classList.toggle('on-break', isBreak(s.phase));
    this.root.classList.toggle('paused', !s.running);
    const phase = vi.pomodoro.phases[s.phase];
    // Only touch the DOM when something visible changed (this runs every second).
    const key = `${text}|${phase}|${s.running}|${s.completed}|${this.visible}`;
    if (key === this.shownText) return;
    this.shownText = key;
    this.phaseEl.textContent = phase;
    this.timeEl.textContent = text;
    this.bar.style.width = `${(100 * (1 - left / phaseMs(s.phase, this.config))).toFixed(2)}%`;
    this.dots.textContent = this.dotsText();
    this.playBtn.innerHTML = s.running ? icons.pause : icons.play;
    const label = s.running ? vi.pomodoro.pause : vi.pomodoro.start;
    this.playBtn.title = `${label} (T)`;
    this.playBtn.setAttribute('aria-label', label);
    // The tab title shows the countdown, so it's visible from the taskbar too.
    document.title = s.running ? `${text} · ${phase} — ${this.baseTitle}` : this.baseTitle;
  }

  private save(): void {
    writeStored(STORAGE_KEY, { config: this.config, state: this.state, visible: this.visible });
  }
}

function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = button('', onClick, 'icon-btn');
  b.innerHTML = icon;
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}
