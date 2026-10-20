import * as THREE from 'three';
import { PartBuilder, animAttribute, animatedMaterial, flat } from './parts';
import type { Rng } from '../../core/rng';
import type { SharedUniforms } from '../../core/uniforms';

const COUNT = 14;
/** Airspeed (m/s) and gravity, for the bank angle in a turn: tan(bank) = v² / (g r). */
const SPEED = 8;
const G = 9.8;

/**
 * Wings fold around the body axis: `aPart.x` = side × span (0 at the root … 1 at the tip).
 * Gliding they hold a slight dihedral; flapping (`iAnim.y` → 1) they beat, the hand more.
 */
const MOTION = /* glsl */ `
float s = abs(aPart.x);
if (s > 0.0) {
  float side = sign(aPart.x);
  float beat = sin(uTime * 8.5 + iAnim.x);
  float ang = mix(0.1 + 0.03 * sin(uTime * 1.3 + iAnim.x), 0.7 * beat, iAnim.y);
  ang *= 1.0 + 0.7 * smoothstep(0.5, 1.0, s);
  float r = transformed.x * side;
  transformed.x = side * r * cos(ang);
  transformed.y += r * sin(ang);
}
`;

interface Gull {
  /** Circle center (angle around the island, distance), radius, height, speed sign, phase. */
  centerAngle: number;
  centerR: number;
  r: number;
  y: number;
  dir: number;
  phase: number;
  seed: number;
}

/**
 * Seagulls soaring in wide circles over the beaches and the near sea, banking into their turns,
 * now and then a few wing beats. Their circles drift slowly round the island. They go to roost
 * at night (shrink away at dusk, back at dawn).
 */
export class Seagulls {
  readonly mesh: THREE.InstancedMesh;
  private readonly gulls: Gull[] = [];
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    rng: Rng,
    private readonly shared: SharedUniforms,
    islandRadius: number,
  ) {
    const material = animatedMaterial(MOTION, shared.uTime, { side: THREE.DoubleSide, roughness: 0.8 });
    this.mesh = new THREE.InstancedMesh(gullGeometry(), material, COUNT);
    this.mesh.name = 'seagulls';
    this.mesh.frustumCulled = false;
    this.anim = animAttribute(this.mesh);
    // Three loose groups, each sharing a drifting center.
    for (let i = 0; i < COUNT; i++) {
      const group = i % 3;
      this.gulls.push({
        centerAngle: group * 2.1 + (rng() - 0.5) * 0.4,
        centerR: islandRadius * (0.85 + 0.35 * rng()),
        r: 18 + rng() * 26,
        y: 9 + rng() * 20,
        dir: rng() < 0.75 ? 1 : -1,
        phase: rng() * Math.PI * 2,
        seed: rng() * 100,
      });
    }
  }

  update(time: number): void {
    // Roost at night: shrink away when it gets dark.
    const present = 1 - smoothstep(0.45, 0.8, this.shared.uNight.value);
    this.mesh.visible = present > 0.01;
    if (!this.mesh.visible) return;
    for (let i = 0; i < COUNT; i++) {
      const g = this.gulls[i];
      const ca = g.centerAngle + time * 0.004;
      const cx = Math.cos(ca) * g.centerR;
      const cz = Math.sin(ca) * g.centerR;
      const w = (SPEED / g.r) * g.dir;
      const a = g.phase + time * w;
      // The circle breathes a little so the paths don't look drawn with a compass.
      const r = g.r * (1 + 0.12 * Math.sin(time * 0.05 + g.seed));
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = g.y + 2.5 * Math.sin(time * 0.11 + g.seed);
      // Heading: the circle's tangent; yaw so local −Z (the beak) points along it.
      const vx = -Math.sin(a) * g.dir;
      const vz = Math.cos(a) * g.dir;
      const yaw = Math.atan2(-vx, -vz);
      // Bank into the turn: the center is on the right when it lies along local +X.
      const rightX = Math.cos(yaw);
      const rightZ = -Math.sin(yaw);
      const inward = -(Math.cos(a) * rightX + Math.sin(a) * rightZ);
      const bank = Math.atan((SPEED * SPEED) / (G * r));
      this.e.set(0.05 * Math.cos(time * 0.11 + g.seed), yaw, -bank * Math.sign(inward));
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.s.setScalar(present);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
      // Bursts of flapping now and then (two slow sines make an irregular rhythm).
      const f = Math.sin(time * 0.37 + g.seed) + Math.sin(time * 0.23 + g.seed * 1.7);
      this.anim.setXY(i, g.seed, smoothstep(0.9, 1.4, f));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A gull ~0.45 m long with a 1.3 m span; beak at −Z. Slightly larger than life to read from afar. */
function gullGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const white = '#f4f4f0';
  b.add(new THREE.SphereGeometry(1, 10, 7).scale(0.085, 0.085, 0.25), white);
  b.add(new THREE.SphereGeometry(0.065, 8, 6).translate(0, 0.045, -0.25), white);
  b.add(new THREE.ConeGeometry(0.018, 0.09, 5).rotateX(-Math.PI / 2).translate(0, 0.035, -0.34), '#e8b93a');
  b.add(flat([[0, 0.01, 0.18], [-0.09, 0, 0.4], [0.09, 0, 0.4]]), white);
  // Wings: inner arm and pointed hand; grey above, black tips.
  for (const side of [-1, 1]) {
    const pts: Array<[number, number, number]> = [
      [side * 0.04, 0.02, -0.08],
      [side * 0.35, 0.02, -0.11],
      [side * 0.66, 0.02, 0.06],
      [side * 0.45, 0.02, 0.12],
      [side * 0.04, 0.02, 0.12],
    ];
    const grey = new THREE.Color('#a7afb7');
    const black = new THREE.Color('#2b2b2b');
    b.addFn(
      flat(pts),
      (p) => (Math.abs(p.x) > 0.5 ? black : grey),
      (p) => [side * Math.min(1, Math.abs(p.x) / 0.66), 0],
    );
  }
  return b.build();
}
