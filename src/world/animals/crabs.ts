import * as THREE from 'three';
import { PartBuilder, animAttribute, animatedMaterial } from './parts';
import type { Heightmap } from '../heightmap';
import type { Rng } from '../../core/rng';
import type { SharedUniforms } from '../../core/uniforms';

const COUNT = 12;
/** Sand band they live on (ground height, m): the damp sand above the swash up to the dry beach. */
const BAND = [0.25, 1.3] as const;
/** Walking and fleeing speed (m/s); how close you may come before they run (m). */
const WALK = 0.45;
const RUN = 2.2;
const SHY = 3.2;

/** Legs tap while moving: `aPart.x` = leg (1) or not, `aPart.y` = leg index for the phase. */
const MOTION = /* glsl */ `
if (aPart.x > 0.5) {
  transformed.y += 0.012 * max(0.0, sin(uTime * 28.0 + aPart.y * 2.1 + iAnim.x)) * iAnim.y;
}
`;

type State = 'idle' | 'walk' | 'flee' | 'burrow' | 'hidden';

interface Crab {
  x: number;
  z: number;
  /** Facing (yaw); crabs walk sideways, so they move along local ±X. */
  yaw: number;
  state: State;
  timer: number;
  tx: number;
  tz: number;
  /** 0 = under the sand … 1 = on it. */
  up: number;
  seed: number;
}

/**
 * Ghost crabs on the beaches: they potter sideways about the damp sand, stop, go on. Come near
 * and they dash away and dig in; a while later one pops up somewhere else.
 */
