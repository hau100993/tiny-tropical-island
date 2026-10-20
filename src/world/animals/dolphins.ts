import * as THREE from 'three';
import { PartBuilder, animAttribute, animatedMaterial, flat } from './parts';
import { houseToWorld, type Placement } from '../layout';
import type { Rng } from '../../core/rng';
import type { SharedUniforms } from '../../core/uniforms';
import type { Spray } from '../../water/Spray';

const COUNT = 3;
/** Cruising speed along the route (m/s). */
const SPEED = 3.6;
/** Route: an ellipse in front of the house (house-local center and radii, m), seen from the desk. */
const ROUTE_CENTER = { x: 28, z: 112 };
const ROUTE_RADII = { x: 42, z: 18 };
/** Swimming depth between leaps, leap time and height above the water (m, s, m). */
const CRUISE_Y = -2.2;
const LEAP_SECONDS = 1.35;
const LEAP_HEIGHT = 1.1;
/** Seconds between leap series. */
const QUIET = [14, 34] as const;

/** Tail beat: `aPart.x` weights the vertices toward the flukes; they swing up and down. */
const MOTION = /* glsl */ `
float w = aPart.x;
transformed.y += w * w * 0.16 * sin(uTime * 4.5 + iAnim.x) * iAnim.y;
`;

/**
 * A pod of three dolphins cruising an ellipse off the house beach. Every half minute or so the
 * pod leaps: each dolphin two or three arcs out of the water, a little after the one before,
 * with a splash where it leaves and re-enters the sea.
 */
export class Dolphins {
  readonly mesh: THREE.InstancedMesh;
  private readonly anim: THREE.InstancedBufferAttribute;
  private readonly center: { x: number; z: number };
  private readonly cosR: number;
  private readonly sinR: number;
  /** Route parameter (radians around the ellipse). */
  private along = 0;
  private nextSeries: number;
  /** Per dolphin: leap start times of the current series, and whether it was above water. */
  private readonly leaps: number[][] = [[], [], []];
  private readonly wasUp = [false, false, false];
  private readonly lastY = [CRUISE_Y, CRUISE_Y, CRUISE_Y];
  private readonly offsets: Array<{ side: number; back: number; seed: number }>;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(
    private readonly rng: Rng,
    shared: SharedUniforms,
    house: Placement,
    private readonly spray: Spray,
  ) {
    const material = animatedMaterial(MOTION, shared.uTime, { roughness: 0.35 });
    this.mesh = new THREE.InstancedMesh(dolphinGeometry(), material, COUNT);
    this.mesh.name = 'dolphins';
    this.mesh.frustumCulled = false;
    this.anim = animAttribute(this.mesh);
    this.center = houseToWorld(house, ROUTE_CENTER.x, ROUTE_CENTER.z);
    // The ellipse's axes follow the house (its local X along the shore).
    this.cosR = Math.cos(house.rotY);
    this.sinR = Math.sin(house.rotY);
    this.offsets = [
      { side: 0, back: 0, seed: 0.3 },
      { side: 2.2, back: 3.2, seed: 2.1 },
      { side: -1.8, back: 5.5, seed: 4.4 },
    ];
    this.nextSeries = 6 + rng() * 10;
  }

  /** Position on the route at parameter t (world x, z) and its heading (unit). */
  private route(t: number, out: { x: number; z: number; hx: number; hz: number }): void {
    const lx = Math.cos(t) * ROUTE_RADII.x;
    const lz = Math.sin(t) * ROUTE_RADII.z;
    const dx = -Math.sin(t) * ROUTE_RADII.x;
    const dz = Math.cos(t) * ROUTE_RADII.z;
    const dl = Math.hypot(dx, dz) || 1;
    // House-local → world (same rotation as houseToWorld).
    out.x = this.center.x + lx * this.cosR + lz * this.sinR;
    out.z = this.center.z - lx * this.sinR + lz * this.cosR;
    out.hx = (dx * this.cosR + dz * this.sinR) / dl;
    out.hz = (-dx * this.sinR + dz * this.cosR) / dl;
  }

  private readonly at = { x: 0, z: 0, hx: 0, hz: 0 };

