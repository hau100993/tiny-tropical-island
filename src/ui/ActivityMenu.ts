import { el } from './components';
import { icons } from './icons';
import { isTouch } from './touch';

/** Standing still this long (s) opens it out; moving this long (s) folds it to its icon. */
const STILL_S = 0.6;
const MOVE_S = 0.35;
/** Open this long (s) while you stand still, then it folds to its icon (any change opens it again). */
const OPEN_S = 9;
/** A short note stays this long (ms). */
const NOTE_MS = 2800;
/** Kept this far (px) from the screen's edges; the bubble's tail sits this far above the head. */
const MARGIN = 12;
const LIFT = 10;
/** How fast it follows the head (1/s): smooth, but never lagging far behind. */
const FOLLOW = 18;

/** A key as keyboard caps: "Shift + Space" → [Shift] + [Space]. */
function keycaps(key: string): HTMLElement {
  const box = el('span', 'keycaps');
  key.split(' + ').forEach((k, i) => {
    if (i > 0) box.append(el('span', 'keycaps-plus', '+'));
    box.append(el('kbd', 'key keycap', k));
  });
  return box;
}

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
 * kayak, whistling for the manta): a speech bubble over your character's head, as games put
 * their interaction prompts by the character (a spatial prompt: anchored to the head, but a
 * fixed size on screen, so it stays readable at any camera distance). The first row is the main
 * action (larger), the others below it; each row is a button, the same as its key. Walking it
 * folds to the main action's icon and key; standing still it opens out (for a while, or as long
 * as it's pointed at); with no head in view (through the eyes, seated) it sits low in the
 * middle of the screen. Short notes (`flash`) show in it as a line of speech.
 */
export class ActivityMenu {
  private readonly root: HTMLElement;
  private readonly bubble: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly noteText: HTMLElement;
  private shown: ActivityCard | null = null;
  private hovered = false;
  private noting = false;
  private noteTimer = 0;
  private still = 0;
  private moving = 0;
  private openFor = OPEN_S;
  private compact = false;
  // Where it is on screen (px, the tail's tip) and its size (for keeping it on screen).
  private x = -1;
  private y = -1;
  private w = 0;
  private h = 0;
  private lastPlaced = '';
  private free = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'activity-menu');
    this.root.setAttribute('role', 'region');
    this.bubble = el('div', 'activity-bubble');
    this.title = el('div', 'activity-title');
    this.list = el('div', 'activity-list');
    this.note = el('div', 'activity-note');
    this.note.setAttribute('role', 'status');
    const info = el('span', 'activity-icon');
    info.innerHTML = icons.info;
    this.noteText = el('span', 'activity-label');
    this.note.append(info, this.noteText);
    this.bubble.append(this.title, this.list);
    // The note: a small bubble of its own above (a line of speech).
    this.root.append(this.note, this.bubble);
    this.root.addEventListener('pointerenter', () => {
      this.hovered = true;
      this.sync();
    });
    this.root.addEventListener('pointerleave', () => {
      this.hovered = false;
      this.sync();
    });
    // Its size changes with what it shows (folded, open, a note): measured when it does, not per frame.
    new ResizeObserver(() => {
      this.w = this.root.offsetWidth;
      this.h = this.root.offsetHeight;
    }).observe(this.root);
    parent.append(this.root);
  }

  /** What is on offer where you stand; null: nothing (the bubble goes, unless a note shows). */
  set(card: ActivityCard | null): void {
    if (card === this.shown) return;
    this.shown = card;
    if (card) {
      this.title.textContent = card.title;
      // One action needs no heading (its label says it all).
      this.title.hidden = card.items.length < 2;
      this.root.setAttribute('aria-label', card.title);
      this.list.replaceChildren(...card.items.map((it, i) => this.row(it, i === 0)));
      // The keys as one column (the labels line up): as wide as the widest, once laid out.
      this.list.style.removeProperty('--keys-w');
      requestAnimationFrame(() => {
        let w = 0;
        for (const k of this.list.querySelectorAll<HTMLElement>('.activity-item:not(.main) .keycaps')) w = Math.max(w, k.offsetWidth);
        if (w > 0) this.list.style.setProperty('--keys-w', `${w}px`);
      });
      // Something new here: open it out.
      this.openFor = OPEN_S;
      this.moving = 0;
    }
    this.sync();
  }

  /** Every frame: `moving` (walking, paddling, flying): it folds; standing still opens it again. */
  update(dt: number, moving: boolean): void {
    if (moving) {
      this.still = 0;
      this.moving += dt;
    } else {
      const was = this.still;
      this.still += dt;
      this.moving = 0;
      if (was < STILL_S && this.still >= STILL_S) this.openFor = OPEN_S;
    }
    this.openFor = Math.max(0, this.openFor - dt);
    const fold = !isTouch() && !this.hovered && !this.noting && (this.moving > MOVE_S || this.openFor <= 0);
    if (fold !== this.compact) {
      this.compact = fold;
      this.sync();
    }
  }

  /**
   * Every frame: where your head is on screen (px), or null with no head in view (through the
   * eyes, seated, the overview): then low in the middle of the screen.
   */
  place(head: { x: number; y: number } | null, dt: number): void {
    if (!this.root.classList.contains('show')) {
      this.x = -1;
      return;
    }
    // No head to point at: no tail.
    if (this.free !== (head === null)) {
      this.free = head === null;
      this.root.classList.toggle('free', this.free);
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const tx = head ? head.x : W / 2;
    const ty = head ? head.y - LIFT : H * 0.78;
    if (this.x < 0) {
      this.x = tx;
      this.y = ty;
    } else {
      const k = 1 - Math.exp(-FOLLOW * dt);
      this.x += (tx - this.x) * k;
      this.y += (ty - this.y) * k;
    }
    // On screen whole: the tail's tip is its bottom middle.
    const x = Math.round(Math.min(W - MARGIN - this.w / 2, Math.max(MARGIN + this.w / 2, this.x)));
    const y = Math.round(Math.min(H - MARGIN, Math.max(MARGIN + this.h, this.y)));
    const at = `${x},${y}`;
    if (at === this.lastPlaced) return;
    this.lastPlaced = at;
    this.root.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  }

  /** A short message for a few seconds (e.g. why you can't get out of the kayak here). */
  flash(text: string, ms = NOTE_MS): void {
    window.clearTimeout(this.noteTimer);
    this.noteText.textContent = text;
    this.noting = true;
    this.sync();
    this.noteTimer = window.setTimeout(() => {
      this.noting = false;
      this.sync();
    }, ms);
  }

  private row(it: ActivityItem, main: boolean): HTMLElement {
    const cls = `activity-item${main ? ' main' : ''}`;
    const row = it.run ? el('button', cls) : el('div', `${cls} hint`);
    if (it.icon) {
      const icon = el('span', 'activity-icon');
      icon.innerHTML = icons[it.icon];
      row.append(icon);
    }
    row.append(keycaps(it.key), el('span', 'activity-label', it.label));
    if (it.run && row instanceof HTMLButtonElement) {
      const run = it.run;
      row.type = 'button';
      row.tabIndex = -1;
      row.title = `${it.label} (${it.key})`;
      // No focus: a later Space (dive, jump) would press the button again.
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => run());
    }
    return row;
  }

  private sync(): void {
    const card = this.shown !== null;
    this.root.classList.toggle('noting', this.noting);
    this.root.classList.toggle('note-only', this.noting && !card);
    this.root.classList.toggle('compact', this.compact && card && !this.noting);
    this.root.classList.toggle('show', card || this.noting);
  }
}
