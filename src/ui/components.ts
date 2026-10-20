/** Tiny DOM helpers and controls for the vanilla-TS UI. */

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
  /** Values wrap around with this period when wheeled past an end (e.g. 24 for a clock). */
  wrap?: number;
}

const PERCENT: SliderOptions = { min: 0, max: 1, step: 0.01, wheelStep: 0.05, format: (v) => `${Math.round(v * 100)}%` };

/** Wheel delta (px) that counts as one notch; trackpads send many small deltas. */
const NOTCH_PX = 100;
let lastScrollAt = -Infinity;
let scrollWatch = false;

/**
 * Wheel over a slider moves it by one notch: up = more. While the panel is still scrolling
 * (a scroll happened just before), the wheel keeps scrolling instead, so sliding the pointer
 * over a slider mid-scroll doesn't change it.
 */
function wheelToSlider(root: HTMLElement, input: HTMLInputElement, opts: SliderOptions, apply: (v: number) => void): void {
  if (!scrollWatch) {
    scrollWatch = true;
    document.addEventListener('scroll', () => (lastScrollAt = performance.now()), { capture: true, passive: true });
  }
  let acc = 0;
  root.addEventListener('wheel', (e) => {
    if (input.disabled || performance.now() - lastScrollAt < 350) return;
    e.preventDefault();
    // Shift + wheel arrives as horizontal scroll on Windows, so read whichever axis moved.
    const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const d = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? raw : raw * NOTCH_PX;
    // A mouse notch is one step even if the driver reports less than NOTCH_PX.
    acc = Math.abs(d) >= NOTCH_PX * 0.4 ? Math.sign(d) * NOTCH_PX : acc + d;
    if (Math.abs(acc) < NOTCH_PX) return;
    const dir = acc < 0 ? 1 : -1;
    acc = 0;
    const inc = e.shiftKey ? opts.step : (opts.wheelStep ?? opts.step * 5);
    const v0 = Number(input.value);
    // Land on whole multiples of the increment (37% → 40% → 45%), not 37% → 42%.
    let v = dir > 0 ? Math.floor(v0 / inc + 1e-6) * inc + inc : Math.ceil(v0 / inc - 1e-6) * inc - inc;
    if (opts.wrap !== undefined) v = ((v % opts.wrap) + opts.wrap) % opts.wrap;
    v = Number(Math.min(opts.max, Math.max(opts.min, v)).toFixed(6));
    if (v === v0) return;
    input.value = String(v);
    apply(Number(input.value));
  }, { passive: false });
}

/**
 * Range slider (0..1 as a percentage by default). Calls `onInput` while dragging and on each
 * mouse-wheel notch over it (Shift + wheel for fine steps).
 */
export function slider(label: string, value: number, onInput: (v: number) => void, opts: SliderOptions = PERCENT): SliderControl {
  const root = el('label', 'slider');
  const name = el('span', 'slider-label', label);
  const input = el('input', 'slider-input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  const out = el('span', 'slider-value');
  const set = (v: number): void => {
    if (Math.abs(Number(input.value) - v) > opts.step / 2) input.value = String(v);
    out.textContent = opts.format(v);
  };
  const apply = (v: number): void => {
    out.textContent = opts.format(v);
    onInput(v);
  };
  input.addEventListener('input', () => apply(Number(input.value)));
  wheelToSlider(root, input, opts, apply);
  set(value);
  root.append(name, input, out);
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
