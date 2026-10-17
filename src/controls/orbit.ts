import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface OrbitCamera {
  controls: OrbitControls;
  setAutoRotate(on: boolean): void;
  update(dt: number): void;
}

/** Drag to rotate, wheel/pinch to zoom, right-drag to pan; slow optional auto-rotate. */
export function createOrbitCamera(camera: THREE.PerspectiveCamera, dom: HTMLElement): OrbitCamera {
  const controls = new OrbitControls(camera, dom);
  controls.target.set(0, 3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 12;
  controls.maxDistance = 320;
  // Stop just above the horizon so the camera never dips under the sea.
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.autoRotateSpeed = 0.35;
  controls.screenSpacePanning = false;
  camera.position.set(95, 48, 115);
  controls.update();

  return {
    controls,
    setAutoRotate(on) {
      controls.autoRotate = on;
    },
    update(dt) {
      controls.update(dt);
      // Keep panning within the island area.
      const t = controls.target;
      const r = Math.hypot(t.x, t.z);
      if (r > 90) t.multiplyScalar(90 / r);
      t.y = THREE.MathUtils.clamp(t.y, 0, 15);
    },
  };
}
