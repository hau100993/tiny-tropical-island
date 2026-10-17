import * as THREE from 'three';

/**
 * Uniforms shared by many materials. Materials reference these exact objects, so writing
 * `sharedUniforms.uTime.value` once per frame updates every shader that uses it.
 */
export const sharedUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.55, 0.62, 0.42).normalize() },
  uSunColor: { value: new THREE.Color('#fff0d4') },
  uSkyTop: { value: new THREE.Color('#2f7fd6') },
  uSkyHorizon: { value: new THREE.Color('#bfe2f5') },
  uWaveStrength: { value: 0.45 },
  // Weather (Phase 3). All 0..1 unless noted.
  /** Wind strength from the slider (smoothed). */
  uWind: { value: 0 },
  /** Wind strength × current gust; what vegetation actually bends with. */
  uGust: { value: 0 },
  /** Horizontal wind direction (x, z), unit length. */
  uWindDir: { value: new THREE.Vector2(-0.8, -0.6) },
  uRain: { value: 0 },
  uSnow: { value: 0 },
  /** How wet surfaces are (rises with rain, dries slowly). */
  uWetness: { value: 0 },
  /** How much snow has settled (grows slowly while snowing, melts afterwards). */
  uSnowCover: { value: 0 },
};

export type SharedUniforms = typeof sharedUniforms;
