import * as THREE from 'three';
import type { ClickAim } from './waterClick';

export interface PetPointerHooks {
  /** Where the pointer aims now: the cursor (overview), the screen centre (walking), or nowhere. */
  aim(): ClickAim;
  /** Is the dog under this view ray? */
  hit(ray: THREE.Ray): boolean;
  /** Pressed on the dog. */
  onStart(): void;
  /** Mouse moved (px) while the press is held. */
  onMove(dx: number, dy: number): void;
  /** Let go (`cancelled`: stopped by the app, not by releasing the button). */
  onEnd(cancelled: boolean): void;
}

/**
 * Pointing at Mochi with the mouse and pressing on it (activities/petting.ts). Over the dog,
 * the press is taken before the orbit camera or a water click can see it; while it is held,
 * mouse moves are strokes (the walker keeps its view still, see Walker.lookFrozen).
 */
export class PetPointer {
  /** The dog is under the cursor (or the screen centre). */
  hover = false;
  /** A press on the dog is held. */
  active = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private clientX = 0;
  private clientY = 0;
  private seen = false;

  constructor(
    private readonly dom: HTMLElement,
    private readonly camera: THREE.Camera,
    private readonly hooks: PetPointerHooks,
  ) {
    dom.addEventListener('pointermove', (e) => {
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.seen = true;
      if (this.active) this.hooks.onMove(e.movementX, e.movementY);
    });
    dom.addEventListener('pointerleave', () => {
      this.seen = false;
    });
    // Capture phase: on the canvas itself these run before the orbit camera's listener.
    dom.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        this.clientX = e.clientX;
        this.clientY = e.clientY;
        this.seen = true;
        this.refresh();
        if (!this.hover) return;
        e.stopImmediatePropagation();
        this.active = true;
        this.hooks.onStart();
      },
      { capture: true },
    );
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.release(false);
    });
    window.addEventListener('blur', () => this.release(true));
  }

  /** Every frame: is the dog under the pointer? */
  update(): void {
    this.refresh();
  }

  /** Stops a held press (you walked off, the view changed). */
  cancel(): void {
    this.release(true);
  }

  private release(cancelled: boolean): void {
    if (!this.active) return;
    this.active = false;
    this.hooks.onEnd(cancelled);
  }

  private refresh(): void {
    const aim = this.hooks.aim();
    if (aim === 'none' || (aim === 'cursor' && !this.seen)) {
      this.hover = false;
      return;
    }
    if (aim === 'center') {
      this.ndc.set(0, 0);
    } else {
      const rect = this.dom.getBoundingClientRect();
      this.ndc.set(((this.clientX - rect.left) / rect.width) * 2 - 1, -((this.clientY - rect.top) / rect.height) * 2 + 1);
    }
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.hover = this.hooks.hit(this.raycaster.ray);
  }
}
