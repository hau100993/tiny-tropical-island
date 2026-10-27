/**
 * The on-screen controls' state (ui/TouchControls.ts), read by walking, the kayak and the
 * surfboard next to their keys. Written by the UI, read every frame; nothing is allocated.
 */
export const touchInput = {
  /** Joystick: x to the right, y forward, each −1 … 1 (length ≤ 1, 0 inside the dead zone). */
  x: 0,
  y: 0,
  /** The rise/dive button held (Space while swimming and diving). */
  jump: false,
};

/** Pushed this far (of the joystick's reach) you run, crawl, sprint or carve hard (Shift). */
export const RUN_PUSH = 0.9;

/** Where to go this frame, from the keys or the joystick. */
export interface MoveInput {
  /** Forward (+) / back (−) and right (+) / left (−); a direction, not normalized. */
  fwd: number;
  side: number;
  /** How hard: 1 with keys, 0 … 1 with the joystick (full at RUN_PUSH). */
  amount: number;
  /** Shift held, or the joystick pushed past RUN_PUSH. */
  run: boolean;
}

/** Keys and joystick together: a held movement key wins over the joystick. */
export function readMove(keys: ReadonlySet<string>, out: MoveInput): MoveInput {
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (fwd !== 0 || side !== 0) {
    out.fwd = fwd;
    out.side = side;
    out.amount = 1;
    out.run = shift;
    return out;
  }
  const push = Math.hypot(touchInput.x, touchInput.y);
  out.fwd = touchInput.y;
  out.side = touchInput.x;
  out.amount = Math.min(1, push / RUN_PUSH);
  out.run = shift || push >= RUN_PUSH;
  return out;
}

/** Creates a MoveInput to reuse every frame. */
export function moveInput(): MoveInput {
  return { fwd: 0, side: 0, amount: 0, run: false };
}
