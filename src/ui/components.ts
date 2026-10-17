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

/** 0..1 range slider showing a percentage. Calls `onInput` while dragging. */
export function slider(label: string, value: number, onInput: (v: number) => void): SliderControl {
  const root = el('label', 'slider');
  const name = el('span', 'slider-label', label);
  const input = el('input', 'slider-input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  const out = el('span', 'slider-value');
  const set = (v: number): void => {
    const s = String(Math.round(v * 100));
    if (input.value !== s) input.value = s;
    out.textContent = `${s}%`;
  };
  input.addEventListener('input', () => {
    const v = Number(input.value) / 100;
    out.textContent = `${input.value}%`;
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
