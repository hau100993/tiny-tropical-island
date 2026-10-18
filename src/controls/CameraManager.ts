import * as THREE from 'three';
import type { OrbitCamera } from './orbit';
import type { FirstPerson } from './firstPerson';

export type CameraMode = 'orbit' | 'walk';

/** Near plane per mode: close enough not to clip walls indoors, far enough for depth precision. */
const NEAR = { orbit: 0.3, walk: 0.08 } as const;

/**
 * Switches between the orbit camera and walking. Leaving walk mode puts the orbit camera back
 * exactly where it was; walking resumes where you left off.
 */
export class CameraManager {
  mode: CameraMode = 'orbit';
  private readonly savedPos = new THREE.Vector3();
  private readonly savedTarget = new THREE.Vector3();
  private readonly listeners: Array<(mode: CameraMode) => void> = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly orbit: OrbitCamera,
    private readonly walker: FirstPerson,
    private readonly spawn: { x: number; z: number; yaw: number },
  ) {}

  onChange(fn: (mode: CameraMode) => void): void {
    this.listeners.push(fn);
  }

  toggle(): void {
    this.setMode(this.mode === 'orbit' ? 'walk' : 'orbit');
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'walk') {
      this.savedPos.copy(this.camera.position);
      this.savedTarget.copy(this.orbit.controls.target);
      this.orbit.controls.enabled = false;
      this.walker.enter(this.spawn);
    } else {
      this.walker.exit();
      this.camera.position.copy(this.savedPos);
      this.orbit.controls.target.copy(this.savedTarget);
      this.orbit.controls.enabled = true;
      this.orbit.controls.update();
    }
    this.camera.near = NEAR[mode];
    this.camera.updateProjectionMatrix();
    for (const fn of this.listeners) fn(mode);
  }

  update(dt: number): void {
    if (this.mode === 'walk') this.walker.update(dt);
    else this.orbit.update(dt);
  }
}
