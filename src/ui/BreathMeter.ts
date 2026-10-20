import { el } from './components';
import { vi } from './strings.vi';

/** Diving: a small breath bar at the top of the screen (red and pulsing when nearly empty). */
export class BreathMeter {
  private readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private shown = false;
  private last = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'breath');
    this.root.setAttribute('role', 'meter');
    this.root.setAttribute('aria-label', vi.dive.breath);
    this.root.append(el('span', 'breath-label', vi.dive.breath));
    const bar = el('div', 'breath-bar');
    this.fill = el('div', 'breath-fill');
    bar.append(this.fill);
    this.root.append(bar);
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** `value` 0 … 1; hidden when `visible` is false. Cheap to call every frame. */
  set(visible: boolean, value: number): void {
    if (visible !== this.shown) {
      this.shown = visible;
      this.root.hidden = !visible;
    }
    if (!visible) return;
    const v = Math.round(value * 100);
    if (v === this.last) return;
    this.last = v;
    this.fill.style.width = `${v}%`;
    this.root.classList.toggle('low', value < 0.25);
  }
}
