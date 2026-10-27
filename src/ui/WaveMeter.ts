import { el } from './components';
import { vi } from './strings.vi';
import { isTouch } from './touch';

/**
 * Surfing, lying on the board: when the next wave comes ("Sóng tiếp theo: 4 s", a bar filling up),
 * turning green with "Space!" while it can be caught. Same place and look as the breath bar.
 */
export class WaveMeter {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly fill: HTMLElement;
  private shown = false;
  private lastText = '';
  private lastFill = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'breath wave-meter');
    this.root.setAttribute('role', 'status');
    this.label = el('span', 'breath-label');
    const bar = el('div', 'breath-bar');
    this.fill = el('div', 'breath-fill');
    bar.append(this.fill);
    this.root.append(this.label, bar);
    this.root.hidden = true;
    parent.append(this.root);
  }

  /** Null hides it. Cheap to call every frame (touches the DOM only on change). */
  set(next: { seconds: number; ready: boolean; fill: number } | null): void {
    const visible = next !== null;
    if (visible !== this.shown) {
      this.shown = visible;
      this.root.hidden = !visible;
    }
    if (!next) return;
    const text = next.ready ? (isTouch() ? vi.surf.touch.meterReady : vi.surf.meterReady) : vi.surf.meter(Math.ceil(next.seconds));
    if (text !== this.lastText) {
      this.lastText = text;
      this.label.textContent = text;
      this.root.classList.toggle('ready', next.ready);
    }
    const f = Math.round(next.fill * 100);
    if (f !== this.lastFill) {
      this.lastFill = f;
      this.fill.style.width = `${f}%`;
    }
  }
}
