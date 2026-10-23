import { el } from './components';
import { vi } from './strings.vi';

/** How long the controls reminder stays before fading (ms). */
const SHOW_MS = 6000;

/** Walk-mode overlay: a one-line controls reminder at the bottom. */
export class WalkHint {
  private readonly hint: HTMLElement;
  private readonly prompt: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.hint = el('div', 'walk-hint');
    this.hint.setAttribute('role', 'status');
    this.prompt = el('div', 'desk-prompt');
    this.hint.hidden = true;
    this.prompt.hidden = true;
    parent.append(this.hint, this.prompt);
  }

  /** A cue in the middle of the screen (surfing: "Sóng tới!"); null hides it. */
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
    this.prompt.hidden = true;
    this.hint.hidden = !on;
    if (!on) return;
    this.hint.classList.remove('faded');
    this.hint.textContent = text;
    this.timer = window.setTimeout(() => this.hint.classList.add('faded'), SHOW_MS);
  }

  /** Walking (or paddling, surfing): the controls reminder, fading out after a while. */
  update(walking: boolean, controls: string = vi.walk.controls): void {
    window.clearTimeout(this.timer);
    this.hint.hidden = !walking;
    if (!walking) return;
    this.hint.classList.remove('faded');
    this.hint.textContent = controls;
    this.timer = window.setTimeout(() => this.hint.classList.add('faded'), SHOW_MS);
  }
}
