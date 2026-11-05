import { el } from './components';
import { icons } from './icons';

export interface SkillButton<Id extends string> {
  id: Id;
  key: string;
  name: string;
  icon: keyof typeof icons;
}

/** A button's size (px): the menu's round ☰ as measured (see dock); the gap between them. */
const SIZE = 38;
const GAP = 8;
/** A recharged skill flashes this long (ms). */
const FRESH_MS = 700;

/**
 * The manta's skills while riding: a column of round buttons under the menu's ☰ (top right),
 * as big as it, out of the manta's way; the activity card sits to its left. Each shows the skill's own
 * picture large in its colour, glowing, with its key inside under it; pointing at one shows
 * its name beside it. Dimmed by a sweep while it recharges, with a flash when it's ready again.
 * Click or tap one to cast it (the phone's way). Hidden with the setting "Hiện nút tuyệt
 * chiêu"; part of the UI layer, so H hides it.
 */
export class MantaSkillBar<Id extends string> {
  private readonly root: HTMLElement;
  private readonly items: { id: Id; btn: HTMLButtonElement; shown: number; timer: number }[] = [];
  private visible = false;
  private size = SIZE;
  /** Shown or hidden: what docks beside it moves (see `width`). */
  onToggle: (() => void) | null = null;

  constructor(parent: HTMLElement, skills: readonly SkillButton<Id>[], cast: (id: Id) => void) {
    this.root = el('div', 'manta-skills');
    for (const s of skills) {
      const btn = el('button', `manta-skill ${s.id}`);
      btn.type = 'button';
      btn.dataset.name = s.name;
      btn.setAttribute('aria-label', `${s.name} (${s.key})`);
      const icon = el('span', 'manta-skill-icon');
      icon.innerHTML = icons[s.icon];
      btn.append(icon, el('span', 'manta-skill-key', s.key));
      // Don't let the click start a drag-look or keep focus (Space would press it again).
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', () => {
        btn.blur();
        cast(s.id);
      });
      this.root.append(btn);
      this.items.push({ id: s.id, btn, shown: -1, timer: 0 });
    }
    parent.append(this.root);
  }

  /** Room it takes at the right while shown (px, with the gap beside it), else 0. */
  get width(): number {
    return this.visible ? this.size + GAP : 0;
  }

  /**
   * Under the menu's ☰ and as big as it (`handle`: its size, see Panel.dockRect); null: the
   * panel is open over that spot.
   */
  dock(rect: { top: number; right: number; handle?: number } | null): void {
    this.root.classList.toggle('covered', rect === null);
    if (!rect) return;
    if (rect.handle && Math.abs(rect.handle - this.size) > 0.1) {
      this.size = rect.handle;
      this.root.style.setProperty('--skill-size', `${rect.handle}px`);
    }
    this.root.style.top = `${rect.top}px`;
    this.root.style.right = `${rect.right}px`;
  }

  /** Every frame: shown while riding; `wait(id)` → [seconds left, cooldown length]. */
  update(visible: boolean, wait: (id: Id) => readonly [number, number]): void {
    if (visible !== this.visible) {
      this.visible = visible;
      this.root.classList.toggle('on', visible);
      this.onToggle?.();
    }
    if (!visible) return;
    for (const it of this.items) {
      const [left, total] = wait(it.id);
      // Touch the DOM only when the sweep moves on a step (1/40 of the way round).
      const shown = left > 0 ? Math.ceil((left / total) * 40) : 0;
      if (shown === it.shown) continue;
      const wasCooling = it.shown > 0;
      it.shown = shown;
      it.btn.classList.toggle('cooling', left > 0);
      it.btn.style.setProperty('--cd', String(shown / 40));
      if (wasCooling && shown === 0) {
        // Ready again: a short flash.
        it.btn.classList.add('fresh');
        window.clearTimeout(it.timer);
        it.timer = window.setTimeout(() => it.btn.classList.remove('fresh'), FRESH_MS);
      }
    }
  }
}
