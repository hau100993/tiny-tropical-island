import * as THREE from 'three';
import type { OrbitCamera } from './orbit';
import type { Walker } from './walker';
import type { DeskPose, DeskView } from './deskView';

/** 'seat': sitting somewhere in the house (the desk or the bathtub). */
export type CameraMode = 'orbit' | 'walk' | 'seat';
export type SeatId = 'desk' | 'bath';

/** Near plane per mode: close enough not to clip walls (or the monitors) indoors. */
const NEAR = { orbit: 0.3, walk: 0.08, seat: 0.05 } as const;

export interface SeatSpot {
  /** Where the eyes are when seated, and the look direction. */
  seat: DeskPose;
  /** Where you stand when you get up (feet), and which way you face. */
  stand: { x: number; z: number; yaw: number };
}

/**
 * Switches between the orbit camera, walking and sitting (at the desk or in the bathtub).
 * Leaving to orbit puts the orbit camera back exactly where it was; walking resumes where you
 * left off (or next to the seat after getting up).
 */
export class CameraManager {
  mode: CameraMode = 'orbit';
  /** Which seat, while mode is 'seat'. */
  seat: SeatId = 'desk';
  /** Where getting up goes back to. */
  private seatReturn: 'orbit' | 'walk' = 'orbit';
  private readonly savedPos = new THREE.Vector3();
  private readonly savedTarget = new THREE.Vector3();
  private readonly listeners: Array<(mode: CameraMode) => void> = [];

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly orbit: OrbitCamera,
    private readonly walker: Walker,
    private readonly sitter: DeskView,
    private readonly spawn: { x: number; z: number; yaw: number },
    private readonly seats: Record<SeatId, SeatSpot>,
  ) {}

  onChange(fn: (mode: CameraMode) => void): void {
    this.listeners.push(fn);
  }

  toggle(): void {
    this.setMode(this.mode === 'orbit' ? 'walk' : 'orbit');
  }

  /** Sit down at `id` (from anywhere, or move from the other seat). `animate`: glide there. */
  sit(id: SeatId, animate: boolean): void {
    if (this.mode === 'seat') {
      if (id === this.seat) return;
      this.seat = id;
      this.sitter.enter(this.seats[id].seat, animate);
      for (const fn of this.listeners) fn(this.mode);
      return;
    }
    this.seat = id;
    this.setMode('seat', animate);
  }

  /** Stand up again: back to walking next to the seat, or to the orbit view. */
  getUp(): void {
    if (this.mode === 'seat') this.setMode(this.seatReturn);
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
      this.sitter.exit();
    }
    // Enter the new one.
    if (mode === 'seat') {
      this.seatReturn = from === 'walk' ? 'walk' : 'orbit';
      this.sitter.enter(this.seats[this.seat].seat, animate);
    } else if (mode === 'walk') {
      if (from === 'seat') {
        const s = this.seats[this.seat].stand;
        this.walker.placeAt(s.x, s.z, s.yaw);
      }
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
    else if (this.mode === 'seat') this.sitter.update(dt);
    else this.orbit.update(dt);
  }
}
