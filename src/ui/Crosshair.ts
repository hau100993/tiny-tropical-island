import { el } from './components';

/**
 * Săn Bong Bóng's aim mark at the screen centre: shown while the mouse steers the manta (the
 * cursor is hidden then), lit while it points at a bubble. Part of the UI layer (H hides it).
 */
export class Crosshair {
  private readonly root: HTMLElement;
  private shown = false;
  private lit = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'crosshair');
    this.root.setAttribute('aria-hidden', 'true');
    parent.append(this.root);
  }

  set(shown: boolean, lit: boolean): void {
    if (shown !== this.shown) {
      this.shown = shown;
      this.root.classList.toggle('shown', shown);
    }
    if (lit !== this.lit) {
      this.lit = lit;
      this.root.classList.toggle('on', lit);
    }
  }
}
