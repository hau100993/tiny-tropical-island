import * as THREE from 'three';
import { clamp, damp } from '../core/math';

/** How far you can turn your head from the sea direction (rad), left/right and down/up. */
const YAW_LIMIT = 1.25;
const PITCH_MIN = -0.75;
const PITCH_MAX = 0.4;
/** Desk: looking slightly down, both screens and the sea above them in view. */
export const DEFAULT_PITCH = -0.13;
const LOOK_SPEED = 0.0035;
/** Field of view: wide when sitting back, narrow when "leaning in" to read the screens. */
const FOV_WIDE = 62;
const FOV_NEAR = 30;
/** Seconds to slide from wherever the camera was onto the chair. */
const SIT_SECONDS = 1.1;

export interface DeskPose {
  x: number;
  y: number;
  z: number;
  /** Camera yaw looking straight ahead from the seat (forward = −Z rotated by yaw). */
  yaw: number;
  /** Default look up/down (rad). */
  pitch: number;
  /** Neck limits for this seat (default: the desk's). Lying in the hammock you look up a lot. */
  pitchMin?: number;
  pitchMax?: number;
  yawLimit?: number;
}

/**
 * Sitting at the desk: the camera is fixed at the chair. Drag with the mouse to look around
 * (within neck limits), scroll to lean in toward the screens. The cursor stays free, so the
 * panel and the Pomodoro card remain usable.
 */
export class DeskView {
  active = false;
  private pose: DeskPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: DEFAULT_PITCH };
  private yaw = 0;
  private pitch = DEFAULT_PITCH;
  private zoom = 0;
  private zoomTarget = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  /** Transition from the previous camera pose (0 → 1). */
  private t = 1;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private readonly toQuat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private fromFov = 55;
  private baseFov = 55;
  /**
   * Movement of the seat itself (the hammock swinging): an offset added to the eyes and a roll
   * around the view axis. Set every frame by the owner of the seat; zero otherwise.
   */
  readonly motion = { x: 0, y: 0, z: 0, roll: 0 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.active || !this.dragging) return;
      // Dragging moves the view like grabbing it: drag left → look right.
      const yawLimit = this.pose.yawLimit ?? YAW_LIMIT;
      this.yaw = clamp(this.yaw + (e.clientX - this.lastX) * LOOK_SPEED, -yawLimit, yawLimit);
      this.pitch = clamp(this.pitch + (e.clientY - this.lastY) * LOOK_SPEED, this.pose.pitchMin ?? PITCH_MIN, this.pose.pitchMax ?? PITCH_MAX);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const stop = (): void => {
      this.dragging = false;
    };
    dom.addEventListener('pointerup', stop);
    dom.addEventListener('pointercancel', stop);
    dom.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.zoomTarget = clamp(this.zoomTarget - e.deltaY * 0.0015, 0, 1);
      },
      { passive: false },
    );
  }

  /**
   * Sits down at `pose`. With `animate`, the camera glides there from where it is now
   * (standing next to the desk); otherwise it cuts (e.g. behind a fade).
   */
  enter(pose: DeskPose, animate: boolean): void {
    this.pose = { ...pose };
    this.active = true;
    this.motion.x = this.motion.y = this.motion.z = this.motion.roll = 0;
    this.yaw = 0;
    this.pitch = pose.pitch;
    this.zoom = 0;
    this.zoomTarget = 0;
    this.baseFov = this.camera.fov;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.t = animate ? 0 : 1;
    this.camera.rotation.order = 'YXZ';
    this.apply(0);
  }

  exit(): void {
    this.active = false;
    this.dragging = false;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.camera.rotation.order = 'XYZ';
  }

  /** Where to sit (for the listener and the screens' visibility). */
  get seat(): Readonly<DeskPose> {
    return this.pose;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.apply(dt);
  }

  private apply(dt: number): void {
    this.zoom += (this.zoomTarget - this.zoom) * damp(8, dt || 1);
    const mo = this.motion;
    this.euler.set(this.pitch, this.pose.yaw + this.yaw, mo.roll, 'YXZ');
    this.toQuat.setFromEuler(this.euler);
    const fov = FOV_WIDE + (FOV_NEAR - FOV_WIDE) * this.zoom;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / SIT_SECONDS);
      const k = this.t * this.t * (3 - 2 * this.t);
      this.camera.position.set(
        this.fromPos.x + (this.pose.x + mo.x - this.fromPos.x) * k,
        this.fromPos.y + (this.pose.y + mo.y - this.fromPos.y) * k,
        this.fromPos.z + (this.pose.z + mo.z - this.fromPos.z) * k,
      );
      this.camera.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, k);
      this.camera.fov = this.fromFov + (fov - this.fromFov) * k;
    } else {
      this.camera.position.set(this.pose.x + mo.x, this.pose.y + mo.y, this.pose.z + mo.z);
      this.camera.quaternion.copy(this.toQuat);
      this.camera.fov = fov;
    }
    this.camera.updateProjectionMatrix();
  }
}
