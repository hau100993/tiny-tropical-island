import * as THREE from 'three';

export interface Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** 0 disables shadows. */
  setShadowMapSize(size: number): void;
  /** Main directional light (sun by day, moon by night). */
  setMain(dir: THREE.Vector3, color: THREE.Color, intensity: number): void;
  setHemi(sky: THREE.Color, ground: THREE.Color, intensity: number): void;
}

/** One shadow-casting directional light (sun or moon) plus a sky/ground hemisphere light. */
export function createLighting(scene: THREE.Scene): Lighting {
  const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
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
  sun.position.set(110, 124, 84);
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight('#cfe8ff', '#c9b68a', 1.1);
  scene.add(hemi);

  return {
    sun,
    hemi,
    setMain(dir, color, intensity) {
      sun.position.copy(dir).multiplyScalar(200);
      sun.color.copy(color);
      sun.intensity = intensity;
    },
    setHemi(sky, ground, intensity) {
      hemi.color.copy(sky);
      hemi.groundColor.copy(ground);
      hemi.intensity = intensity;
    },
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
