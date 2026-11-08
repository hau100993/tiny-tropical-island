import { button, el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { isTouch } from './touch';
import type { Keymap } from '../controls/keymap';
import type { PanelTab, SettingsStore } from '../core/settings';

/** What the tour may do to the panel (Panel implements it). */
export interface GuideHost {
  /** Opens or shuts the panel, and keeps a tucked-away one from closing by itself meanwhile. */
  showPanel(open: boolean): void;
  /** The tour has ended: the panel behaves as usual again. */
  release(): void;
  selectTab(tab: PanelTab): void;
  currentTab(): PanelTab;
  isPanelOpen(): boolean;
}

type StepId = keyof typeof vi.guide.steps;

/** The panel as a step wants it. */
interface PanelState {
  open?: boolean;
  tab?: PanelTab;
}

interface Step {
  id: StepId;
  /** `data-guide` name of what the pointer goes to; null: the card alone in the middle. */
  point: string | null;
  /** `data-guide` area lit together with `point` (default: `point` alone). */
  light?: string;
  /** Set on arrival at the step. */
  enter: PanelState;
  /** Set when the pointer "clicks" `point`; without it the pointer only shows the place. */
  click?: PanelState;
  /** `data-guide` area lit once clicked (☰ itself is gone once the panel is open). */
  after?: string;
  /** The scene step: no dimming, the pointer drags across the island instead. */
  drag?: boolean;
  /** Points at a keyboard-only button: passed over on touch screens. */
  keyboard?: boolean;
}

const STEPS: readonly Step[] = [
  { id: 'welcome', point: null, enter: { open: false } },
  { id: 'handle', point: 'handle', enter: { open: false }, click: { open: true }, after: 'panel' },
  { id: 'time', point: 'time', enter: { open: true } },
  { id: 'master', point: 'master', enter: { open: true } },
  { id: 'scene', point: 'tab-scene', light: 'content', enter: { open: true }, click: { tab: 'scene' } },
  { id: 'sound', point: 'tab-sound', light: 'content', enter: { open: true }, click: { tab: 'sound' } },
  { id: 'view', point: 'tab-view', light: 'content', enter: { open: true }, click: { tab: 'view' } },
  { id: 'pets', point: 'tab-pets', light: 'content', enter: { open: true }, click: { tab: 'pets' } },
  { id: 'settings', point: 'tab-settings', light: 'content', enter: { open: true }, click: { tab: 'settings' } },
  { id: 'keys', point: 'keys', light: 'header-tools', enter: { open: true }, keyboard: true },
  { id: 'world', point: null, drag: true, enter: { open: false } },
  { id: 'manta', point: null, enter: { open: false } },
  { id: 'done', point: null, enter: { open: false } },
];

/** The drag demo over the scene: fractions of the window, `down` while the button is held. */
const DRAG_PATH: ReadonlyArray<{ x: number; y: number; down: boolean; hold: number }> = [
  { x: 0.36, y: 0.5, down: false, hold: 300 },
  { x: 0.36, y: 0.5, down: true, hold: 150 },
  { x: 0.6, y: 0.44, down: true, hold: 0 },
  { x: 0.6, y: 0.44, down: false, hold: 500 },
  { x: 0.46, y: 0.68, down: false, hold: 200 },
  { x: 0.46, y: 0.68, down: true, hold: 120 },
  { x: 0.46, y: 0.68, down: false, hold: 700 },
];

/** Follow speed of the pointer and the light (1/s): about 0.5 s to get there. */
const FOLLOW = 7;
/** Padding of the lit area around its elements (px). */
const PAD = 6;
/** Gap between the lit area and the card (px). */
const GAP = 14;
/** How long the click ring shows before the click takes effect (ms). */
const CLICK_MS = 260;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * "Hướng dẫn nhanh": a guided tour on start. A drawn pointer glides to each place in the panel
 * and "clicks" it (the panel really opens, the tab really changes), that place is lit and the
 * rest dimmed, and a card beside it says what it does. Opens by itself on start until it has
 * been seen once, finished or skipped (settings.guideHidden); Cài đặt can start it again.
 *
 * Everything is DOM and CSS; one requestAnimationFrame loop runs only while the tour is open. It
 * measures the targets every frame, so the pointer and the light follow the panel as it slides.
 */
export class WelcomeGuide {
  private readonly root: HTMLElement;
  private readonly light: HTMLElement;
  private readonly pointer: HTMLElement;
  private readonly card: HTMLElement;
  private readonly count: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private index = 0;
  private raf = 0;
  private lastT = 0;
  /** Where the tour found the panel, given back at the end. */
  private restore: { open: boolean; tab: PanelTab } | null = null;
  // Animation state, reused every frame (no allocation in the loop).
  private readonly lit: Box = { x: 0, y: 0, w: 0, h: 0 };
  private readonly litGoal: Box = { x: 0, y: 0, w: 0, h: 0 };
  private px = 0;
  private py = 0;
  /** What the pointer goes to; and the lit area: `litEl` with `lightEl` (step.light) around it. */
  private pointEl: Element | null = null;
  private litEl: Element | null = null;
  private lightEl: Element | null = null;
  private clickDue = 0;
  private clicked = false;
  private dragIndex = 0;
  private dragWait = 0;
  /** The card's size, measured when its text changes (not every frame: that forces a layout). */
  private cardW = 0;
  private cardH = 0;
  /** Left edge of the open panel (px), so the card goes beside it, not over its header. */
  private panelLeft = Infinity;
  private panelEl: Element | null = null;

  constructor(
    parent: HTMLElement,
    private readonly keymap: Keymap,
    private readonly settings: SettingsStore,
    private readonly host: GuideHost,
  ) {
    this.root = el('div', 'guide-tour');
    this.root.hidden = true;
    this.light = el('div', 'guide-light');
    this.pointer = el('div', 'guide-pointer');
    this.pointer.innerHTML = POINTER_SVG;
    this.pointer.setAttribute('aria-hidden', 'true');

    this.card = el('div', 'guide-card');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', vi.guide.title);
    const head = el('div', 'guide-head');
    this.count = el('span', 'guide-count');
    const close = button('', () => this.close(), 'icon-btn');
    close.innerHTML = icons.close;
    close.title = vi.guide.close;
    close.setAttribute('aria-label', vi.guide.close);
    head.append(this.count, close);
    this.title = el('h2', 'guide-title');
    this.body = el('ul', 'guide-lines');
    this.body.setAttribute('aria-live', 'polite');
    const foot = el('div', 'guide-foot');
    const nav = el('div', 'guide-nav');
    this.prevBtn = button(vi.guide.prev, () => this.go(this.index - 1, -1), 'btn small');
    this.nextBtn = button(vi.guide.next, () => this.next(), 'btn small primary');
    nav.append(this.prevBtn, this.nextBtn);
    foot.append(el('span', 'guide-again', vi.guide.again), nav);
    this.card.append(head, this.title, this.body, foot);

    this.root.append(this.light, this.card, this.pointer);
    // Capture: while the tour is open the keys drive it, not the scene (C would start walking).
    window.addEventListener('keydown', (e) => {
      if (this.root.hidden || e.key === 'Tab' || e.key === 'F11' || e.key === 'F12') return;
      if (e.code === 'Escape') this.close();
      else if (e.code === 'ArrowRight') this.next();
      else if (e.code === 'ArrowLeft') this.go(this.index - 1, -1);
      else if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) this.next();
      else if (e.code === 'Space' || e.code === 'Enter') return; // the focused button or checkbox
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true });
    window.addEventListener('resize', () => {
      if (!this.root.hidden) this.snap();
    });
    parent.append(this.root);
  }

  /** On start: opens until it has been seen once (finished or skipped). */
  showOnStart(): void {
    if (!this.settings.get().guideHidden) this.show();
  }

  show(): void {
    if (!this.root.hidden) return;
    this.restore = { open: this.host.isPanelOpen(), tab: this.host.currentTab() };
    this.root.hidden = false;
    this.px = window.innerWidth / 2;
    this.py = window.innerHeight / 2;
    this.go(0, 1);
    this.snap();
    this.nextBtn.focus();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private next(): void {
    if (this.index < STEPS.length - 1) this.go(this.index + 1, 1);
    else this.close();
  }

  /**
   * Goes to step `i`; a step whose place is not here (keyboard buttons on touch) is passed over
   * in direction `dir`. Decided by the step, not by measuring: the panel may still be opening.
   */
  private go(i: number, dir: 1 | -1): void {
    const step = STEPS[i];
    if (!step) return;
    const point = step.point ? document.querySelector(`[data-guide="${step.point}"]`) : null;
    if ((step.point && !point) || (step.keyboard && isTouch())) {
      this.go(i + dir, dir);
      return;
    }
    this.apply(step.enter);
    this.index = i;
    this.pointEl = point;
    this.litEl = point;
    this.lightEl = step.light ? document.querySelector(`[data-guide="${step.light}"]`) : null;
    this.clicked = !step.click;
    this.clickDue = 0;
    this.dragIndex = 0;
    this.dragWait = 0;
    this.pointer.classList.remove('down', 'clicking');

    const text = vi.guide.steps[step.id];
    const lines = isTouch() && 'touch' in text ? text.touch() : text.lines((code, fb) => this.keymap.keyLabel(code, fb));
    // Counted over the steps shown here (touch screens skip the keyboard step): no 9 → 11.
    const shown = STEPS.filter((s) => !(s.keyboard && isTouch()));
    this.count.textContent = vi.guide.step(shown.indexOf(step) + 1, shown.length);
    this.title.textContent = text.title;
    this.body.replaceChildren(...lines.map((line) => el('li', '', line)));
    this.prevBtn.disabled = i === 0;
    this.nextBtn.textContent = i === STEPS.length - 1 ? vi.guide.done : vi.guide.next;
    this.root.classList.toggle('dragging', !!step.drag);
    this.root.classList.toggle('touch', isTouch());
    this.cardW = this.card.offsetWidth;
    this.cardH = this.card.offsetHeight;
  }

  private apply(state: PanelState): void {
    if (state.tab !== undefined) this.host.selectTab(state.tab);
    if (state.open !== undefined) this.host.showPanel(state.open);
  }

  private close(): void {
    if (this.root.hidden) return;
    cancelAnimationFrame(this.raf);
    this.root.hidden = true;
    if (this.restore) {
      this.host.selectTab(this.restore.tab);
      this.host.showPanel(this.restore.open);
    }
    this.host.release();
    // Seen once (finished, skipped with × or Esc): it no longer opens by itself.
    if (!this.settings.get().guideHidden) this.settings.update({ guideHidden: true });
  }

  /** Everything straight to its place (resize, start). */
  private snap(): void {
    this.cardW = this.card.offsetWidth;
    this.cardH = this.card.offsetHeight;
    this.measure();
    Object.assign(this.lit, this.litGoal);
    this.render();
  }

  private readonly frame = (t: number): void => {
    const dt = Math.min(0.1, (t - this.lastT) / 1000);
    this.lastT = t;
    this.measure();
    this.advance(t, dt);
    this.render();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** The lit area and the pointer's goal, from where the elements are now. */
  private measure(): void {
    const step = STEPS[this.index];
    const g = this.litGoal;
    this.panelEl ??= document.querySelector('[data-guide="panel"]');
    this.panelLeft = this.host.isPanelOpen() && this.panelEl ? this.panelEl.getBoundingClientRect().left : Infinity;
    if (!this.litEl) {
      // No place: a light shrunk to nothing in the middle (all dimmed), or none at all (drag).
      g.x = window.innerWidth / 2;
      g.y = window.innerHeight / 2;
      g.w = 0;
      g.h = 0;
      return;
    }
    // getBoundingClientRect returns a fresh DOMRect; only while the tour is open, so acceptable.
    const a = this.litEl.getBoundingClientRect();
    // Hidden for a moment (a panel in its transition): keep the last goal.
    if (a.width === 0 && a.height === 0) return;
    let x0 = a.left;
    let y0 = a.top;
    let x1 = a.right;
    let y1 = a.bottom;
    if (this.lightEl && step?.light) {
      const b = this.lightEl.getBoundingClientRect();
      if (b.width > 0) {
        x0 = Math.min(x0, b.left);
        y0 = Math.min(y0, b.top);
        x1 = Math.max(x1, b.right);
        y1 = Math.max(y1, Math.min(b.bottom, window.innerHeight - PAD));
      }
    }
    g.x = x0 - PAD;
    g.y = y0 - PAD;
    g.w = x1 - x0 + PAD * 2;
    g.h = y1 - y0 + PAD * 2;
  }

  /** Moves the pointer and the light toward their goals; the click and the drag demo. */
  private advance(t: number, dt: number): void {
    const step = STEPS[this.index];
    if (!step) return;
    const k = reducedMotion() ? 1 : 1 - Math.exp(-FOLLOW * dt);
    const lit = this.lit;
    const g = this.litGoal;
    lit.x += (g.x - lit.x) * k;
    lit.y += (g.y - lit.y) * k;
    lit.w += (g.w - lit.w) * k;
    lit.h += (g.h - lit.h) * k;

    let gx = window.innerWidth / 2;
    let gy = window.innerHeight / 2;
    if (step.drag) {
      const p = DRAG_PATH[this.dragIndex] ?? DRAG_PATH[0];
      if (p) {
        gx = p.x * window.innerWidth;
        gy = p.y * window.innerHeight;
        this.pointer.classList.toggle('down', p.down);
      }
    } else if (this.pointEl) {
      const r = this.pointEl.getBoundingClientRect();
      if (r.width > 0) {
        gx = r.left + r.width / 2;
        gy = r.top + r.height / 2;
      } else {
        // Gone (☰ once the panel opens): the pointer stays where it clicked.
        gx = this.px;
        gy = this.py;
      }
    }
    this.px += (gx - this.px) * k;
    this.py += (gy - this.py) * k;
    const there = Math.abs(gx - this.px) < 2 && Math.abs(gy - this.py) < 2;

    if (step.drag && there && !reducedMotion()) {
      if (this.dragWait === 0) this.dragWait = t + (DRAG_PATH[this.dragIndex]?.hold ?? 0);
      else if (t >= this.dragWait) {
        this.dragIndex = (this.dragIndex + 1) % DRAG_PATH.length;
        this.dragWait = 0;
      }
    }
    if (!this.clicked && there) {
      // Arrived: the ring shows, then the click takes effect.
      if (this.clickDue === 0) {
        this.clickDue = t + CLICK_MS;
        this.pointer.classList.add('clicking');
      } else if (t >= this.clickDue) {
        this.clicked = true;
        if (step.click) this.apply(step.click);
        if (step.after) this.litEl = document.querySelector(`[data-guide="${step.after}"]`) ?? this.litEl;
        window.setTimeout(() => this.pointer.classList.remove('clicking'), 400);
      }
    }
  }

  private render(): void {
    const step = STEPS[this.index];
    const lit = this.lit;
    const s = this.light.style;
    s.transform = `translate(${lit.x}px, ${lit.y}px)`;
    s.width = `${Math.max(0, lit.w)}px`;
    s.height = `${Math.max(0, lit.h)}px`;
    this.pointer.style.transform = `translate(${this.px}px, ${this.py}px)`;
    this.pointer.classList.toggle('gone', !this.pointEl && !step?.drag);
    this.placeCard(step);
  }

  /** The card beside the lit area: left of it (the panel is on the right), else below or above; in the middle without a place. */
  private placeCard(step: Step | undefined): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = this.cardW;
    const ch = this.cardH;
    let x: number;
    let y: number;
    const g = this.litGoal;
    if (step?.drag) {
      x = (vw - cw) / 2;
      y = vh - ch - 24;
    } else if (!this.pointEl) {
      x = (vw - cw) / 2;
      y = (vh - ch) / 2;
    } else if (Math.min(g.x, this.panelLeft) - GAP - cw >= 8) {
      x = Math.min(g.x, this.panelLeft) - GAP - cw;
      y = g.y;
    } else if (g.y + g.h + GAP + ch <= vh - 8) {
      x = g.x + g.w - cw;
      y = g.y + g.h + GAP;
    } else {
      x = g.x + g.w - cw;
      y = g.y - GAP - ch;
    }
    x = Math.min(Math.max(8, x), vw - cw - 8);
    y = Math.min(Math.max(8, y), vh - ch - 8);
    this.card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}

let motionQuery: MediaQueryList | null = null;

function reducedMotion(): boolean {
  motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  return motionQuery.matches;
}

/** An arrow pointer (tip at 0,0), and the ring a click shows. */
const POINTER_SVG =
  '<span class="guide-ring"></span><svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l16 9.5-7 1.6L8.6 20z" fill="#fff" stroke="#123" stroke-width="1.6" stroke-linejoin="round"/></svg>';
