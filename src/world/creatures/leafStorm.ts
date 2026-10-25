import * as THREE from 'three';
import { PartBuilder } from '../animals/parts';
import type { EmberSink } from './embers';

const MAX = 180;
/** Leaves thrown per second while it throws, and how fast they fly (m/s). */
const RATE = 70;
const SPEED = 5.5;
/** The spiral round the flight line: radius at the end (m) and turns per second. */
const SWIRL = 0.5;
const SPIN = 1.8;
/** The stream arches up this much (m) per 5 m of flight. */
const ARCH = 0.45;
/** Of the things thrown, the share that are flower petals (the rest are leaves). */
const PETALS = 0.28;
/** Falling: speed (m/s), the pendulum's swing (m/s) and rate (rad/s); longest flight + fall (s). */
const FALL = 0.5;
const SWING = 0.9;
const SWING_RATE = 3.2;
const LIFE = 8;
/** Lying on the grass after landing (s), the last part of it shrinking away. */
const REST = 2.5;
/** Of the leaves that land, the share that grow a cluster of flowers. */
const BLOOM_CHANCE = 0.3;
/** How near a leaf must pass the target (m) to count as a hit on it. */
const HIT_RADIUS = 0.6;
/** Sparkles shed by the flying stream, per second. */
const SPARKLES = 45;
/** Leaf tints (over the leaf's own greens) and petal colours. */
const LEAF_TINTS = ['#ffffff', '#f0ffd8', '#e2ffc4', '#fff4c2', '#d6f5d0'].map((c) => new THREE.Color(c));
const PETAL_TINTS = ['#ffb3cf', '#ffd6e6', '#ffffff', '#ffc2a8', '#f7b5ff'].map((c) => new THREE.Color(c));

/**
 * A leaf, 9 cm, along +Z: an almond outline folded a little along its midrib (a V), dark at the
 * stalk and lighter to the tip, the midrib paler.
 */
function leafGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const SEG = 7;
  const len = 0.09;
  const at = (i: number, side: number): [number, number, number] => {
    const t = i / SEG;
    const z = -len / 2 + t * len;
    const w = side * 0.024 * Math.pow(Math.sin(Math.PI * t), 0.75);
    // The fold: edges lifted, a slight curl down toward the tip.
    return [w, Math.abs(w) * 0.35 - 0.012 * t * t, z];
  };
  for (let i = 0; i < SEG; i++) {
    for (const s of [-1, 1]) {
      const a = at(i, 0);
      const b = at(i + 1, 0);
      const c = at(i + 1, s);
      const d = at(i, s);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const b = new PartBuilder();
  const base = new THREE.Color('#2f8a35');
  const tip = new THREE.Color('#8fdb5e');
  const rib = new THREE.Color('#c8f09a');
  b.addFn(
    g,
    (p) => {
      const c = base.clone().lerp(tip, (p.z + len / 2) / len);
      return Math.abs(p.x) < 0.0025 ? c.lerp(rib, 0.6) : c;
    },
    () => [0, 0],
  );
  return b.build();
}

/** A flower petal, 5 cm, along +Z: round, cupped, white (tinted per petal). */
function petalGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.addFn(
    new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.02, 0.008, 0.026),
    (p) => new THREE.Color('#fff2f6').lerp(new THREE.Color('#ffffff'), Math.min(1, Math.abs(p.z) / 0.026)),
    () => [0, 0],
  );
  return b.build();
}

/**
 * Mầm's "Leaf Blossom": a stream of leaves and petals thrown from its sprout toward a target. Each flies
 * along the line in a widening spiral that arches up, tumbling, shedding sparkles; at the end it
 * falls like a real leaf (a pendulum swing, tilting with it, carried by the wind), lies on the
 * grass a moment and fades; some landings grow a cluster of flowers (`onLand`). Two instanced
 * meshes (leaves, petals; two draw calls), one pool of MAX on the CPU (no allocation).
 */
