/** Tiny DOM helpers and controls for the vanilla-TS UI. */
import { vi } from './strings.vi';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(text: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export interface SliderControl {
  root: HTMLElement;
  input: HTMLInputElement;
  set(value: number): void;
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  /** Change per mouse-wheel notch (Shift + wheel uses `step`). Default: 5 steps. */
  wheelStep?: number;
  /** Below this value a notch is only 2 steps (volumes: the ear hears small levels finely). */
  fineBelow?: number;
  /** Values wrap around with this period when wheeled past an end (e.g. 24 for a clock). */
  wrap?: number;
  /** Double-click the row to return to this value. */
  defaultValue?: number;
  /** Small tick marks under the track (e.g. the "normal" level, or 06/12/18 h). */
  marks?: readonly number[];
  /** Show the value in a bubble over the thumb while dragging too (not only on wheel notches). */
  dragBubble?: boolean;
}

export const PERCENT: SliderOptions = { min: 0, max: 1, step: 0.01, wheelStep: 0.05, format: (v) => `${Math.round(v * 100)}%` };
/** Tick marks for the time-of-day sliders: 06:00, 12:00, 18:00. */
export const CLOCK_MARKS: readonly number[] = [6, 12, 18];
/** Volume sliders: 5% per notch, 2% below 20%. */
export const VOLUME: SliderOptions = { ...PERCENT, fineBelow: 0.2 };

/** Wheel delta (px) that counts as one notch; trackpads send many small deltas. */
const NOTCH_PX = 100;
/** Native range thumb width in Chrome/Edge (px): tick marks line up with the thumb's center. */
const THUMB_PX = 16;
let lastScrollAt = -Infinity;
let scrollWatch = false;

/**
 * Calls `onNotch(+1 | −1, event)` per mouse-wheel notch over `target` (wheel up = +1). While
 * the panel is still scrolling (a scroll happened just before), the wheel keeps scrolling
 * instead, so sliding the pointer over a control mid-scroll doesn't change it.
 */
export function onWheelNotch(target: HTMLElement, enabled: () => boolean, onNotch: (dir: 1 | -1, e: WheelEvent) => void): void {
  if (!scrollWatch) {
    scrollWatch = true;
    document.addEventListener('scroll', () => (lastScrollAt = performance.now()), { capture: true, passive: true });
  }
  let acc = 0;
  target.addEventListener('wheel', (e) => {
    if (!enabled() || performance.now() - lastScrollAt < 350) return;
    e.preventDefault();
    // Shift + wheel arrives as horizontal scroll on Windows, so read whichever axis moved.
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const d = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? raw : raw * NOTCH_PX;
    // A mouse notch is one step even if the driver reports less than NOTCH_PX.
    acc = Math.abs(d) >= NOTCH_PX * 0.4 ? Math.sign(d) * NOTCH_PX : acc + d;
    if (Math.abs(acc) < NOTCH_PX) return;
    const dir = acc < 0 ? 1 : -1;
    acc = 0;
    onNotch(dir, e);
  }, { passive: false });
}

/** Next value one wheel notch away, landing on multiples of the increment (37% → 40% → 45%). */
export function wheelValue(v0: number, dir: 1 | -1, fine: boolean, opts: SliderOptions): number {
  let inc = fine ? opts.step : (opts.wheelStep ?? opts.step * 5);
  if (!fine && opts.fineBelow !== undefined && (dir > 0 ? v0 < opts.fineBelow - 1e-6 : v0 <= opts.fineBelow + 1e-6)) {
    inc = Math.min(inc, opts.step * 2);
  }
  let v = dir > 0 ? Math.floor(v0 / inc + 1e-6) * inc + inc : Math.ceil(v0 / inc - 1e-6) * inc - inc;
  if (opts.wrap !== undefined) v = ((v % opts.wrap) + opts.wrap) % opts.wrap;
  return Number(Math.min(opts.max, Math.max(opts.min, v)).toFixed(6));
}

/** One shared floating value shown over the thumb while wheeling (fixed: never clipped). */
let bubble: HTMLElement | null = null;
let bubbleTimer = 0;
function showBubble(input: HTMLInputElement, text: string, p: number): void {
  if (!bubble) {
    bubble = el('div', 'slider-bubble');
    bubble.setAttribute('aria-hidden', 'true');
    document.body.append(bubble);
  }
  const r = input.getBoundingClientRect();
  bubble.textContent = text;
  bubble.style.left = `${r.left + THUMB_PX / 2 + p * (r.width - THUMB_PX)}px`;
  bubble.style.top = `${r.top}px`;
  bubble.classList.add('show');
  window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => bubble?.classList.remove('show'), 1000);
}

/**
 * Range slider (0..1 as a percentage by default). Calls `onInput` while dragging, on each
 * mouse-wheel notch over it (Shift + wheel for fine steps) and on double-click (back to
 * `defaultValue`).
 */
export function slider(label: string, value: number, onInput: (v: number) => void, opts: SliderOptions = PERCENT): SliderControl {
  const root = el('label', 'slider');
  const name = el('span', 'slider-label', label);
  const track = el('span', 'slider-track');
  const input = el('input', 'slider-input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  track.append(input);
  const span = opts.max - opts.min;
  for (const m of opts.marks ?? []) {
    const tick = el('span', 'slider-tick');
    tick.style.left = `calc(${THUMB_PX / 2}px + ${(m - opts.min) / span} * (100% - ${THUMB_PX}px))`;
    track.append(tick);
  }
  const out = el('span', 'slider-value');
  const set = (v: number): void => {
    if (Math.abs(Number(input.value) - v) > opts.step / 2) input.value = String(v);
    out.textContent = opts.format(v);
  };
  const apply = (v: number): void => {
    out.textContent = opts.format(v);
    onInput(v);
  };
  const jump = (v: number): void => {
    if (v === Number(input.value)) return;
    input.value = String(v);
    const now = Number(input.value);
    apply(now);
    showBubble(input, opts.format(now), (now - opts.min) / span);
  };
  input.addEventListener('input', () => {
    const v = Number(input.value);
    apply(v);
    if (opts.dragBubble) showBubble(input, opts.format(v), (v - opts.min) / span);
  });
  onWheelNotch(root, () => !input.disabled, (dir, e) => jump(wheelValue(Number(input.value), dir, e.shiftKey, opts)));
  if (opts.defaultValue !== undefined) {
    const def = opts.defaultValue;
    root.title = vi.slider.resetHint(opts.format(def));
    root.addEventListener('dblclick', (e) => {
      if (input.disabled) return;
      e.preventDefault();
      jump(def);
    });
  }
  set(value);
  root.append(name, track, out);
  return { root, input, set };
}

export interface ToggleControl {
  root: HTMLButtonElement;
  set(on: boolean): void;
}

/** Pressable on/off button (aria-pressed for screen readers). */
export function toggle(label: string, on: boolean, onChange: (on: boolean) => void, className = 'toggle'): ToggleControl {
  const root = button(label, () => onChange(root.getAttribute('aria-pressed') !== 'true'), className);
  const set = (v: boolean): void => root.setAttribute('aria-pressed', String(v));
  set(on);
  return { root, set };
}

/** Collapsible section using native <details>, so it's keyboard-accessible for free. */
export function section(title: string, open = true): { root: HTMLDetailsElement; body: HTMLDivElement } {
  const root = el('details', 'section');
  root.open = open;
  const summary = el('summary', 'section-title', title);
  const body = el('div', 'section-body');
  root.append(summary, body);
  return { root, body };
}
