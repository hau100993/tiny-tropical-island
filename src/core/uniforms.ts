import * as THREE from 'three';

/** Shooting stars that can be in the sky at the same time. */
export const METEOR_SLOTS = 8;

/**
 * Uniforms shared by many materials. Materials reference these exact objects, so writing
 * `sharedUniforms.uTime.value` once per frame updates every shader that uses it.
 */
export const sharedUniforms = {
  uTime: { value: 0 },
  /** True sun direction (may be below the horizon at night). */
  uSunDir: { value: new THREE.Vector3(0.55, 0.62, 0.42).normalize() },
  uSunColor: { value: new THREE.Color('#fff0d4') },
  uMoonDir: { value: new THREE.Vector3(-0.5, 0.6, 0.4).normalize() },
  /** Main light (sun by day, moon by night): drives water glints and caustics. */
  uLightDir: { value: new THREE.Vector3(0.55, 0.62, 0.42).normalize() },
  uLightColor: { value: new THREE.Color('#fff0d4') },
  uSkyTop: { value: new THREE.Color('#2f7fd6') },
  uSkyHorizon: { value: new THREE.Color('#bfe2f5') },
  /** 0 = deep night … 1 = full daylight (with a small floor so night stays readable). */
  uDayLight: { value: 1 },
  /** 0 = day … 1 = dark night (stars, aurora, fireflies). */
  uNight: { value: 0 },
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
  // Sky (Phase 4).
  uCloudCover: { value: 0.35 },
  /** Cloud layer drift (noise-space offset), integrated from the wind. */
  uCloudOffset: { value: new THREE.Vector2() },
  uStars: { value: 1 },
  uAurora: { value: 0 },
  /** Where the aurora is brightest: azimuth atan(x, −z), radians (0 = −Z). Set from the desk. */
  uAuroraAz: { value: 0 },
  /** Aurora rays and folds speed: 1, or nearly still under prefers-reduced-motion. */
  uAuroraMotion: { value: 1 },
  /** Moon glow (0.3 = normal, 1 = big bright full moon), faded by clouds. */
  uMoonGlow: { value: 0.3 },
  uRainbow: { value: 0 },
  /**
   * Shooting stars (METEOR_SLOTS of them): A = (start dir, start time), B = (end dir,
   * duration). Must match the array size in sky.frag.glsl.
   */
  uMeteorA: { value: Array.from({ length: METEOR_SLOTS }, () => new THREE.Vector4(0, 1, 0, -100)) },
  uMeteorB: { value: Array.from({ length: METEOR_SLOTS }, () => new THREE.Vector4(0, 1, 0, 1)) },
  /**
   * The house roof as an oriented box: (center x, center z, cos, sin) and (half x, half z,
   * top of dry surfaces, top for rain/snow particles). Nothing falls or settles under it.
   */
  uShelter: { value: new THREE.Vector4(0, 0, 1, 0) },
  uShelterSize: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** Sky turned around the vertical for the current scene (radians, see sunDirection). */
  uSkyTurn: { value: 0 },
  /** Rotation of the star field (hour angle), radians. */
  uStarRotation: { value: 0 },
};

export type SharedUniforms = typeof sharedUniforms;
