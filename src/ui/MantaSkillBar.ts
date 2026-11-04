import { el } from './components';
import { icons } from './icons';

export interface SkillButton<Id extends string> {
  id: Id;
  key: string;
  name: string;
  icon: keyof typeof icons;
}

/**
 * The manta's skills while riding: a row of round buttons at the bottom (key, icon, name),
 * each dimmed by a sweep while it recharges (no countdown: the sweep says enough). Hidden with
 * the setting "Hiện nút tuyệt chiêu". Click or tap one to cast it (the phone's way).
 * Part of the UI layer, so H hides it.
 */
export class MantaSkillBar<Id extends string> {
  private readonly root: HTMLElement;
  private readonly items: { id: Id; btn: HTMLButtonElement; shown: number }[] = [];
  private visible = false;

  constructor(parent: HTMLElement, skills: readonly SkillButton<Id>[], cast: (id: Id) => void) {
    this.root = el('div', 'manta-skills');
    for (const s of skills) {
      const btn = el('button', `manta-skill ${s.id}`);
      btn.type = 'button';
      btn.title = `${s.key}: ${s.name}`;
      const icon = el('span', 'manta-skill-icon');
      icon.innerHTML = icons[s.icon];
      btn.append(el('span', 'manta-skill-key', s.key), icon, el('span', 'manta-skill-name', s.name));
      // Don't let the click start a drag-look or keep focus (Space would press it again).
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', () => {
        btn.blur();
        cast(s.id);
      });
      this.root.append(btn);
      this.items.push({ id: s.id, btn, shown: -1 });
    }
    parent.append(this.root);
  }

  /** Every frame: shown while riding; `wait(id)` → [seconds left, cooldown length]. */
  update(visible: boolean, wait: (id: Id) => readonly [number, number]): void {
    if (visible !== this.visible) {
      this.visible = visible;
      this.root.classList.toggle('on', visible);
    }
    if (!visible) return;
    for (const it of this.items) {
      const [left, total] = wait(it.id);
      // Touch the DOM only when the sweep moves on a step (1/40 of the way round).
      const shown = left > 0 ? Math.ceil((left / total) * 40) : 0;
      if (shown === it.shown) continue;
      it.shown = shown;
      it.btn.classList.toggle('cooling', left > 0);
      it.btn.style.setProperty('--cd', String(shown / 40));
    }
  }
}