  update(dt: number, time: number, camera: THREE.Camera): void {
    // Constant speed along the ellipse: advance the parameter by arc length.
    this.route(this.along, this.at);
    const speedParam = Math.hypot(-Math.sin(this.along) * ROUTE_RADII.x, Math.cos(this.along) * ROUTE_RADII.z);
    this.along = (this.along + (SPEED * dt) / Math.max(1, speedParam)) % (Math.PI * 2);

    if (time > this.nextSeries || time < this.nextSeries - QUIET[1] - 20) {
      // A series: each dolphin 2–3 leaps, the followers a beat behind.
      for (let k = 0; k < COUNT; k++) {
        const n = 2 + Math.floor(this.rng() * 2);
        this.leaps[k] = [];
        for (let j = 0; j < n; j++) this.leaps[k].push(time + 0.5 * k + j * (LEAP_SECONDS + 0.9) + this.rng() * 0.3);
      }
      this.nextSeries = time + QUIET[0] + this.rng() * (QUIET[1] - QUIET[0]);
    }

    for (let k = 0; k < COUNT; k++) {
      const o = this.offsets[k];
      // Each dolphin a little behind and beside the leader, along the route.
      const lag = o.back / Math.max(1, speedParam);
      this.route(this.along - lag, this.at);
      const x = this.at.x + this.at.hz * o.side;
      const z = this.at.z - this.at.hx * o.side;
      let y = CRUISE_Y + 0.3 * Math.sin(time * 0.6 + o.seed);
      for (const t0 of this.leaps[k]) {
        const s = (time - t0) / LEAP_SECONDS;
        if (s < -0.6 || s > 1.4) continue;
        // Rise toward the surface before the jump and sink after it; the arc itself a parabola.
        // From just under the surface (−0.2 m) up to LEAP_HEIGHT and back.
        const arc = s >= 0 && s <= 1 ? (LEAP_HEIGHT + 0.2) * 4 * s * (1 - s) : 0;
        const ease = s < 0 ? 1 + s / 0.6 : s > 1 ? 1 - (s - 1) / 0.4 : 1;
        y = Math.max(y, CRUISE_Y + (-0.2 - CRUISE_Y) * ease * ease + arc);
      }
      const vy = (y - this.lastY[k]) / Math.max(1e-3, dt);
      this.lastY[k] = y;
      const up = y > 0;
      if (up !== this.wasUp[k]) {
        this.wasUp[k] = up;
        this.splash(x, z, camera, up ? 1 : 0.8);
      }
      const yaw = Math.atan2(-this.at.hx, -this.at.hz);
      const pitch = Math.atan2(vy, SPEED);
      this.e.set(pitch, yaw, 0.06 * Math.sin(time * 0.8 + o.seed));
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.mesh.setMatrixAt(k, this.m.compose(this.p, this.q, this.one));
      // Strong strokes before a leap, lazy ones cruising.
      this.anim.setXY(k, o.seed * 3, y > -1.2 ? 1 : 0.45);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
  }

  /** A burst of droplets where a dolphin breaks the surface (only near enough to see). */
  private splash(x: number, z: number, camera: THREE.Camera, size: number): void {
    if (camera.position.distanceTo(this.p.set(x, 0, z)) > 220) return;
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.4;
      const v = 1 + Math.random() * 2.5 * size;
      this.spray.drop(x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r, Math.cos(a) * v * 0.6, 1.5 + Math.random() * 3 * size, Math.sin(a) * v * 0.6, 0.02 + Math.random() * 0.03);
    }
  }
}

/** A bottlenose dolphin ~2.3 m long (beak at −Z), grey on top, pale below. */
function dolphinGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  // Body: revolved profile (radius along the length), then laid along Z and a bit narrower.
  const prof: Array<[number, number]> = [
    [0.0, -1.15], [0.03, -1.12], [0.05, -1.0], [0.07, -0.93], [0.15, -0.86], [0.19, -0.72],
    [0.23, -0.45], [0.24, -0.2], [0.21, 0.15], [0.15, 0.5], [0.08, 0.82], [0.045, 1.0], [0.0, 1.08],
  ];
  const body = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  body.rotateX(Math.PI / 2).scale(0.85, 1, 1);
  const top = new THREE.Color('#5d6b76');
  const belly = new THREE.Color('#d3dadd');
  const tmp = new THREE.Color();
  const tailW = (z: number): [number, number] => [Math.min(1, Math.max(0, (z - 0.15) / 1.1)), 0];
  b.addFn(body, (p) => tmp.copy(belly).lerp(top, Math.min(1, Math.max(0, p.y * 6 + 0.55))), (p) => tailW(p.z));
  // Dorsal fin (swept back), pectoral fins, flukes.
  b.addFn(flat([[0, 0.18, -0.15], [0, 0.48, 0.22], [0, 0.2, 0.25]]), () => top, (p) => tailW(p.z));
  for (const side of [-1, 1]) {
    b.addFn(flat([[side * 0.16, -0.08, -0.5], [side * 0.42, -0.22, -0.28], [side * 0.17, -0.1, -0.32]]), () => top, (p) => tailW(p.z));
    b.addFn(flat([[0, 0, 0.98], [side * 0.36, 0, 1.22], [side * 0.3, 0, 1.3], [0, 0, 1.18]]), () => top, (p) => tailW(p.z));
  }
  return b.build();
}
