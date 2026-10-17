import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';
import skyCommon from './shaders/skyCommon.glsl?raw';
import skyVert from './shaders/sky.vert.glsl?raw';
import skyFrag from './shaders/sky.frag.glsl?raw';

export interface Sky {
  mesh: THREE.Mesh;
  /** Keeps the dome centered on the camera so it always looks infinitely far away. */
  follow(camera: THREE.Camera): void;
}

export function createSky(shared: SharedUniforms): Sky {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyTop: shared.uSkyTop,
      uSkyHorizon: shared.uSkyHorizon,
    },
    vertexShader: skyVert,
    fragmentShader: `${skyCommon}\n${skyFrag}`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), material);
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
