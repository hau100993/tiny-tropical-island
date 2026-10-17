import * as THREE from 'three';
import { sampleWaves, waveAttenuation, type WaveSample } from './gerstner';
import type { Heightmap } from '../world/heightmap';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Makes an object ride the Gerstner waves: height and tilt come from the CPU twin of the
 * water vertex shader, smoothed so the boat feels heavy rather than glued to the surface.
 */
export class FloatingObject {
  private readonly sample: WaveSample = { height: 0, dhdx: 0, dhdz: 0 };
  private readonly normal = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly yaw = new THREE.Quaternion();
  private readonly targetQ = new THREE.Quaternion();
  private readonly depth: number;

  constructor(
    private readonly object: THREE.Object3D,
    hm: Heightmap,
    x: number,
    z: number,
    rotY: number,
  ) {
    object.position.set(x, 0, z);
    this.yaw.setFromAxisAngle(UP, rotY);
    object.quaternion.copy(this.yaw);
    this.depth = -hm.heightAt(x, z);
  }

  update(time: number, waveStrength: number, camera: THREE.Camera, dt: number): void {
    const o = this.object;
    const dist = Math.hypot(o.position.x - camera.position.x, o.position.z - camera.position.z);
    const atten = waveAttenuation(waveStrength, this.depth, dist);
    const s = sampleWaves(o.position.x, o.position.z, time, atten, dist, this.sample);
    const k = 1 - Math.exp(-4 * dt);
    o.position.y += (s.height - o.position.y) * k;
    this.normal.set(-s.dhdx, 1, -s.dhdz).normalize();
    this.tilt.setFromUnitVectors(UP, this.normal);
    this.targetQ.multiplyQuaternions(this.tilt, this.yaw);
    o.quaternion.slerp(this.targetQ, 1 - Math.exp(-2.5 * dt));
  }
}
