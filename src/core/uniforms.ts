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
};

export type SharedUniforms = typeof sharedUniforms;
