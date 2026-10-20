import type { TimeSpeed } from '../world/celestial';

/** The speeds the panel's speed button steps through (×30 stays valid in old settings). */
export const SPEED_CYCLE: readonly TimeSpeed[] = [1, 10, 60, 240];

/**
 * One speed up (`dir` 1) or down from `current`; `wrap` goes round (click), otherwise it stops at
 * the ends (mouse wheel). A speed outside the cycle (×30) steps to its neighbours (×60 / ×10).
 */
export function nextSpeed(current: TimeSpeed, dir: 1 | -1, wrap: boolean): TimeSpeed {
  const n = SPEED_CYCLE.length;
  // First cycle speed at or above `current`.
  let i = SPEED_CYCLE.findIndex((v) => v >= current);
  if (i < 0) i = n - 1;
  const exact = SPEED_CYCLE[i] === current;
  let j = dir > 0 ? (exact ? i + 1 : i) : i - 1;
  j = wrap ? (j + n) % n : Math.min(n - 1, Math.max(0, j));
  return SPEED_CYCLE[j];
}
