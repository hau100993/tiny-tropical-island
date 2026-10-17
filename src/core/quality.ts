export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

/**
 * Everything a quality preset controls (see PLAN.md §5). Later phases add particle counts etc.
 */
export interface QualityProfile {
  pixelRatioCap: number;
  /** 0 disables shadows entirely. */
  shadowMapSize: number;
  /** MSAA is chosen when the WebGL context is created, so a change applies after reload. */
  msaa: boolean;
  /** Water simulation grid cells per side (the sim covers a fixed 200 m square). */
  waterSimRes: number;
  /** Screen-space refraction (extra half-resolution scene pass). Off = alpha-blended water. */
  refraction: boolean;
  /** Caustics texture size; 0 disables caustics. */
  causticsRes: number;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatioCap: 1.0, shadowMapSize: 0, msaa: false, waterSimRes: 128, refraction: false, causticsRes: 0 },
  medium: { pixelRatioCap: 1.25, shadowMapSize: 1024, msaa: true, waterSimRes: 256, refraction: true, causticsRes: 384 },
  high: { pixelRatioCap: 1.5, shadowMapSize: 2048, msaa: true, waterSimRes: 512, refraction: true, causticsRes: 512 },
};

/** Low-power mode clamps the chosen preset down to Low-level costs. */
export function effectiveProfile(level: QualityLevel, lowPower: boolean): QualityProfile {
  const base = QUALITY_PROFILES[level];
  if (!lowPower) return base;
  return { ...base, ...QUALITY_PROFILES.low, msaa: base.msaa };
}

export const NORMAL_FPS = 60;
export const LOW_POWER_FPS = 30;
