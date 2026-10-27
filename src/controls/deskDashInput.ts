import * as THREE from 'three';
import { DASH_PX, type DeskDash, type DashHit } from '../world/deskDash';
import { MAX_TEXT } from '../ui/todo';
import { vi } from '../ui/strings.vi';

/** A press only counts as a click below this movement (px); more starts a drag (cards) or nothing. */
const CLICK_PX = 5;
/** Two clicks on the same card within this time (ms): edit its text. */
const DOUBLE_MS = 400;

interface Press {
  hit: DashHit;
  x: number;
  y: number;
  pointerId: number;
  moved: boolean;
}

/**
 * Mouse and keyboard for the right desk monitor, while seated at the desk. A ray from the camera
 * through the cursor hits the screen mesh; its UV (0..1 across the screen) times the canvas size
 * gives the canvas pixel, which DeskDash turns into a card, a ring or a button.
 * Listeners run in the capture phase on the canvas, so a press on the screen's controls is taken
 * before the desk view starts turning the head (it stops the event there). Typing goes into a
 * hidden <input>, which is what lets Vietnamese input methods (Unikey, Telex) work; DeskDash draws
 * its text and caret. The same input edits a task after a double click on its card: Enter or
 * leaving the field saves, Esc drops the change.
 */
export class DeskDashInput {
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly hits: THREE.Intersection[] = [];
  private readonly input: HTMLInputElement;
  private active = false;
  private press: Press | null = null;
  private hoverKey = '';
  /** The task being edited (null: the input adds new tasks). */
  private editId: string | null = null;
  /** Esc while editing: leave without saving. */
  private discard = false;
  /** The last click on a card, to spot a double click. */
  private lastCard = { id: '', at: 0 };

