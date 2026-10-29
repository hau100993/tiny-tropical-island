import { el } from './components';

/** Holding the bubble feeds again every this many ms. */
const REPEAT_MS = 400;

/**
 * The little speech bubble over a pet you walk up to: "🍅 Cho Sương ăn?" and its Rank under
 * it. A click or tap feeds one tomato; holding keeps feeding (one every 0.4 s). Positioned each
 * frame by the game (screen pixels of the pet's head); hidden with the rest of the UI (H).
 */
export class FeedBubble {
  private readonly root: HTMLButtonElement;
  private readonly main: HTMLElement;
  private readonly sub: HTMLElement;
  private repeat = 0;
  private shownKey = '';

  constructor(parent: HTMLElement, private readonly onFeed: () => void) {
    this.root = el('button', 'feed-bubble');
    this.root.type = 'button';
    this.root.hidden = true;
    this.main = el('span', 'feed-bubble-main');
    this.sub = el('span', 'feed-bubble-sub');
    this.root.append(this.main, this.sub);
    this.root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onFeed();
      window.clearInterval(this.repeat);
      this.repeat = window.setInterval(() => this.onFeed(), REPEAT_MS);
    });
    const stop = (): void => window.clearInterval(this.repeat);
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) this.root.addEventListener(type, stop);
    // Keyboard users: Enter / Space on the focused bubble.
    this.root.addEventListener('click', (e) => {
      if (e.detail === 0) this.onFeed();
    });
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(text: string, sub: string, x: number, y: number): void {
    const key = `${text}|${sub}`;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.main.textContent = text;
      this.sub.textContent = sub;
    }
    this.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    this.root.hidden = false;
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    window.clearInterval(this.repeat);
  }

  /** A little bounce (a tomato went). */
  pop(): void {
    this.root.classList.remove('pop');
    void this.root.offsetWidth;
    this.root.classList.add('pop');
  }
}
