import { clamp } from './math';

/** Step length (m) at full walking speed; the avatar's walk cycle covers exactly this per step. */
export const WALK_STEP = 0.52;
/** Step length (m) at full running speed (the avatar's run cycle). */
export const RUN_STEP = 0.8;
/** Below this speed (m/s) a run is still a walk, for the steps and the avatar alike. */
export const RUN_GAIT_MIN = 2;
/**
 * People take shorter steps when they go slower, and fewer of them: step length grows about as
 * speed^0.6, so cadence (steps per second) grows as speed^0.4.
 */
const STEP_EXP = 0.6;

/**
 * Step length (m) at `speed`, where `topSpeed` is the full speed of the current gait. The walker
 * counts footfalls with it and the avatar scales its stride to it, so a planted foot stays
 * exactly where it landed at any speed.
 */
export function stepLength(speed: number, topSpeed: number, running: boolean): number {
  const full = running ? RUN_STEP : WALK_STEP;
  return full * Math.pow(clamp(speed / topSpeed, 0, 1), STEP_EXP);
}
