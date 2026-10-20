import { el } from './components';
import { vi } from './strings.vi';

export interface ActivityItem {
  key: string;
  label: string;
}

/**
 * Walking near the sea: a small card listing the activities you can start here, each with its
 * shortcut key ("K  Chèo kayak"). It shows and hides on its own as you walk; the keys
 * themselves are handled by the keymap.
 */
export class ActivityMenu {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private shown: readonly ActivityItem[] | null = null;
  private readonly note: HTMLElement;
  private noteTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'activity-menu');
    this.root.setAttribute('role', 'status');
    this.root.append(el('div', 'activity-title', vi.sea.menuTitle));
    this.list = el('div', 'activity-list');
    this.root.append(this.list);
    this.root.hidden = true;
    this.note = el('div', 'activity-note');
    this.note.hidden = true;
    parent.append(this.root, this.note);
  }

  /** The activities available where you stand; null hides the card. */
  set(items: readonly ActivityItem[] | null): void {
    if (items === this.shown) return;
    this.shown = items;
    this.root.hidden = items === null;
    if (!items) return;
    this.list.replaceChildren(
      ...items.map((it) => {
        const row = el('div', 'activity-item');
        row.append(el('kbd', '', it.key), el('span', '', it.label));
        return row;
      }),
    );
  }

  /** A short message for a few seconds (e.g. why you can't get out of the kayak here). */
  flash(text: string): void {
    window.clearTimeout(this.noteTimer);
    this.note.textContent = text;
    this.note.hidden = false;
    this.noteTimer = window.setTimeout(() => (this.note.hidden = true), 2800);
  }
}
