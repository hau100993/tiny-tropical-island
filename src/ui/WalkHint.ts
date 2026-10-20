import { el } from './components';
import { vi } from './strings.vi';

/** How long the controls reminder stays before fading (ms). */
const SHOW_MS = 6000;

/** Walk-mode overlay: a small center dot and a one-line controls reminder at the bottom. */
export class WalkHint {
  private readonly hint: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly prompt: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.hint = el('div', 'walk-hint');
    this.hint.setAttribute('role', 'status');
    this.dot = el('div', 'crosshair');
    this.prompt = el('div', 'desk-prompt', vi.desk.sit);
    this.hint.hidden = true;
    this.dot.hidden = true;
    this.prompt.hidden = true;
    parent.append(this.hint, this.dot, this.prompt);
  }

  /** "E: Ngồi làm việc" / "E: Vào bồn tắm" while standing next to a seat; null hides it. */
  setPrompt(text: string | null): void {
    if (text === null) {
      this.prompt.hidden = true;
      return;
    }
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.hidden = false;
  }

  /** Seated: the look/zoom/leave reminder (`text`), fading out like the walking one. */
  showSeat(on: boolean, text: string): void {
    window.clearTimeout(this.timer);
    this.dot.hidden = true;
    this.prompt.hidden = true;
    this.hint.hidden = !on;
    if (!on) return;
    this.hint.classList.remove('faded');
    this.hint.textContent = text;
    this.timer = window.setTimeout(() => this.hint.classList.add('faded'), SHOW_MS);
  }

  /**
   * walking + locked: dot, controls reminder that fades out.
   * walking, not locked: the "click to look" message stays until the mouse is captured.
   */
  update(walking: boolean, locked: boolean, failed: boolean, controls: string = vi.walk.controls): void {
    window.clearTimeout(this.timer);
    this.dot.hidden = !walking || !locked;
    this.hint.hidden = !walking;
    if (!walking) return;
    this.hint.classList.remove('faded');
    if (!locked && failed) {
      this.hint.textContent = vi.walk.clickToLook;
      return;
    }
    this.hint.textContent = controls;
    this.timer = window.setTimeout(() => this.hint.classList.add('faded'), SHOW_MS);
  }
}
