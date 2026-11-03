import { button, el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { isTouch } from './touch';
import type { Keymap } from '../controls/keymap';
import type { SettingsStore } from '../core/settings';

type KeyOf = (code: string, fallback: string) => string;

interface GuidePage {
  title: string;
  lines: (k: KeyOf) => readonly string[];
  /** Text for touch screens; null: the same as `lines`. */
  touch: (() => readonly string[]) | null;
}

const PAGES: readonly GuidePage[] = vi.guide.pages;

/**
 * "Hướng dẫn nhanh": a few pages for a first visit, over the scene. Opens by itself on start
 * until "Không hiển thị lại" is ticked (settings.guideHidden); Cài đặt can open it again.
 * Esc, ✕, "Bắt đầu" or a click beside the card closes it.
 */
export class WelcomeGuide {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly dontShow: HTMLInputElement;
  private page = 0;

  constructor(parent: HTMLElement, private readonly keymap: Keymap, private readonly settings: SettingsStore) {
    this.root = el('div', 'shortcuts-overlay guide-overlay');
    this.root.hidden = true;
    const card = el('div', 'shortcuts-card guide-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', vi.guide.title);
    const head = el('div', 'shortcuts-head');
    const close = button('', () => this.close(), 'icon-btn');
    close.innerHTML = icons.close;
    close.title = vi.guide.close;
    close.setAttribute('aria-label', vi.guide.close);
    this.title = el('h2', 'shortcuts-title');
    head.append(this.title, close);
    this.body = el('ul', 'guide-lines');
    this.body.setAttribute('aria-live', 'polite');
    this.dots = el('div', 'guide-dots');
    for (let i = 0; i < PAGES.length; i++) {
      const dot = button('', () => this.go(i), 'guide-dot');
      dot.setAttribute('aria-label', vi.guide.step(i + 1, PAGES.length));
      this.dots.append(dot);
    }

    const foot = el('div', 'guide-foot');
    const label = el('label', 'guide-dont-show');
    this.dontShow = el('input');
    this.dontShow.type = 'checkbox';
    label.append(this.dontShow, el('span', '', vi.guide.dontShow));
    const nav = el('div', 'guide-nav');
    this.prevBtn = button(vi.guide.prev, () => this.go(this.page - 1), 'btn small');
    this.nextBtn = button(vi.guide.next, () => this.next(), 'btn small primary');
    nav.append(this.prevBtn, this.nextBtn);
    foot.append(label, nav);

    card.append(head, this.body, this.dots, foot);
    this.root.append(card);
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
    // Capture, as in ShortcutsView: Esc and the arrows act on the card, not on the scene.
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.code === 'Escape') this.close();
      else if (e.code === 'ArrowRight') this.go(this.page + 1);
      else if (e.code === 'ArrowLeft') this.go(this.page - 1);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true });
    parent.append(this.root);
  }

  /** On start: opens unless "Không hiển thị lại" was ticked before. */
  showOnStart(): void {
    if (!this.settings.get().guideHidden) this.show();
  }

  show(): void {
    this.dontShow.checked = this.settings.get().guideHidden;
    this.go(0);
    this.root.hidden = false;
    this.nextBtn.focus();
  }

  private next(): void {
    if (this.page < PAGES.length - 1) this.go(this.page + 1);
    else this.close();
  }

  private go(i: number): void {
    const page = PAGES[i];
    if (!page) return;
    this.page = i;
    // Rebuilt on each page: the keys are read from the keymap, the text from the current input.
    const lines = isTouch() && page.touch ? page.touch() : page.lines((code, fb) => this.keymap.keyLabel(code, fb));
    this.title.textContent = page.title;
    this.body.replaceChildren(...lines.map((line) => el('li', '', line)));
    this.dots.querySelectorAll('.guide-dot').forEach((d, j) => d.classList.toggle('active', j === i));
    this.prevBtn.disabled = i === 0;
    this.nextBtn.textContent = i === PAGES.length - 1 ? vi.guide.done : vi.guide.next;
  }

  private close(): void {
    this.root.hidden = true;
    if (this.dontShow.checked !== this.settings.get().guideHidden) this.settings.update({ guideHidden: this.dontShow.checked });
  }
}
