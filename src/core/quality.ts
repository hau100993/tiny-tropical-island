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
  /** Mirror image of palms/house/rocks in the water (extra half-resolution scene pass). */
  reflection: boolean;
  /** Caustics texture size; 0 disables caustics. */
  causticsRes: number;
  /** Grass blades drawn (of GRASS_MAX created at startup). */
  grassCount: number;
  /** Wildflower clumps drawn (of FLOWERS_MAX created at startup). */
  flowerCount: number;
  /** Maximum rain streaks / snowflakes at full intensity. */
  rainCount: number;
  snowCount: number;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    pixelRatioCap: 1.0, shadowMapSize: 0, msaa: false, waterSimRes: 128, refraction: false, reflection: false, causticsRes: 0,
    grassCount: 4000, flowerCount: 1500, rainCount: 3000, snowCount: 2000,
  },
  medium: {
    pixelRatioCap: 1.25, shadowMapSize: 1024, msaa: true, waterSimRes: 256, refraction: true, reflection: false, causticsRes: 384,
    grassCount: 15000, flowerCount: 5000, rainCount: 10000, snowCount: 6000,
  },
  high: {
    pixelRatioCap: 1.5, shadowMapSize: 2048, msaa: true, waterSimRes: 512, refraction: true, reflection: true, causticsRes: 512,
    grassCount: 40000, flowerCount: 10000, rainCount: 25000, snowCount: 15000,
  },
};

/** Grass blades generated once; presets draw a prefix of them. */
export const GRASS_MAX = 40000;

export const NORMAL_FPS = 60;
/** While a desk video plays: the scene behind it gets half the GPU time, so the video stays smooth. */
export const VIDEO_FPS = 30;
