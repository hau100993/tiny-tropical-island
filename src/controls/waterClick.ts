import * as THREE from 'three';

/** Max pointer travel (px) and press duration (ms) for a press to count as a click, not a drag. */
const CLICK_MOVE_PX = 6;
const CLICK_MS = 350;

/**
 * Detects clicks (not orbit drags) on the canvas and reports where the view ray hits the
 * water plane y = 0. Analytic plane intersection: no mesh raycasting needed.
 */
export function onWaterClick(
  dom: HTMLElement,
  camera: THREE.Camera,
  callback: (x: number, z: number) => void,
): void {
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  let downX = 0;
  let downY = 0;
  let downTime = 0;

  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    downX = e.clientX;
    downY = e.clientY;
    downTime = performance.now();
  });
  dom.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_MOVE_PX) return;
    if (performance.now() - downTime > CLICK_MS) return;
    const rect = dom.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) callback(hit.x, hit.z);
  });
}
