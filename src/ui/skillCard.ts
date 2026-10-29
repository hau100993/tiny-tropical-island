import { el } from './components';

/** Whose skill: sets the card's colours (styles: .skill-card.water …). */
export type SkillElement = 'water' | 'fire' | 'grass' | 'spark' | 'moon' | 'combo';

/** How long a card stays up (ms; its CSS animation lasts as long). */
const CARD_MS = 2200;

/**
 * The skill's name, big, in the upper middle of the screen as in an anime: who, then the
 * name in large glowing letters in the element's colours, sweeping in and fading out. Part of
 * the UI layer, so H (hide the UI) hides it too.
 */
export class SkillCard {
  private readonly root: HTMLElement;
  private readonly who: HTMLElement;
  private readonly name: HTMLElement;
  private timer = 0;
  /** Until when (ms, performance.now) a combo's card stays up over single skills' cards. */
  private comboUntil = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'skill-card');
    this.root.setAttribute('aria-live', 'polite');
    this.who = el('div', 'skill-card-who');
    this.name = el('div', 'skill-card-name');
    this.root.append(this.who, this.name);
    parent.append(this.root);
  }

  /** `text`: "Who: Skill name" (the creatures' skill strings); the part after ": " is the name. */
  show(text: string, element: SkillElement): void {
    // A combo's card isn't cut short by the skills that made it.
    const now = performance.now();
    if (element !== 'combo' && now < this.comboUntil) return;
    if (element === 'combo') this.comboUntil = now + CARD_MS;
    const i = text.indexOf(': ');
    this.who.textContent = i >= 0 ? text.slice(0, i) : '';
    this.name.textContent = i >= 0 ? text.slice(i + 2) : text;
    this.root.className = `skill-card ${element}`;
    // Restart the animation: off for a frame (a reflow), then on.
    void this.root.offsetWidth;
    this.root.classList.add('on');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.remove('on'), CARD_MS);
  }
}