export class LeafStorm {
  readonly mesh = new THREE.Group();
  private readonly leaves: THREE.InstancedMesh;
  private readonly petals: THREE.InstancedMesh;
  private left = 0;
  private debt = 0;
  private sparkleDebt = 0;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private hitTarget = false;
  private hitDone = false;
  // Per piece: its flight line (start, unit direction, length), spiral phase, age, mode
  // (0 flying, 1 falling, 2 lying), position, spin, size, petal or leaf, and when it landed.
  private readonly ox = new Float32Array(MAX);
  private readonly oy = new Float32Array(MAX);
  private readonly oz = new Float32Array(MAX);
  private readonly dx = new Float32Array(MAX);
  private readonly dy = new Float32Array(MAX);
  private readonly dz = new Float32Array(MAX);
  private readonly len = new Float32Array(MAX);
  private readonly phase = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly mode = new Uint8Array(MAX);
  private readonly px = new Float32Array(MAX);
  private readonly py = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  private readonly spin = new Float32Array(MAX);
  private readonly spinRate = new Float32Array(MAX);
  private readonly size = new Float32Array(MAX);
  private readonly petal = new Uint8Array(MAX);
  private readonly landedAt = new Float32Array(MAX);
  private next = 0;
  private live = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    private readonly heightAt: (x: number, z: number) => number,
    /** Wind now: strength 0..1 and direction (x, z), for the fall. */
    private readonly wind: () => { strength: number; x: number; y: number },
    /** A leaf landed on dry ground and may grow flowers there. */
    private readonly onLand: (x: number, y: number, z: number) => void,
    /** A leaf passed through the target (once per throw). */
    private readonly onHit: () => void,
    /** Sparkles along the stream. */
    private readonly sparkles: EmberSink,
  ) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    this.leaves = new THREE.InstancedMesh(leafGeometry(), mat, MAX);
    this.petals = new THREE.InstancedMesh(petalGeometry(), mat, MAX);
    for (const mesh of [this.leaves, this.petals]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < MAX; i++) {
        mesh.setMatrixAt(i, this.zero);
        mesh.setColorAt(i, LEAF_TINTS[0]);
      }
      this.mesh.add(mesh);
    }
    this.mesh.name = 'leaf-storm';
    this.mesh.visible = false;
  }

  get throwing(): boolean {
    return this.left > 0;
  }

  /** Throws for `duration` s toward (x, y, z); `hitTarget`: count a hit there. */
  fire(x: number, y: number, z: number, duration: number, hitTarget: boolean): void {
    this.aim(x, y, z);
    this.left = duration;
    this.hitTarget = hitTarget;
    this.hitDone = false;
  }

  aim(x: number, y: number, z: number): void {
    this.tx = x;
    this.ty = y;
    this.tz = z;
  }

  /** `o*`: where the stream leaves (world) this frame. */
  update(dt: number, ox: number, oy: number, oz: number): void {
    if (this.left > 0) {
      this.left -= dt;
      this.debt += dt * RATE;
      while (this.debt >= 1) {
        this.debt -= 1;
        this.launch(ox, oy, oz);
      }
    }
    if (!this.live) return;
    const w = this.wind();
    let any = false;
    let flying = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] === Infinity) continue;
      const a = (this.age[i] += dt);
      const mesh = this.petal[i] ? this.petals : this.leaves;
      let scale = this.size[i];
      if (this.mode[i] === 0) {
        flying++;
        this.spin[i] += this.spinRate[i] * dt;
        // Along the line, arching up, round it in a spiral that widens as it goes.
        const s = Math.min(this.len[i], a * SPEED);
        const k = s / Math.max(0.1, this.len[i]);
        const ang = this.phase[i] + a * SPIN * Math.PI * 2;
        const r = SWIRL * (0.12 + 0.88 * k);
        const arch = Math.sin(Math.PI * k) * ARCH * (this.len[i] / 5);
        // Two axes square to the line (it is never vertical here).
        const ul = Math.hypot(this.dz[i], this.dx[i]) || 1;
        const ux = -this.dz[i] / ul;
        const uz = this.dx[i] / ul;
        const vx = this.dy[i] * uz;
        const vy = this.dz[i] * ux - this.dx[i] * uz;
        const vz = -this.dy[i] * ux;
        const c = Math.cos(ang) * r;
        const sn = Math.sin(ang) * r;
        this.px[i] = this.ox[i] + this.dx[i] * s + ux * c + vx * sn;
        this.py[i] = this.oy[i] + this.dy[i] * s + vy * sn + arch;
        this.pz[i] = this.oz[i] + this.dz[i] * s + uz * c + vz * sn;
        if (this.hitTarget && !this.hitDone && Math.hypot(this.px[i] - this.tx, this.py[i] - this.ty, this.pz[i] - this.tz) < HIT_RADIUS) {
          this.hitDone = true;
          this.onHit();
        }
        if (s >= this.len[i] || this.py[i] < this.heightAt(this.px[i], this.pz[i])) this.mode[i] = 1;
        this.e.set(this.spin[i], this.spin[i] * 0.7, this.spin[i] * 0.45);
      } else if (this.mode[i] === 1) {
        // Falling like a real leaf: a pendulum swing side to side, tilting with it, drifting.
        const sw = Math.sin(a * SWING_RATE + this.phase[i]);
        const sideX = Math.cos(this.phase[i]);
        const sideZ = Math.sin(this.phase[i]);
        const swing = Math.cos(a * SWING_RATE + this.phase[i]) * SWING;
        this.px[i] += (sideX * swing + w.x * w.strength * 0.8) * dt;
        this.pz[i] += (sideZ * swing + w.y * w.strength * 0.8) * dt;
        // It drops fastest at the bottom of each swing and floats at its ends.
        this.py[i] -= FALL * (0.4 + 0.9 * (1 - Math.abs(sw))) * dt;
        const ground = this.heightAt(this.px[i], this.pz[i]);
        if (this.py[i] <= Math.max(0, ground) + 0.01) {
          this.py[i] = Math.max(0, ground) + 0.01;
          this.mode[i] = 2;
          this.landedAt[i] = a;
          if (ground > 0.05 && Math.random() < BLOOM_CHANCE) this.onLand(this.px[i], ground, this.pz[i]);
        } else if (a > LIFE) {
          this.retire(i, mesh);
          continue;
        }
        this.e.set(sw * 0.6, this.phase[i] + a * 0.4, sw * 0.5);
      } else {
        // Lying on the grass (or floating on the water), fading away at the end.
        const lying = a - this.landedAt[i];
        if (lying > REST) {
          this.retire(i, mesh);
          continue;
        }
        scale *= Math.min(1, (REST - lying) / 0.6);
        this.e.set(0, this.phase[i], 0);
      }
      this.q.setFromEuler(this.e);
      this.s.set(scale, scale, scale);
      mesh.setMatrixAt(i, this.m.compose(this.p.set(this.px[i], this.py[i], this.pz[i]), this.q, this.s));
      any = true;
    }
    // Sparkles in the stream: from random flying pieces.
    if (flying > 0) {
      this.sparkleDebt += dt * SPARKLES;
      let tries = 0;
      while (this.sparkleDebt >= 1 && tries++ < 400) {
        const i = Math.floor(Math.random() * MAX);
        if (this.age[i] === Infinity || this.mode[i] !== 0) continue;
        this.sparkleDebt -= 1;
        this.sparkles.emit(this.px[i], this.py[i], this.pz[i], (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3, 0.02 + Math.random() * 0.02);
      }
    }
    this.live = any || this.left > 0;
    this.mesh.visible = this.live;
    this.leaves.instanceMatrix.needsUpdate = true;
    this.petals.instanceMatrix.needsUpdate = true;
  }

  private retire(i: number, mesh: THREE.InstancedMesh): void {
    this.age[i] = Infinity;
    mesh.setMatrixAt(i, this.zero);
  }

  private launch(ox: number, oy: number, oz: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    // A reused slot: clear it from both meshes first.
    this.leaves.setMatrixAt(i, this.zero);
    this.petals.setMatrixAt(i, this.zero);
    let dx = this.tx - ox;
    let dy = this.ty - oy;
    let dz = this.tz - oz;
    const d = Math.max(0.3, Math.hypot(dx, dy, dz));
    dx /= d;
    dy /= d;
    dz /= d;
    this.ox[i] = ox;
    this.oy[i] = oy;
    this.oz[i] = oz;
    this.dx[i] = dx;
    this.dy[i] = dy;
    this.dz[i] = dz;
    this.len[i] = d * (0.8 + Math.random() * 0.4);
    this.phase[i] = Math.random() * Math.PI * 2;
    this.age[i] = 0;
    this.mode[i] = 0;
    this.spin[i] = Math.random() * 6;
    this.spinRate[i] = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 7);
    const isPetal = Math.random() < PETALS;
    this.petal[i] = isPetal ? 1 : 0;
    this.size[i] = isPetal ? 1.3 + Math.random() * 0.7 : 1.3 + Math.random() * 0.9;
    const mesh = isPetal ? this.petals : this.leaves;
    const tints = isPetal ? PETAL_TINTS : LEAF_TINTS;
    mesh.setColorAt(i, tints[Math.floor(Math.random() * tints.length)]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.live = true;
  }
}
