/** A left press must travel this far (px) to turn the view: less is a click. */
const DRAG_PX = 4;
/** With the cursor in this band at the left or right edge (fraction of the width) the view keeps turning. */
const EDGE = 0.06;
/**
 * Turn rate (rad/s) at the very edge at full sensitivity (× `sensitivity`: 1.2 rad/s, ~70°/s, by
 * default); it grows from 0 across the band. It was 2.1 rad/s whatever the setting, which spun
 * you round (2026-10-25).
 */
const EDGE_SPEED = 2;
/** Reaching the band, the turn builds up over this long (s): brushing the edge barely turns. */
const EDGE_RAMP = 0.3;

/**
 * Mouse look for walking, paddling and surfing, without capturing the mouse (the browser shows
 * its "press Esc" notice every time it does).
 *
 * - Moving (a movement key held; `update`): plain mouse moves steer, no button needed, as in a
 *   game, scaled by `sensitivity`; the cursor hides meanwhile. The cursor can't go past the
 *   screen's edge, where moves stop being reported, so with it in a band at the left or right
 *   edge the view keeps turning that way, faster nearer the edge (building up over a moment).
 *   Over the menu or a card (not over the scene) it doesn't steer.
 * - Standing still: the cursor shows again; a left drag on the scene turns the view, as in the
 *   overview; clicks pet Mochi, splash the water, work the menu.
 * - Touch: a finger dragged on the scene turns the view. Its moves are measured from its
 *   positions: `movementX/Y` of touch pointers is 0 in some browsers (Safari).
 */
export class DragLook {
  /** The mouse speed setting, for every DragLook (a factor on the owner's rad per px). */
  static sensitivity = 0.6;
  private active = false;
  private moving = false;
  private pressed = false;
  private travel = 0;
  /** The press that turns the view (a second finger doesn't), and its last position. */
  private pointerId = -1;
  private lastX = 0;
  private lastY = 0;
  /** The pointer was last over the scene (not the menu, a card or outside it at the top). */
  private overScene = false;
  /** Its last position across the scene, 0 (left) … 1 (right). */
  private across = 0.5;
  private steering = false;
  /** How long the cursor has been in the edge band while steering (s; see EDGE_RAMP). */
  private edgeTime = 0;

  constructor(
    dom: HTMLElement,
    private readonly look: (dx: number, dy: number) => void,
    /** The owner's look rate (rad per px): edge turning is in rad/s. */
    private readonly radPerPx: number,
  ) {
    // A press on Mochi never gets here (PetPointer takes it first).
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0 || this.pressed) return;
      this.pressed = true;
      this.travel = 0;
      this.pointerId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
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
        if (e.pointerId !== this.pointerId) return;
        if ((e.buttons & 1) === 0) {
          this.pressed = false;
          return;
        }
        const touch = e.pointerType === 'touch';
        const dx = touch ? e.clientX - this.lastX : e.movementX;
        const dy = touch ? e.clientY - this.lastY : e.movementY;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.travel += Math.abs(dx) + Math.abs(dy);
        const k = DragLook.sensitivity;
        if (this.travel >= DRAG_PX) look(dx * k, dy * k);
      } else if (this.moving && this.overScene && !back) {
        // (Chrome sometimes reports a huge jump, e.g. after the window got the focus back.)
        if (Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) {
          const k = DragLook.sensitivity;
          look(e.movementX * k, e.movementY * k);
        }
      }
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0 && e.pointerId === this.pointerId) this.pressed = false;
    });
    window.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.pointerId) this.pressed = false;
    });
  }

  /** Entering the activity. */
  start(): void {
    this.active = true;
    this.pressed = false;
    this.moving = false;
    this.edgeTime = 0;
    this.setSteering(false);
  }

  /** Leaving it. */
  stop(): void {
    this.active = false;
    this.pressed = false;
    this.moving = false;
    this.edgeTime = 0;
    this.setSteering(false);
  }

  /** Every frame: `moving` while a movement key is held (the mouse then steers). */
  update(dt: number, moving: boolean): void {
    if (!this.active) return;
    this.moving = moving;
    const steer = moving && this.overScene && !this.pressed;
    this.setSteering(steer);
    // At the edge: keep turning toward it, faster nearer the edge, building up over EDGE_RAMP.
    const left = (EDGE - this.across) / EDGE;
    const right = (this.across - (1 - EDGE)) / EDGE;
    const edge = steer ? Math.min(1, Math.max(0, right)) - Math.min(1, Math.max(0, left)) : 0;
    this.edgeTime = edge !== 0 ? this.edgeTime + dt : 0;
    if (edge === 0) return;
    const ramp = Math.min(1, this.edgeTime / EDGE_RAMP);
    const rate = EDGE_SPEED * DragLook.sensitivity * ramp * ramp * (3 - 2 * ramp);
    // (In the owner's px: its look callback scales by its rad per px.)
    this.look((edge * rate * dt) / this.radPerPx, 0);
  }

  /** The cursor hides over the scene while steering (styles: body.steering). */
  private setSteering(on: boolean): void {
    if (on === this.steering) return;
    this.steering = on;
    document.body.classList.toggle('steering', on);
  }
}
