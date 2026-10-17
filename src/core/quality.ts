export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

/**
 * Everything a quality preset controls. Phase 1a uses pixel ratio, shadows and MSAA;
 * later phases add water resolution, particle counts, etc. (see PLAN.md §5).
 */
export interface QualityProfile {
  pixelRatioCap: number;
  /** 0 disables shadows entirely. */
  shadowMapSize: number;
  /** MSAA is chosen when the WebGL context is created, so a change applies after reload. */
  msaa: boolean;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatioCap: 1.0, shadowMapSize: 0, msaa: false },
  medium: { pixelRatioCap: 1.25, shadowMapSize: 1024, msaa: true },
  high: { pixelRatioCap: 1.5, shadowMapSize: 2048, msaa: true },
};

/** Low-power mode clamps the chosen preset down to Low-level costs. */
export function effectiveProfile(level: QualityLevel, lowPower: boolean): QualityProfile {
  const base = QUALITY_PROFILES[level];
  if (!lowPower) return base;
  return { ...base, pixelRatioCap: 1.0, shadowMapSize: 0 };
}

export const NORMAL_FPS = 60;
export const LOW_POWER_FPS = 30;
