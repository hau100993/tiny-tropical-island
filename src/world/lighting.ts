import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';

export interface Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** 0 disables shadows. */
  setShadowMapSize(size: number): void;
  /** Re-aims the sun from `uSunDir` (static in Phase 1a; driven by day/night in Phase 4). */
  update(): void;
}

export function createLighting(scene: THREE.Scene, shared: SharedUniforms): Lighting {
  const sun = new THREE.DirectionalLight(shared.uSunColor.value, 2.6);
  sun.castShadow = true;
  // The island is small, so one tight orthographic shadow frustum covers it at good resolution.
  const cam = sun.shadow.camera;
  cam.left = -85;
  cam.right = 85;
  cam.top = 85;
  cam.bottom = -85;
  cam.near = 10;
  cam.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight('#cfe8ff', '#c9b68a', 1.1);
  scene.add(hemi);

  const update = (): void => {
    sun.position.copy(shared.uSunDir.value).multiplyScalar(200);
    sun.target.position.set(0, 0, 0);
    sun.color.copy(shared.uSunColor.value);
  };
  update();

  return {
    sun,
    hemi,
    update,
    setShadowMapSize(size) {
      sun.castShadow = size > 0;
      if (size > 0 && sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        // The shadow render target is reallocated at the new size on the next frame.
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
    },
  };
}
