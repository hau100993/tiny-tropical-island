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
}

const PERCENT: SliderOptions = { min: 0, max: 1, step: 0.01, format: (v) => `${Math.round(v * 100)}%` };

/** Range slider (0..1 as a percentage by default). Calls `onInput` while dragging. */
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
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = opts.format(v);
    onInput(v);
  });
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