export class Crabs {
  readonly mesh: THREE.InstancedMesh;
  private readonly crabs: Crab[] = [];
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly hm: Heightmap,
    private readonly rng: Rng,
    shared: SharedUniforms,
    /** Around the island (radians): the stretch of beach they live on. */
    private readonly arc: readonly [number, number],
  ) {
    const material = animatedMaterial(MOTION, shared.uTime, { roughness: 0.55 });
    this.mesh = new THREE.InstancedMesh(crabGeometry(), material, COUNT);
    this.mesh.name = 'crabs';
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.anim = animAttribute(this.mesh);
    for (let i = 0; i < COUNT; i++) {
      const c: Crab = { x: 0, z: 0, yaw: rng() * Math.PI * 2, state: 'idle', timer: rng() * 4, tx: 0, tz: 0, up: 1, seed: rng() * 50 };
      this.spot(c, null);
      this.crabs.push(c);
    }
  }

  /** A random place on their beach (away from `avoid`, if given). */
  private spot(c: Crab, avoid: { x: number; z: number } | null): void {
    for (let tries = 0; tries < 20; tries++) {
      const a = this.arc[0] + this.rng() * (this.arc[1] - this.arc[0]);
      const h = BAND[0] + this.rng() * (BAND[1] - BAND[0]);
      const r = this.hm.shoreDistance(a, h);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (avoid && Math.hypot(x - avoid.x, z - avoid.z) < 12) continue;
      c.x = x;
      c.z = z;
      return;
    }
  }

  private onSand(x: number, z: number): boolean {
    const h = this.hm.heightAt(x, z);
    return h > BAND[0] - 0.1 && h < BAND[1] + 0.3;
  }

  /** `player`: where you walk (null when not walking). */
  update(dt: number, player: { x: number; z: number } | null): void {
    for (let i = 0; i < COUNT; i++) {
      const c = this.crabs[i];
      c.timer -= dt;
      const d = player ? Math.hypot(c.x - player.x, c.z - player.z) : Infinity;
      if (d < SHY && (c.state === 'idle' || c.state === 'walk')) {
        // Run away from you, sideways, then dig in.
        c.state = 'flee';
        c.timer = 1 + this.rng() * 0.8;
        const ax = (c.x - player!.x) / (d || 1);
        const az = (c.z - player!.z) / (d || 1);
        c.tx = c.x + ax * 6;
        c.tz = c.z + az * 6;
      }
      let speed = 0;
      switch (c.state) {
        case 'idle':
          if (c.timer <= 0) {
            c.state = 'walk';
            c.timer = 2 + this.rng() * 4;
            const a = this.rng() * Math.PI * 2;
            const r = 1 + this.rng() * 3;
            c.tx = c.x + Math.cos(a) * r;
            c.tz = c.z + Math.sin(a) * r;
            if (!this.onSand(c.tx, c.tz)) {
              c.tx = c.x;
              c.tz = c.z;
            }
          }
          break;
        case 'walk':
          speed = WALK;
          if (c.timer <= 0) {
            c.state = 'idle';
            c.timer = 1 + this.rng() * 5;
          }
          break;
        case 'flee':
          speed = RUN;
          if (c.timer <= 0) {
            c.state = 'burrow';
            c.timer = 0.7;
          }
          break;
        case 'burrow':
          c.up = Math.max(0, c.timer / 0.7);
          if (c.timer <= 0) {
            c.state = 'hidden';
            c.timer = 15 + this.rng() * 25;
          }
          break;
        case 'hidden':
          if (c.timer <= 0) {
            this.spot(c, player);
            c.state = 'idle';
            c.timer = 2;
            c.up = 1;
          }
          break;
      }
      if (speed > 0) {
        const dx = c.tx - c.x;
        const dz = c.tz - c.z;
        const dl = Math.hypot(dx, dz);
        if (dl > 0.05) {
          const step = Math.min(dl, speed * dt);
          const nx = c.x + (dx / dl) * step;
          const nz = c.z + (dz / dl) * step;
          // Into the sea or up the dry beach: stop there (dig in when fleeing).
          if (this.onSand(nx, nz)) {
            c.x = nx;
            c.z = nz;
          } else {
            c.tx = c.x;
            c.tz = c.z;
          }
          // Sideways: the body's local +X points along the way it moves (turning smoothly).
          const want = Math.atan2(-dz, dx);
          let diff = want - c.yaw;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          // A crab runs either way sideways: turn to whichever side is closer.
          if (Math.abs(diff) > Math.PI / 2) diff -= Math.sign(diff) * Math.PI;
          c.yaw += diff * (1 - Math.exp(-dt * 6));
        } else {
          speed = 0;
        }
      }
      const h = this.hm.heightAt(c.x, c.z);
      this.p.set(c.x, h - 0.09 * (1 - c.up) + 0.005, c.z);
      this.q.setFromAxisAngle(this.up, c.yaw);
      this.s.setScalar(c.state === 'hidden' ? 0 : 1);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      this.anim.setXY(i, c.seed, speed > 0 ? Math.min(1, speed / WALK) : 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
  }
}

/** A ghost crab ~0.16 m across the legs: sandy-orange shell, white claws, eyes on stalks. */
function crabGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const shell = '#d99a5b';
  const leg = '#c98a4f';
  b.add(new THREE.SphereGeometry(1, 10, 6).scale(0.05, 0.022, 0.04).translate(0, 0.035, 0), shell);
  for (const side of [-1, 1]) {
    // Eye stalks and claws in front (local −Z).
    b.add(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 4).translate(side * 0.02, 0.06, -0.03), shell);
    b.add(new THREE.SphereGeometry(0.008, 5, 4).translate(side * 0.02, 0.078, -0.03), '#2a2a2a');
    b.add(new THREE.SphereGeometry(1, 6, 4).scale(0.02, 0.013, 0.014).translate(side * 0.04, 0.03, -0.05), '#f0e6d6');
    // Four legs per side, bent down to the sand.
    for (let k = 0; k < 4; k++) {
      const z = -0.02 + k * 0.017;
      const g = new THREE.CylinderGeometry(0.004, 0.003, 0.07, 4);
      g.rotateZ(side * (Math.PI / 2 - 0.6)).translate(side * 0.065, 0.02, z);
      b.add(g, leg, [1, k + (side > 0 ? 4 : 0)]);
    }
  }
  return b.build();
}
