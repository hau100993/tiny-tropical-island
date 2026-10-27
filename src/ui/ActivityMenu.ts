import { el } from './components';
import { icons } from './icons';
import { isTouch } from './touch';

/** Shown this long (ms) after it appears, then it fades out; standing still brings it back. */
const SHOW_MS = 5000;
/** Standing still this long (s) shows it again. */
const STILL_S = 0.6;
/** A short note stays this long (ms). */
const NOTE_MS = 2800;

export interface ActivityItem {
  key: string;
  label: string;
  icon?: keyof typeof icons;
  /** Clicking runs it (the same as its key); without, the row is only a hint. */
  run?: () => void;
}

/** What one place offers: a title and its rows. Keep the objects: `set` compares by identity. */
export interface ActivityCard {
  title: string;
  items: readonly ActivityItem[];
}

/**
 * What you can do where you stand (by the sea, at the desk, the bath, the hammock, in the
 * kayak): a card under the main menu bar, top right, in the panel's style. Each row is a button,
 * the same as its shortcut key shown on the right. It shows when you get there or what's on
 * offer changes, fades out after SHOW_MS, and comes back when you stand still; pointing at it
 * keeps it. While the menu is open over it, it hides. Short notes (`flash`) are its last row (or
 * the card shows just the note when nothing is on offer).
 */
export class ActivityMenu {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly noteText: HTMLElement;
  private shown: ActivityCard | null = null;
  private visible = false;
  private covered = false;
  private hovered = false;
  private hideTimer = 0;
  private noteTimer = 0;
  private still = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'activity-menu');
    this.root.setAttribute('role', 'region');
    // Pointing at it isn't pointing at the menu's corner (Panel).
    this.root.dataset.noCorner = '';
    this.title = el('div', 'activity-title');
    this.list = el('div', 'activity-list');
    this.note = el('div', 'activity-note');
    this.note.setAttribute('role', 'status');
    const info = el('span', 'activity-icon');
    info.innerHTML = icons.info;
    this.noteText = el('span', 'activity-label');
    this.note.append(info, this.noteText);
    this.root.append(this.title, this.list, this.note);
    this.root.addEventListener('pointerenter', () => {
      this.hovered = true;
      window.clearTimeout(this.hideTimer);
    });
    this.root.addEventListener('pointerleave', () => {
      this.hovered = false;
      this.scheduleHide();
    });
    parent.append(this.root);
  }

  /** What is on offer where you stand; null: nothing (the card goes). */
  set(card: ActivityCard | null): void {
    if (card === this.shown) return;
    this.shown = card;
    if (!card) {
      this.visible = false;
      this.sync();
      return;
    }
    this.title.textContent = card.title;
    this.root.setAttribute('aria-label', card.title);
    this.list.replaceChildren(...card.items.map((it) => this.row(it)));
    this.show();
  }

  /** Every frame: `moving` (walking, paddling); standing still a moment shows it again. */
  update(dt: number, moving: boolean): void {
    if (moving) {
      this.still = 0;
      return;
    }
    const was = this.still;
    this.still += dt;
    if (was < STILL_S && this.still >= STILL_S && this.shown && !this.visible) this.show();
  }

  /**
   * Where it sits (px): `top` and `right`, as wide as the menu bar (`width`, 0: keep), or null
   * while the menu is open over it.
   */
  dock(rect: { top: number; right: number; width: number } | null): void {
    const wasCovered = this.covered;
    this.covered = rect === null;
    if (rect) {
      this.root.style.top = `${rect.top}px`;
      this.root.style.right = `${rect.right}px`;
      if (rect.width > 0) this.root.style.width = `${Math.max(240, rect.width)}px`;
    }
    // The menu closed again: it was just looked at, so show what's on offer here.
    if (wasCovered && !this.covered && this.shown) this.show();
    else this.sync();
  }

  /** A short message for a few seconds (e.g. why you can't get out of the kayak here). */
  flash(text: string, ms = NOTE_MS): void {
    window.clearTimeout(this.noteTimer);
    this.noteText.textContent = text;
    this.root.classList.add('noting');
    this.sync();
    this.noteTimer = window.setTimeout(() => {
      this.root.classList.remove('noting');
      this.sync();
    }, ms);
  }

  private row(it: ActivityItem): HTMLElement {
    const row = it.run ? el('button', 'activity-item') : el('div', 'activity-item hint');
    if (it.icon) {
      const icon = el('span', 'activity-icon');
      icon.innerHTML = icons[it.icon];
      row.append(icon);
    }
    row.append(el('span', 'activity-label', it.label), el('kbd', 'key', it.key));
    if (it.run && row instanceof HTMLButtonElement) {
      const run = it.run;
      row.type = 'button';
      row.tabIndex = -1;
      // No focus: a later Space (dive, jump) would press the button again.
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => run());
    }
    return row;
  }

  private show(): void {
    this.visible = true;
    this.sync();
    this.scheduleHide();
  }

  private scheduleHide(): void {
    window.clearTimeout(this.hideTimer);
    // On a touch screen its rows are the action buttons: it stays while something is on offer.
    if (this.hovered || isTouch()) return;
    this.hideTimer = window.setTimeout(() => {
      if (this.hovered) return;
      this.visible = false;
      this.sync();
    }, SHOW_MS);
  }

  private sync(): void {
    const full = this.visible && this.shown !== null;
    const noting = this.root.classList.contains('noting');
    this.root.classList.toggle('note-only', noting && !full);
    this.root.classList.toggle('show', (full || noting) && !this.covered);
  }
}
