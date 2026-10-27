import { button, el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import type { Keymap } from '../controls/keymap';

/** The longer hints under the key list (mouse, sliders, each activity). */
const HINTS = ['mouse', 'sliderWheel', 'sceneKeys', 'walkKeys', 'swimKeys', 'diveKeys', 'kayakKeys', 'surfKeys'] as const;

/**
 * "Phím tắt": every keyboard shortcut and the activity hints, in a card over the scene (? or the
 * panel's keyboard button). Esc or a click beside the card closes it.
 */
export class ShortcutsView {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;

  constructor(parent: HTMLElement, private readonly keymap: Keymap) {
    this.root = el('div', 'shortcuts-overlay');
    this.root.hidden = true;
    const card = el('div', 'shortcuts-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', vi.panel.shortcuts);
    const head = el('div', 'shortcuts-head');
    const close = button('', () => this.close(), 'icon-btn');
    close.innerHTML = icons.close;
    close.title = vi.panel.shortcutsClose;
    close.setAttribute('aria-label', vi.panel.shortcutsClose);
    head.append(el('h2', 'shortcuts-title', vi.panel.shortcuts), close);
    this.list = el('dl', 'shortcut-list');
    const hints = el('div', 'shortcuts-hints');
    for (const h of HINTS) hints.append(el('p', 'hint', vi.shortcuts[h]));
    card.append(head, this.list, hints);
    this.root.append(card);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    // Capture: Esc closes the card before it reaches the keymap (where it means "stand up").
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || e.code !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    }, { capture: true });
    parent.append(this.root);
  }

  toggle(): void {
    if (this.root.hidden) this.show();
    else this.close();
  }

  private show(): void {
    // Built on opening: the app registers its keys after the panel is made.
    this.list.replaceChildren();
    for (const sc of this.keymap.list()) this.list.append(el('dt', '', sc.keyLabel), el('dd', '', sc.label));
    this.root.hidden = false;
  }

  private close(): void {
    this.root.hidden = true;
  }
}
