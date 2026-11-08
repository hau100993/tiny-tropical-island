import { el } from './components';
import { vi } from './strings.vi';

/** The tomato line stays this long (ms). */
const TOMATO_MS = 3500;

/**
 * Săn Bong Bóng's readout, top middle while you ride and have burst a bubble: bubbles burst so
 * far, the count toward the next tomato, and the combo (×n) popping in while a chain lasts.
 * Gives way to the ring course's readout (styles); part of the UI layer, so H hides it.
 */
export class HuntHud {
  private readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly toward: HTMLElement;
  private readonly combo: HTMLElement;
  private shown = false;
  private text = '';
  private comboShown = 0;
  private tomatoUntil = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hunt-hud');
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-label', vi.manta.hunt.title);
    this.count = el('span', 'hunt-hud-count');
    this.toward = el('span', 'hunt-hud-toward');
    this.combo = el('span', 'hunt-hud-combo');
    this.root.append(el('span', 'hunt-hud-icon', '🫧'), this.count, this.toward, this.combo);
    parent.append(this.root);
  }

  show(total: number, toward: number, block: number, combo: number): void {
    if (!this.shown) {
      this.shown = true;
      this.root.classList.add('on');
    }
    const tomato = performance.now() < this.tomatoUntil;
    const text = `${total}|${toward}|${tomato}`;
    if (text !== this.text) {
      this.text = text;
      this.count.textContent = vi.manta.hunt.count(total);
      this.toward.textContent = tomato ? vi.manta.hunt.tomato : vi.manta.hunt.toward(toward, block);
      this.toward.classList.toggle('won', tomato);
    }
    const c = combo >= 2 ? combo : 0;
    if (c !== this.comboShown) {
      this.comboShown = c;
      this.combo.textContent = c ? vi.manta.hunt.combo(c) : '';
      this.combo.classList.toggle('on', c > 0);
      // Restart the pop animation on each step.
      this.combo.classList.remove('pop');
      if (c) {
        void this.combo.offsetWidth;
        this.combo.classList.add('pop');
      }
    }
  }

  /** A tomato was paid: say so for a few seconds. */
  tomato(): void {
    this.tomatoUntil = performance.now() + TOMATO_MS;
    this.text = '';
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove('on');
  }
}
