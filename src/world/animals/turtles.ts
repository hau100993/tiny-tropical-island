import * as THREE from 'three';
import { PartBuilder, animAttribute, animatedMaterial, flat } from './parts';
import type { Heightmap } from '../heightmap';
import type { Rng } from '../../core/rng';
import type { SharedUniforms } from '../../core/uniforms';

const COUNT = 4;
/** Swimming speed (m/s) and the stroke rate of the front flippers (rad/s). */
const SPEED = 0.55;
const STROKE = 1.7;

/**
 * Flippers sweep around the body axis: `aPart.x` = side × reach (0 shoulder … 1 tip), `aPart.y`
 * = 1 front (big, slow wing-like strokes), 2 rear (small paddling, half a beat later).
 */
const MOTION = /* glsl */ `
float s = abs(aPart.x);
if (s > 0.0) {
  float side = sign(aPart.x);
  bool front = aPart.y < 1.5;
  float ph = uTime * ${STROKE.toFixed(2)} + iAnim.x + (front ? 0.0 : 1.6);
  float ang = (front ? 0.55 : 0.25) * sin(ph) * iAnim.y;
  float r = transformed.x * side;
  transformed.x = side * r * cos(ang);
  transformed.y += r * sin(ang) * s;
  // The front flippers also sweep back on the power stroke.
  if (front) transformed.z += 0.12 * s * cos(ph) * iAnim.y;
}
`;

interface Turtle {
  cx: number;
  cz: number;
  r: number;
  y: number;
  dir: number;
  phase: number;
  seed: number;
}

/**
 * Green sea turtles gliding in slow loops over the reef off the house beach (for divers), with
 * big unhurried strokes of the front flippers. Their loops keep clear of the seabed and the reef
 * rocks all the way round.
 */
export class Turtles {
  readonly mesh: THREE.InstancedMesh;
  private readonly turtles: Turtle[] = [];
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(hm: Heightmap, rng: Rng, shared: SharedUniforms, floorAt: (x: number, z: number) => number, houseAngle: number) {
    const material = animatedMaterial(MOTION, shared.uTime, { roughness: 0.6, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(turtleGeometry(), material, COUNT);
    this.mesh.name = 'turtles';
    this.mesh.frustumCulled = false;
    this.anim = animAttribute(this.mesh);
    for (let i = 0; i < COUNT; i++) {
      const a = houseAngle + (rng() - 0.5) * 1.4;
      const depth = 4 + rng() * 4;
      const br = hm.shoreDistance(a, -depth);
      const cx = Math.cos(a) * br;
      const cz = Math.sin(a) * br;
      let r = 7 + rng() * 6;
      // Highest seabed (reef rocks included) under the loop.
      let top = -Infinity;
      for (let tries = 0; tries < 5; tries++) {
        top = -Infinity;
        for (let k = 0; k < 20; k++) {
          const t = (k / 20) * Math.PI * 2;
          top = Math.max(top, floorAt(cx + Math.cos(t) * r, cz + Math.sin(t) * r));
        }
        if (top < -2.4) break;
        r *= 0.75;
      }
      this.turtles.push({
        cx,
        cz,
        r,
        y: Math.min(-1.3, top + 1.4 + rng() * 0.8),
        dir: rng() < 0.5 ? -1 : 1,
        phase: rng() * Math.PI * 2,
        seed: rng() * 10,
      });
    }
  }

  update(time: number): void {
    for (let i = 0; i < COUNT; i++) {
      const t = this.turtles[i];
      const a = t.phase + ((time * SPEED) / t.r) * t.dir;
      const x = t.cx + Math.cos(a) * t.r;
      const z = t.cz + Math.sin(a) * t.r;
      // Slow rise and fall, nose following it.
      const bob = Math.sin(time * 0.13 + t.seed);
      const y = t.y + 0.5 * bob;
      const vy = 0.5 * 0.13 * Math.cos(time * 0.13 + t.seed);
      const vx = -Math.sin(a) * t.dir;
      const vz = Math.cos(a) * t.dir;
      this.e.set(Math.atan2(vy, SPEED), Math.atan2(-vx, -vz), -0.12 * t.dir);
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.one));
      // Now and then a glide with the flippers still.
      const glide = Math.sin(time * 0.09 + t.seed * 3);
      this.anim.setXY(i, t.seed, glide > 0.75 ? 0.25 : 1);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
  }
}

/** A green turtle ~1 m long (head at −Z): patterned olive-brown shell, pale belly. */
function turtleGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const shellA = new THREE.Color('#5b4a2c');
  const shellB = new THREE.Color('#8a7442');
  const belly = new THREE.Color('#d8cfa0');
  const skin = new THREE.Color('#6f7a55');
  const c = new THREE.Color();
  // Shell: a domed oval with scute-like blotches; flat pale plastron underneath.
  b.addFn(
    new THREE.SphereGeometry(1, 16, 10).scale(0.36, 0.13, 0.48),
    (p) => {
      if (p.y < -0.02) return belly;
      const k = 0.5 + 0.5 * Math.sin(p.x * 26) * Math.sin(p.z * 22);
      return c.copy(shellA).lerp(shellB, k);
    },
    () => [0, 0],
  );
  b.add(new THREE.SphereGeometry(1, 10, 8).scale(0.09, 0.075, 0.12).translate(0, 0.01, -0.56), skin);
  for (const side of [-1, 1]) {
    // Front flipper: long, swept back. Rear: short paddle.
    b.addFn(
      flat([[side * 0.22, 0, -0.3], [side * 0.62, -0.01, -0.18], [side * 0.72, -0.02, -0.02], [side * 0.26, 0, -0.16]]),
      () => skin,
      (p) => [side * Math.min(1, Math.max(0, (Math.abs(p.x) - 0.2) / 0.52)), 1],
    );
    b.addFn(
      flat([[side * 0.16, 0, 0.36], [side * 0.36, -0.01, 0.48], [side * 0.22, -0.01, 0.56]]),
      () => skin,
      (p) => [side * Math.min(1, Math.max(0, (Math.abs(p.x) - 0.14) / 0.22)), 2],
    );
  }
  return b.build();
}
