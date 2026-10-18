import { el } from './components';
import { vi } from './strings.vi';

/** How long the controls reminder stays before fading (ms). */
const SHOW_MS = 6000;

/** Walk-mode overlay: a small center dot and a one-line controls reminder at the bottom. */
export class WalkHint {
  private readonly hint: HTMLElement;
  private readonly dot: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.hint = el('div', 'walk-hint');
    this.hint.setAttribute('role', 'status');
    this.dot = el('div', 'crosshair');
    this.hint.hidden = true;
    this.dot.hidden = true;
    parent.append(this.hint, this.dot);
  }

  /**
   * walking + locked: dot, controls reminder that fades out.
   * walking, not locked: the "click to look" message stays until the mouse is captured.
   */
  update(walking: boolean, locked: boolean, failed: boolean): void {
    window.clearTimeout(this.timer);
    this.dot.hidden = !walking || !locked;
    this.hint.hidden = !walking;
    if (!walking) return;
    this.hint.classList.remove('faded');
    if (!locked && failed) {
      this.hint.textContent = vi.walk.clickToLook;
      return;
    }
    this.hint.textContent = vi.walk.controls;
    this.timer = window.setTimeout(() => this.hint.classList.add('faded'), SHOW_MS);
  }
}
