import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface OrbitCamera {
  controls: OrbitControls;
  setAutoRotate(on: boolean): void;
  update(dt: number): void;
}

/** Lowest the camera may go: just above the sand, or above the sea surface and its waves. */
const GROUND_CLEARANCE = 0.5;
const SEA_CLEARANCE = 0.9;

/**
 * Drag to rotate, wheel/pinch to zoom, right-drag to pan (up/down lifts the point you orbit,
 * so you can look up into the sky); slow optional auto-rotate. Dragging the view down takes
 * the camera to the sand or the sea surface and it then looks up from there.
 * `groundAt` gives the terrain height (negative under the sea).
 */
export function createOrbitCamera(
  camera: THREE.PerspectiveCamera,
  dom: HTMLElement,
  groundAt: (x: number, z: number) => number,
): OrbitCamera {
  const controls = new OrbitControls(camera, dom);
  controls.target.set(0, 3, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 6;
  controls.maxDistance = 320;
  // Down to well below the orbit point (looking up at the sky); the ground clamp in update()
  // keeps the camera above the sand and the sea.
  controls.maxPolarAngle = Math.PI * 0.92;
  controls.autoRotateSpeed = 0.35;
  controls.screenSpacePanning = true;
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
      t.y = THREE.MathUtils.clamp(t.y, 0, 60);
      // Never under the sand or the sea: slide along it instead (the view then tilts up).
      const p = camera.position;
      const h = groundAt(p.x, p.z);
      const floor = h > 0 ? h + GROUND_CLEARANCE : SEA_CLEARANCE;
      if (p.y < floor) {
        p.y = floor;
        camera.lookAt(t);
      }
    },
  };
}
