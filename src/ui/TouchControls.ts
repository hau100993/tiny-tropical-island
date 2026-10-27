import { el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { touchInput } from '../controls/touchInput';

/** The joystick's reach (px): the knob goes this far from where the thumb landed. */
const REACH = 52;
/** Pushed less than this (of the reach) counts as not pushed (a resting thumb drifts). */
const DEAD = 0.12;

/**
 * Keeps a finger's moves and release with `target` even when it slides off. Throws if the
 * pointer is already gone (lifted in the same instant): then it simply isn't captured.
 */
function capture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Released already: its pointerup comes (or came) to the element anyway.
  }
}

/** One round button on the right. */
export interface TouchButton {
  label: string;
  icon: keyof typeof icons;
  /** Pressed: a tap, or the start of a hold. */
  down?: () => void;
  /** Let go (also when the layout changes under the finger). */
  up?: () => void;
  /** The main action: a bigger button. */
  main?: boolean;
}

/** What one moment needs on screen. Keep the objects: `set` compares by identity. */
export interface TouchLayout {
  /** The joystick (left half of the screen). */
  stick: boolean;
  buttons: readonly TouchButton[];
  /** The small corner button: get up, leave the kayak or the board. None: no button. */
  exit?: () => void;
}

/**
 * On-screen controls for touch screens (Phase 11b/c): a floating joystick on the left half (it
 * appears where the thumb lands; pushed all the way you run), round buttons on the right only
 * where a press is the game (dive, rise, catch the wave), and a small "leave" button in the top
 * corner. Writes `touchInput`; buttons call their own actions. Shown only with `body.touch`
 * (styles). The right half of the scene stays free for looking around (drag), zooming (pinch)
 * and tapping the animals (their skills).
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons: HTMLElement;
  private readonly exit: HTMLButtonElement;
  private layout: TouchLayout | null = null;
  /** The finger on the joystick, and where it landed. */
  private stickId = -1;
  private ox = 0;
  private oy = 0;
  /** Buttons held right now: let go of when the layout changes. */
  private readonly held = new Set<TouchButton>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'touch-controls');
    this.zone = el('div', 'stick-zone');
    this.base = el('div', 'stick-base');
    this.knob = el('div', 'stick-knob');
    this.base.append(this.knob);
    this.zone.append(this.base);
    this.buttons = el('div', 'touch-buttons');
    this.exit = el('button', 'touch-exit');
    this.exit.type = 'button';
    this.exit.tabIndex = -1;
    this.exit.setAttribute('aria-label', vi.touch.exit);
    this.exit.innerHTML = icons.exit;
    // A tap (click), not a press: brushing it while looking around shouldn't leave.
    this.exit.addEventListener('click', () => this.layout?.exit?.());
    this.root.append(this.zone, this.buttons, this.exit);
    parent.append(this.root);

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== -1) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      capture(this.zone, e.pointerId);
      this.ox = e.clientX;
      this.oy = e.clientY;
      // The ring comes to the thumb.
      const r = this.zone.getBoundingClientRect();
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('active');
    });
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      this.moveKnob(e.clientX - this.ox, e.clientY - this.oy);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.stickId) this.releaseStick();
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.zone.addEventListener('lostpointercapture', end);
    // Back from another app: nothing is held any more.
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** What to show now; null hides it all. Cheap to call every frame. */
  set(layout: TouchLayout | null): void {
    if (layout === this.layout) return;
    this.layout = layout;
    this.releaseAll();
    this.root.classList.toggle('on', layout !== null);
    if (!layout) return;
    this.zone.hidden = !layout.stick;
    this.exit.hidden = !layout.exit;
    this.buttons.replaceChildren(...layout.buttons.map((b) => this.makeButton(b, b.main ? 'touch-btn main' : 'touch-btn')));
  }

  private moveKnob(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    const k = len > REACH ? REACH / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const push = Math.min(1, len / REACH);
    const out = push < DEAD ? 0 : (push - DEAD) / (1 - DEAD);
    // Screen y grows downward; forward is up.
    touchInput.x = len > 0 ? (dx / len) * out : 0;
    touchInput.y = len > 0 ? (-dy / len) * out : 0;
  }

  private releaseStick(): void {
    this.stickId = -1;
    touchInput.x = 0;
    touchInput.y = 0;
    this.knob.style.transform = '';
    // Back to its resting place (styles).
    this.base.style.removeProperty('left');
    this.base.style.removeProperty('top');
    this.base.classList.remove('active');
  }

  private releaseAll(): void {
    if (this.stickId !== -1) this.releaseStick();
    for (const b of this.held) b.up?.();
    this.held.clear();
    for (const e of this.root.querySelectorAll('.touch-btn.held')) e.classList.remove('held');
  }

  private makeButton(b: TouchButton, className: string): HTMLButtonElement {
    const btn = el('button', className);
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.setAttribute('aria-label', b.label);
    const icon = el('span', 'touch-icon');
    icon.innerHTML = icons[b.icon];
    btn.append(icon, el('span', 'touch-label', b.label));
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(btn, e.pointerId);
      btn.classList.add('held');
      this.held.add(b);
      b.down?.();
    });
    const up = (): void => {
      if (!this.held.delete(b)) return;
      btn.classList.remove('held');
      b.up?.();
    };
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    return btn;
  }
}
