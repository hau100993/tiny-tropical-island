import * as THREE from 'three';

/**
 * Fire that glows at night and keeps its colour by day. Plain additive blending (colour added to
 * what is behind) glows on a dark night but washes out to white over bright sand and sky. With
 * premultiplied alpha (src·1 + dst·(1 − srcAlpha)) one shader output does both: `glow` 1 leaves
 * the background untouched (pure addition), 0 covers it like paint. Night → glow, day → paint.
 */
export const FIRE_BLENDING = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

/** `fireBlend(colour, alpha, uDayLight)` → the fragment colour for FIRE_BLENDING. */
export const FIRE_BLEND_GLSL = /* glsl */ `
vec4 fireBlend(vec3 col, float a, float dayLight) {
  float glow = 1.0 - 0.75 * dayLight;
  return vec4(col * a, a * (1.0 - glow));
}
`;
