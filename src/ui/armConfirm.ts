/**
 * Two-step buttons (delete, reset): the first click arms the button, a second click confirms.
 * A double-click delivers both clicks within a few hundred milliseconds, which would skip the
 * confirmation; a second click that comes this soon after arming is ignored.
 */
export const ARM_GUARD_MS = 500;

/** True when a click at `now` (ms) confirms a button armed at `armedAt` (ms, 0 = not armed). */
export function isConfirmClick(armedAt: number, now: number): boolean {
  return armedAt > 0 && now - armedAt >= ARM_GUARD_MS;
}
