/** A left press must travel this far (px) to turn the view: less is a click. */
const DRAG_PX = 4;
/**
 * Pushing the cursor into this band at the left or right edge (fraction of the width) turns on a
 * little further that way, for PUSH_HOLD s after the last push only: a cursor left lying at the
 * edge no longer spins you round (it did, 2026-10-25).
 */
const EDGE = 0.035;
const PUSH_HOLD = 0.3;
/** Turn rate (rad/s) at the very edge; it grows from 0 across the band. */
const EDGE_SPEED = 1.3;
/** Steering moves are smoothed over about this long (s): a jerk of the hand isn't a jerk of the view. */
const SMOOTH = 0.05;

/**
 * Mouse look for walking, paddling and surfing, without capturing the mouse (the browser shows
 * its "press Esc" notice every time it does).
 *
 * - Moving (a movement key held; `update`): plain mouse moves steer, no button needed, as in a
 *   game, scaled by `sensitivity` and smoothed; the cursor hides meanwhile. The cursor can't go
 *   past the screen's edge, where moves stop being reported, so pushing it into a narrow band at
 *   the left or right edge turns a little further that way (only right after a push). Over the
 *   menu or a card (not over the scene) it doesn't steer.
 * - Standing still: the cursor shows again; a left drag on the scene turns the view, as in the
 *   overview; clicks pet Mochi, splash the water, work the menu.
 */
export class DragLook {
  /** The mouse speed setting, for every DragLook (a factor on the owner's rad per px). */
  static sensitivity = 0.6;
  private active = false;
  private moving = false;
  private pressed = false;
  private travel = 0;
  /** The pointer was last over the scene (not the menu, a card or outside it at the top). */
  private overScene = false;
  /** Its last position across the scene, 0 (left) … 1 (right). */
  private across = 0.5;
  private steering = false;
  /** Seconds since the last move into the edge band toward the edge, and which (+1 right, −1 left). */
  private pushAge = Infinity;
  private pushDir = 0;
  /** Steering movement (px, scaled) not yet applied: see SMOOTH. */
  private pendX = 0;
  private pendY = 0;

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
        const k = DragLook.sensitivity;
        if (this.travel >= DRAG_PX) look(e.movementX * k, e.movementY * k);
      } else if (this.moving && this.overScene && !back) {
        // (Chrome sometimes reports a huge jump, e.g. after the window got the focus back.)
        if (Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) {
          this.pendX += e.movementX * DragLook.sensitivity;
          this.pendY += e.movementY * DragLook.sensitivity;
          const dir = this.across > 1 - EDGE ? 1 : this.across < EDGE ? -1 : 0;
          if (dir !== 0 && Math.sign(e.movementX) === dir) {
            this.pushDir = dir;
            this.pushAge = 0;
          } else if (dir === 0 || Math.sign(e.movementX) === -dir) this.pushAge = Infinity;
        }
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
    this.reset();
    this.setSteering(false);
  }

  /** Leaving it. */
  stop(): void {
    this.active = false;
    this.pressed = false;
    this.moving = false;
    this.reset();
    this.setSteering(false);
  }

  private reset(): void {
    this.pendX = 0;
    this.pendY = 0;
    this.pushAge = Infinity;
  }

  /** Every frame: `moving` while a movement key is held (the mouse then steers). */
  update(dt: number, moving: boolean): void {
    if (!this.active) return;
    this.moving = moving;
    const steer = moving && this.overScene && !this.pressed;
    this.setSteering(steer);
    if (!steer) {
      this.reset();
      return;
    }
    // The smoothed share of the moves (a first-order low-pass, like an RC filter).
    const a = 1 - Math.exp(-dt / SMOOTH);
    const dx = this.pendX * a;
    const dy = this.pendY * a;
    this.pendX -= dx;
    this.pendY -= dy;
    // Just pushed into the edge band: a little more turn toward it, faster nearer the edge.
    this.pushAge += dt;
    let edge = 0;
    if (this.pushAge < PUSH_HOLD) {
      const depth = this.pushDir > 0 ? (this.across - (1 - EDGE)) / EDGE : (EDGE - this.across) / EDGE;
      edge = this.pushDir * Math.min(1, Math.max(0, depth));
    }
    const ex = edge !== 0 ? (edge * EDGE_SPEED * dt) / this.radPerPx : 0;
    if (dx !== 0 || dy !== 0 || ex !== 0) this.look(dx + ex, dy);
  }

  /** The cursor hides over the scene while steering (styles: body.steering). */
  private setSteering(on: boolean): void {
    if (on === this.steering) return;
    this.steering = on;
    document.body.classList.toggle('steering', on);
  }
}
