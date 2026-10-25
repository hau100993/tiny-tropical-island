import { el } from './components';
import { MAX_HP } from '../core/health';
import { vi } from './strings.vi';

/**
 * Health in the forest (core/health.ts): two small glass bars at the top left, you and Mochi,
 * shown while the wild ones may attack or anyone is hurt; a red flash round the screen's edge
 * when you are hit; and the screen going dark when you faint. Part of the UI layer (H hides it).
 */
export class HealthBars {
  private readonly root: HTMLElement;
  private readonly you: { fill: HTMLElement; num: HTMLElement };
  private readonly dog: { fill: HTMLElement; num: HTMLElement; row: HTMLElement };
  private readonly flash: HTMLElement;
  private readonly faint: HTMLElement;
  private readonly faintText: HTMLElement;
  private shown = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hp-bars');
    const row = (label: string, cls: string): { fill: HTMLElement; num: HTMLElement; row: HTMLElement } => {
      const r = el('div', `hp-row ${cls}`);
      const bar = el('span', 'hp-bar');
      const fill = el('span', 'hp-fill');
      bar.append(fill);
      const num = el('span', 'hp-num');
      r.append(el('span', 'hp-label', label), bar, num);
      this.root.append(r);
      return { fill, num, row: r };
    };
    this.you = row(vi.health.you, 'you');
    this.dog = row(vi.health.dog, 'dog');
    this.flash = el('div', 'hurt-flash');
    this.faint = el('div', 'faint');
    this.faintText = el('div', 'faint-text');
    this.faint.append(this.faintText);
    parent.append(this.root, this.flash, this.faint);
  }

  /** Every frame (cheap: only writes what changed). `dog`: Mochi is with you. */
  update(show: boolean, you: number, dog: number, withDog: boolean): void {
    if (show !== this.shown) {
      this.shown = show;
      this.root.classList.toggle('on', show);
    }
    if (!show) return;
    this.set(this.you, you);
    this.dog.row.hidden = !withDog;
    if (withDog) this.set(this.dog, dog);
  }

  private set(b: { fill: HTMLElement; num: HTMLElement }, hp: number): void {
    const v = Math.round(hp);
    const text = String(v);
    if (b.num.textContent === text) return;
    b.num.textContent = text;
    b.fill.style.width = `${(100 * hp) / MAX_HP}%`;
    b.fill.classList.toggle('low', hp < 30);
  }

  /** You were hit: the screen's edge flashes red. */
  hurt(): void {
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
  }

  /** Fainting: dark (with the message) or clear again. */
  setFaint(on: boolean): void {
    this.faintText.textContent = vi.health.fainted;
    this.faint.classList.toggle('on', on);
  }
}