  constructor(
    private readonly dom: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly mesh: THREE.Mesh,
    private readonly dash: DeskDash,
    parent: HTMLElement,
  ) {
    this.input = document.createElement('input');
    this.input.className = 'dash-input';
    this.input.type = 'text';
    this.input.maxLength = MAX_TEXT;
    this.input.autocomplete = 'off';
    this.input.setAttribute('aria-label', vi.dash.inputLabel);
    parent.append(this.input);
    const sync = (): void => {
      const editing = document.activeElement === this.input;
      this.dash.setDraft(this.input.value, this.input.selectionStart ?? this.input.value.length, editing);
    };
    this.input.addEventListener('input', sync);
    this.input.addEventListener('focus', sync);
    this.input.addEventListener('blur', () => {
      // Leaving an edited task saves it (unless Esc), and the input goes back to adding tasks.
      if (this.editId !== null) {
        if (!this.discard) this.dash.renameTask(this.editId, this.input.value);
        this.editId = null;
        this.discard = false;
        this.input.value = '';
        this.dash.beginEdit(null);
      }
      sync();
    });
    this.input.addEventListener('keyup', sync);
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.input) sync();
    });
    this.input.addEventListener('keydown', (e) => {
      // Enter while an input method is still composing a word only ends the word.
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (this.editId !== null) {
          this.input.blur();
          return;
        }
        this.dash.submit(this.input.value);
        this.input.value = '';
        sync();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.discard = true;
        this.input.value = '';
        this.input.blur();
      }
    });

    const capture = { capture: true } as const;
    dom.addEventListener('pointerdown', this.onDown, capture);
    dom.addEventListener('pointermove', this.onMove, capture);
    dom.addEventListener('pointerup', this.onUp, capture);
    dom.addEventListener('pointercancel', this.onCancel, capture);
    dom.addEventListener('pointerleave', () => this.setHover(null));
    dom.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
  }

  /** Seated at the desk or not. Getting up ends typing and dragging. */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) {
      this.input.blur();
      this.onCancel();
      this.setHover(null);
    }
  }

  /** The canvas pixel under the cursor, or null off the screen. */
  private pick(e: PointerEvent | WheelEvent): { x: number; y: number } | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    this.hits.length = 0;
    this.mesh.raycast(this.ray, this.hits);
    const uv = this.hits[0]?.uv;
    return uv ? { x: uv.x * DASH_PX.w, y: (1 - uv.y) * DASH_PX.h } : null;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.active || e.button !== 0) return;
    const p = this.pick(e);
    const hit = p ? this.dash.hitAt(p.x, p.y) : null;
    if (!hit) return;
    // Ours: the desk view doesn't turn the head, and the press doesn't move the focus.
    e.stopImmediatePropagation();
    e.preventDefault();
    const onEdited = hit.kind === 'card' && hit.id === this.editId;
    if (hit.kind !== 'input' && !onEdited) this.input.blur();
    this.press = { hit, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false };
    this.dom.setPointerCapture(e.pointerId);
    // A slider follows the press at once, and then the drag.
    if (hit.kind === 'slider' && p) this.dash.slide(hit.id, p.x);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.active) return;
    const press = this.press;
    if (!press) {
      const p = this.pick(e);
      this.setHover(p ? this.dash.hitAt(p.x, p.y) : null);
      return;
    }
    e.stopImmediatePropagation();
    const h = press.hit;
    if (h.kind === 'slider') {
      const p = this.pick(e);
      if (p) this.dash.slide(h.id, p.x);
      return;
    }
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_PX) {
      press.moved = true;
      if ((h.kind === 'card' || h.kind === 'ring') && !this.dash.dragging) {
        const p = this.pick(e);
        if (p) this.dash.beginDrag(h.id, p.x, p.y);
        this.dom.style.cursor = 'grabbing';
      }
    }
    if (this.dash.dragging) {
      const p = this.pick(e);
      if (p) this.dash.dragTo(p.x, p.y);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const press = this.press;
    if (!press) return;
    e.stopImmediatePropagation();
    this.press = null;
    if (this.dom.hasPointerCapture(press.pointerId)) this.dom.releasePointerCapture(press.pointerId);
    if (this.dash.dragging) {
      this.dash.endDrag();
      this.dom.style.cursor = '';
      this.hoverKey = '';
      return;
    }
    if (press.moved) return;
    const hit = press.hit;
    if (hit.kind === 'input') {
      // From editing a task straight to adding one: save the edit first.
      if (this.editId !== null) this.input.blur();
      this.input.focus();
    } else if (hit.kind === 'card') this.cardClick(hit.id);
    else this.dash.activate(hit);
  };

  /** A second click on the same card soon after the first: edit its text in place. */
  private cardClick(id: string): void {
    const now = performance.now();
    const double = this.lastCard.id === id && now - this.lastCard.at < DOUBLE_MS;
    this.lastCard = double ? { id: '', at: 0 } : { id, at: now };
    if (!double || this.editId === id) return;
    const text = this.dash.beginEdit(id);
    if (text === null) return;
    this.editId = id;
    this.input.value = text;
    this.input.focus();
    this.input.setSelectionRange(text.length, text.length);
    this.dash.setDraft(text, text.length, true);
  }

  private readonly onCancel = (): void => {
    this.press = null;
    if (this.dash.dragging) this.dash.endDrag();
    this.dom.style.cursor = '';
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.active) return;
    const p = this.pick(e);
    if (!p) return;
    const hit = this.dash.hitAt(p.x, p.y);
    if (hit?.kind === 'slider') {
      // Over a volume slider the wheel turns it.
      e.preventDefault();
      e.stopImmediatePropagation();
      this.dash.nudge(hit.id, e.deltaY < 0 ? 1 : -1);
      return;
    }
    if (!this.dash.inList(p.x, p.y)) return;
    // Over a list the wheel scrolls it instead of leaning in.
    e.preventDefault();
    e.stopImmediatePropagation();
    this.dash.scrollBy(p.x, p.y, e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY);
  };

  private setHover(hit: DashHit | null): void {
    this.dash.setHover(hit);
    const key = hit ? hit.kind : '';
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.dom.style.cursor = hit ? (hit.kind === 'card' ? 'grab' : hit.kind === 'slider' ? 'ew-resize' : 'pointer') : '';
  }
}
