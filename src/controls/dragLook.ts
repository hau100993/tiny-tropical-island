/** A left press must travel this far (px) to turn the view: less is a click. */
const DRAG_PX = 4;
/** Moving with the cursor in this band at the left or right edge (fraction of the width): it keeps turning. */
const EDGE = 0.06;
/** Turn rate (rad/s) with the cursor right at the edge; it grows from 0 across the band. */
const EDGE_SPEED = 2.1;

/**
 * Mouse look for walking, paddling and surfing, without capturing the mouse (the browser shows
 * its "press Esc" notice every time it does).
 *
 * - Moving (a movement key held; `update`): plain mouse moves steer, no button needed, as in a
 *   game; the cursor hides meanwhile. The cursor can't go past the screen's edge, where moves
 *   stop being reported, so with it in a band at the left or right edge the view keeps turning
 *   that way, faster nearer the edge. Over the menu or a card (not over the scene) it doesn't steer.
 * - Standing still: the cursor shows again; a left drag on the scene turns the view, as in the
 *   overview; clicks pet Mochi, splash the water, work the menu.
 */
export class DragLook {
  private active = false;
  private moving = false;
  private pressed = false;
  private travel = 0;
  /** The pointer was last over the scene (not the menu, a card or outside it at the top). */
  private overScene = false;
  /** Its last position across the scene, 0 (left) … 1 (right). */
  private across = 0.5;
  private steering = false;

  constructor(
    dom: HTMLElement,
    private readonly look: (dx: number, dy: number) => void,
    /** The owner's look rate (rad per px): edge turning is in rad/s. */
    private readonly radPerPx: number,
  ) {
    // A press on Mochi never gets here (PetPointer takes it first).
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;
      this.pressed = true;
      this.travel = 0;
    });
    window.addEventListener('pointermove', (e) => {
      // Back over the scene from the menu or a card: that move's distance was travelled over
      // them, it isn't steering.
      const back = e.target === dom && !this.overScene;
      this.overScene = e.target === dom;
      if (this.overScene) {
        const r = dom.getBoundingClientRect();
        this.across = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5;
      }
      if (!this.active) return;
      if (this.pressed) {
        if ((e.buttons & 1) === 0) {
          this.pressed = false;
          return;
        }
        this.travel += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (this.travel >= DRAG_PX) look(e.movementX, e.movementY);
      } else if (this.moving && this.overScene && !back) {
        // (Chrome sometimes reports a huge jump, e.g. after the window got the focus back.)
        if (Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) look(e.movementX, e.movementY);
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.pressed = false;
    });
  }

  /** Entering the activity. */
  start(): void {
    this.active = true;
    this.pressed = false;
    this.moving = false;
    this.setSteering(false);
  }

  /** Leaving it. */
  stop(): void {
    this.active = false;
    this.pressed = false;
    this.moving = false;
    this.setSteering(false);
  }

  /** Every frame: `moving` while a movement key is held (the mouse then steers). */
  update(dt: number, moving: boolean): void {
    if (!this.active) return;
    this.moving = moving;
    const steer = moving && this.overScene && !this.pressed;
    this.setSteering(steer);
    if (!steer) return;
    // At the edge: keep turning toward it.
    const left = (EDGE - this.across) / EDGE;
    const right = (this.across - (1 - EDGE)) / EDGE;
    const edge = Math.min(1, Math.max(0, right)) - Math.min(1, Math.max(0, left));
    if (edge !== 0) this.look((edge * EDGE_SPEED * dt) / this.radPerPx, 0);
  }

  /** The cursor hides over the scene while steering (styles: body.steering). */
  private setSteering(on: boolean): void {
    if (on === this.steering) return;
    this.steering = on;
    document.body.classList.toggle('steering', on);
  }
}
