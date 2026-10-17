/**
 * Gusts as a deterministic function of time. Because gust(t) can be evaluated for any t,
 * the renderer reads it for "now" each frame while the audio layer schedules it seconds
 * ahead — and both agree, so the gust you hear is the gust you see.
 */

/** Smooth 1D value noise in [0, 1]. */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number): number => {
    const s = Math.sin((n + seed * 101.3) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

/**
 * Gust envelope in [0.2, 1] at wall-clock time t (seconds): slow swells of a few seconds
 * with quicker flurries on top. Multiply by wind strength to get the actual gust.
 */
export function gustShape(t: number): number {
  const slow = noise1(t * 0.09, 1);
  const mid = noise1(t * 0.23, 2);
  const fast = noise1(t * 0.7, 3);
  const g = slow * 0.55 + mid * 0.3 + fast * 0.15;
  // Stretch contrast so calm moments and strong gusts both happen.
  const s = Math.min(1, Math.max(0, (g - 0.25) / 0.5));
  return 0.2 + 0.8 * s * s * (3 - 2 * s);
}

/** Wall-clock seconds; shared time base between rendering and audio scheduling. */
export function wallSeconds(): number {
  return performance.now() / 1000;
}
