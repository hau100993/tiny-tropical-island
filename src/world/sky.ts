import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';
import skyCommon from './shaders/skyCommon.glsl?raw';
import clouds from './shaders/clouds.glsl?raw';
import skyVert from './shaders/sky.vert.glsl?raw';
import skyFrag from './shaders/sky.frag.glsl?raw';

export interface Sky {
  mesh: THREE.Mesh;
  /** Keeps the dome centered on the camera so it always looks infinitely far away. */
  follow(camera: THREE.Camera): void;
}

export function createSky(shared: SharedUniforms): Sky {
  const u = shared;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.uTime,
      uSunDir: u.uSunDir,
      uSunColor: u.uSunColor,
      uSkyTop: u.uSkyTop,
      uSkyHorizon: u.uSkyHorizon,
      uMoonDir: u.uMoonDir,
      uMoonGlow: u.uMoonGlow,
      uNight: u.uNight,
      uDayLight: u.uDayLight,
      uStars: u.uStars,
      uAurora: u.uAurora,
      uRainbow: u.uRainbow,
      uStarRotation: u.uStarRotation,
      uSkyTurn: u.uSkyTurn,
      uMeteorA: u.uMeteorA,
      uMeteorB: u.uMeteorB,
      uCloudCover: u.uCloudCover,
      uCloudOffset: u.uCloudOffset,
    },
    vertexShader: skyVert,
    fragmentShader: `${skyCommon}\n${clouds}\n${skyFrag}`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), material);
  mesh.name = 'sky';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return {
    mesh,
    follow(camera) {
      mesh.position.copy(camera.position);
    },
  };
}
