import * as THREE from 'three';

export interface Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** 0 disables shadows. */
  setShadowMapSize(size: number): void;
  /** Main directional light (sun by day, moon by night). */
  setMain(dir: THREE.Vector3, color: THREE.Color, intensity: number): void;
  setHemi(sky: THREE.Color, ground: THREE.Color, intensity: number): void;
  /**
   * Where the shadow map looks: a square `half` m around (x, z). The overview covers the whole
   * island (85 m around the center); walking and paddling use a smaller square around the
   * player, so shadows near you are sharper and also exist far out at sea.
   */
  setShadowFocus(x: number, z: number, half: number): void;
}

/** Overview shadow square: the whole island. */
export const ISLAND_SHADOW_HALF = 85;
/** Distance of the light from its target (m); the shadow camera's near/far fit around it. */
const LIGHT_DISTANCE = 200;

/** One shadow-casting directional light (sun or moon) plus a sky/ground hemisphere light. */
export function createLighting(scene: THREE.Scene): Lighting {
  const dir = new THREE.Vector3(0.55, 0.62, 0.42).normalize();
  const focus = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const back = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let half = ISLAND_SHADOW_HALF;

  const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
  sun.castShadow = true;
  // The island is small, so one tight orthographic shadow frustum covers it at good resolution
  // (see setShadowFocus for the smaller one around the player).
  const cam = sun.shadow.camera;
  cam.left = -ISLAND_SHADOW_HALF;
  cam.right = ISLAND_SHADOW_HALF;
  cam.top = ISLAND_SHADOW_HALF;
  cam.bottom = -ISLAND_SHADOW_HALF;
  cam.near = 10;
  cam.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.position.copy(dir).multiplyScalar(LIGHT_DISTANCE);
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight('#cfe8ff', '#c9b68a', 1.1);
  scene.add(hemi);

  /**
   * Places the light and its target around the focus. The focus is snapped to whole shadow-map
   * texels in the light's own frame: moving it by a fraction of a texel would make every shadow
   * edge crawl ("shimmer") as you walk.
   */
  const place = (): void => {
    basis.lookAt(dir, origin, THREE.Object3D.DEFAULT_UP);
    basis.extractBasis(right, up, back);
    const texel = (2 * half) / Math.max(1, sun.shadow.mapSize.x);
    const lx = Math.round(focus.dot(right) / texel) * texel;
    const ly = Math.round(focus.dot(up) / texel) * texel;
    const lz = focus.dot(back);
    sun.target.position.copy(right).multiplyScalar(lx).addScaledVector(up, ly).addScaledVector(back, lz);
    sun.target.updateMatrixWorld();
    sun.position.copy(sun.target.position).addScaledVector(dir, LIGHT_DISTANCE);
  };

  return {
    sun,
    hemi,
    setMain(d, color, intensity) {
      dir.copy(d);
      place();
      sun.color.copy(color);
      sun.intensity = intensity;
    },
    setShadowFocus(x, z, h) {
      focus.set(x, 0, z);
      if (h !== half) {
        half = h;
        cam.left = -h;
        cam.right = h;
        cam.top = h;
        cam.bottom = -h;
        cam.updateProjectionMatrix();
      }
      place();
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
