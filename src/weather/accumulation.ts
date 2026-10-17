/**
 * Weather rules as pure functions (unit-tested). Rain and snow blend instead of fighting:
 * both falling at once is sleet — fewer particles of each, snow only settles if it outweighs
 * the rain, and melting snow makes things wet.
 */

/** Seconds for full wetness under heavy rain, and to dry completely afterwards. */
export const WET_SECONDS = 30;
export const DRY_SECONDS = 120;
/** Seconds for full snow cover in heavy snow, and to melt it completely. */
export const SNOW_SECONDS = 90;
export const MELT_SECONDS = 180;

export interface Accumulation {
  wetness: number;
  snowCover: number;
}

/** Advances wetness and snow cover by dt seconds for rain/snow intensities in [0, 1]. */
export function stepAccumulation(prev: Accumulation, rain: number, snow: number, dt: number): Accumulation {
  let { wetness, snowCover } = prev;

  // Snow settles only when it dominates; otherwise it melts (faster when it rains).
  const settle = snow - rain;
  let melted = 0;
  if (settle > 0) {
    snowCover = Math.min(1, snowCover + (settle * dt) / SNOW_SECONDS);
  } else if (snowCover > 0) {
    const melt = Math.min(snowCover, ((1 + 2 * rain) * dt) / MELT_SECONDS);
    snowCover -= melt;
    melted = melt;
  }

  // Wetness heads toward the rain intensity: quickly up, slowly down. Meltwater adds to it.
  if (wetness < rain) wetness = Math.min(rain, wetness + dt / WET_SECONDS);
  else wetness = Math.max(rain, wetness - dt / DRY_SECONDS);
  wetness = Math.min(1, wetness + melted * 4);

  return { wetness, snowCover };
}

/** Particle amounts (fraction of the quality preset's maximum) for rain and snow. */
export function particleAmounts(rain: number, snow: number): { rain: number; snow: number } {
  return { rain: rain * (1 - 0.4 * snow), snow: snow * (1 - 0.4 * rain) };
}

/** How grey/dark the sky gets (0 clear … 1 heavy overcast). */
export function overcast(rain: number, snow: number, wind: number): number {
  return Math.min(1, Math.max(rain, snow * 0.8, wind * 0.35));
}
