import * as THREE from 'three';
import type { OrbitCamera } from './orbit';
import type { Walker } from './walker';
import type { DeskPose, DeskView } from './deskView';

export type CameraMode = 'orbit' | 'walk' | 'desk';

/** Near plane per mode: close enough not to clip walls (or the monitors) indoors. */
const NEAR = { orbit: 0.3, walk: 0.08, desk: 0.05 } as const;

export interface DeskSpot {
  /** Where the eyes are when seated, looking out to sea. */
  seat: DeskPose;
  /** Where you stand when you get up (feet), and which way you face. */
  stand: { x: number; z: number; yaw: number };
}

/**
 * Switches between the orbit camera, walking and sitting at the desk. Leaving to orbit puts the
 * orbit camera back exactly where it was; walking resumes where you left off (or next to the
 * chair after getting up).
 */
export class CameraManager {
  mode: CameraMode = 'orbit';
  /** Where getting up from the desk goes back to. */
  private deskReturn: 'orbit' | 'walk' = 'orbit';
  private readonly savedPos = new THREE.Vector3();
  private readonly savedTarget = new THREE.Vector3();
  private readonly listeners: Array<(mode: CameraMode) => void> = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly orbit: OrbitCamera,
    private readonly walker: Walker,
    private readonly desk: DeskView,
    private readonly spawn: { x: number; z: number; yaw: number },
    private readonly deskSpot: DeskSpot,
  ) {}

  onChange(fn: (mode: CameraMode) => void): void {
    this.listeners.push(fn);
  }

  toggle(): void {
    this.setMode(this.mode === 'orbit' ? 'walk' : 'orbit');
  }

  /** Sit down (from anywhere) or get up again. `animate`: glide onto the chair. */
  toggleDesk(animate: boolean): void {
    if (this.mode === 'desk') this.setMode(this.deskReturn);
    else this.setMode('desk', animate);
  }

  setMode(mode: CameraMode, animate = false): void {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    // Leave the current mode.
    if (from === 'orbit') {
      this.savedPos.copy(this.camera.position);
      this.savedTarget.copy(this.orbit.controls.target);
      this.orbit.controls.enabled = false;
    } else if (from === 'walk') {
      this.walker.exit();
    } else {
      this.desk.exit();
    }
    // Enter the new one.
    if (mode === 'desk') {
      this.deskReturn = from === 'walk' ? 'walk' : 'orbit';
      this.desk.enter(this.deskSpot.seat, animate);
    } else if (mode === 'walk') {
      if (from === 'desk') this.walker.placeAt(this.deskSpot.stand.x, this.deskSpot.stand.z, this.deskSpot.stand.yaw);
      this.walker.enter(this.spawn);
    } else {
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
    else if (this.mode === 'desk') this.desk.update(dt);
    else this.orbit.update(dt);
  }
}
