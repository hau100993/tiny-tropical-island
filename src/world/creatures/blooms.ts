import * as THREE from 'three';
import { PartBuilder, flat } from '../animals/parts';

/** Flowers of each kind at most (the oldest gives way). */
const PER_KIND = 40;
/** Height of the flower head above the ground (m, before the flower's own scale). */
const HEAD = 0.17;
/** Radius of the ring the petals spring from (m). */
const RING = 0.006;
/** How far a closed petal is folded up from open (rad). */
const FOLD = 1.25;
/** Timeline (s): the stem grows; the petals open (from OPEN_AT, over OPEN); in bloom; wilting. */
const GROW = 0.6;
const OPEN_AT = 0.4;
const OPEN = 0.9;
const LIVE = 45;
const WILT = 2.2;
/** Petal colours: the tips take the colour, the bases stay pale. */
const TINTS = ['#ff7eb0', '#ffd23f', '#b07cff', '#ff6f61', '#7cc8ff', '#ffffff', '#ff9ad5', '#ffa94d'].map((c) => new THREE.Color(c));

type Kind = 'daisy' | 'round' | 'tulip';
const KINDS: Kind[] = ['daisy', 'round', 'tulip'];

/** Petal vertex colour: creamy at the base, white toward the tip (the tint multiplies it). */
function petalColour(p: THREE.Vector3): THREE.Color {
  const r = Math.hypot(p.x, p.z);
  return new THREE.Color('#fff6d8').lerp(new THREE.Color('#ffffff'), Math.min(1, r / 0.03));
}

/** The stem with two leaves, base at 0 (part 0: sways, never tinted). */
function addStem(b: PartBuilder): void {
  b.add(new THREE.CylinderGeometry(0.0045, 0.0065, HEAD, 6).translate(0, HEAD / 2, 0), '#3f8f3a');
  for (const [y, s] of [[0.05, 1], [0.09, -1]] as const) {
    b.addFn(
      flat([[0, y, 0], [s * 0.018, y + 0.012, 0.008], [s * 0.045, y + 0.022, 0], [s * 0.018, y + 0.006, -0.008]]),
      (p) => new THREE.Color('#3f9c3a').lerp(new THREE.Color('#7ccf55'), Math.min(1, Math.abs(p.x) / 0.045)),
      () => [0, 0],
    );
  }
}

/**
 * One kind of flower, all in one geometry: stem and leaves (part 0), petals (part 1, with the
 * petal's direction angle, for the vertex shader to unfold it), the heart (part 2, it swells as
 * the flower opens). Petals point along (cos a, 0, sin a).
 */
function flowerGeometry(kind: Kind): THREE.BufferGeometry {
  const b = new PartBuilder();
  addStem(b);
  const petal = (a: number, g: THREE.BufferGeometry): void => {
    // Built along +X, then turned so it points along (cos a, 0, sin a).
    g.translate(RING, 0, 0).rotateY(-a).translate(0, HEAD, 0);
    b.addFn(g, petalColour, () => [1, a]);
  };
  if (kind === 'daisy') {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      petal(a, new THREE.SphereGeometry(1, 6, 3).scale(0.032, 0.0035, 0.008).translate(0.03, 0, 0));
    }
    b.add(new THREE.SphereGeometry(1, 10, 6).scale(0.016, 0.009, 0.016).translate(0, HEAD + 0.003, 0), '#f6b80f', [2, 0]);
  } else if (kind === 'round') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      // Cupped a little: tipped up toward the edge.
      petal(a, new THREE.SphereGeometry(1, 8, 5).scale(0.026, 0.005, 0.02).rotateZ(0.25).translate(0.024, 0.006, 0));
    }
    b.add(new THREE.SphereGeometry(0.012, 8, 6).translate(0, HEAD + 0.004, 0), '#ffe08a', [2, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add(new THREE.SphereGeometry(0.0028, 4, 3).translate(Math.cos(a) * 0.009, HEAD + 0.012, Math.sin(a) * 0.009), '#c98a1b', [2, 0]);
    }
  } else {
    // Tulip: six tall petals standing up-and-out, a cup.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      petal(a, new THREE.SphereGeometry(1, 8, 6).scale(0.02, 0.006, 0.015).translate(0.018, 0, 0).rotateZ(1.05));
    }
    b.add(new THREE.SphereGeometry(0.007, 6, 4).translate(0, HEAD + 0.006, 0), '#ffe38a', [2, 0]);
  }
  return b.build();
}

/**
 * Per instance: iBloom = (open 0..1, sway phase, unused), iTint = petal colour. Petals unfold
 * about their base on the ring (Rodrigues' rotation about the ring's tangent); the heart swells
 * as they open; the whole flower bends in the wind, more toward the top. All in the vertex
 * shader, so blooming costs the CPU only a number per flower.
 */
function bloomMaterial(time: { value: number }, wind: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aPart;
attribute vec3 iBloom;
attribute vec3 iTint;
uniform float uTime;
uniform float uWind;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
#ifdef USE_COLOR
  // Only the petals take the flower's colour.
  vColor.rgb *= mix(vec3(1.0), iTint, step(0.5, aPart.x) * step(aPart.x, 1.5));
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float open = iBloom.x;
  vec3 c = vec3(0.0, ${HEAD.toFixed(3)}, 0.0);
  if (aPart.x > 0.5 && aPart.x < 1.5) {
    float a = aPart.y;
    vec3 axis = vec3(-sin(a), 0.0, cos(a));
    vec3 piv = c + vec3(cos(a), 0.0, sin(a)) * ${RING.toFixed(4)};
    float ang = (1.0 - open) * ${FOLD.toFixed(2)};
    vec3 v = transformed - piv;
    transformed = piv + v * cos(ang) + cross(axis, v) * sin(ang) + axis * dot(axis, v) * (1.0 - cos(ang));
  } else if (aPart.x > 1.5) {
    transformed = c + (transformed - c) * (0.35 + 0.65 * clamp(open, 0.0, 1.0));
  }
  // Bend in the wind, more toward the top.
  float h = clamp(transformed.y / ${HEAD.toFixed(3)}, 0.0, 1.3);
  float sw = sin(uTime * 1.7 + iBloom.y) * (0.01 + 0.03 * uWind) * h * h;
  transformed.x += sw;
  transformed.z += sw * 0.6;
}`,
      );
  };
  m.customProgramCacheKey = () => 'blooms';
  return m;
}

/**
 * Flowers that spring up where Mầm's leaves land (and round you when they hit you): three kinds
 * (daisy, round five-petal, tulip), each one instanced mesh (three draw calls for up to
 * 3 × PER_KIND flowers). A flower grows up out of the ground, then its petals unfold from a
 * closed bud (with a puff of pollen, `onOpen`), it sways in the wind, and after LIVE seconds its
 * petals close, it droops and wilts away. Instances are rewritten only while they change.
 */
export class Blooms {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly bloom: THREE.InstancedBufferAttribute[] = [];
  private readonly tint: THREE.InstancedBufferAttribute[] = [];
  private readonly n = KINDS.length * PER_KIND;
  private readonly x = new Float32Array(this.n);
  private readonly y = new Float32Array(this.n);
  private readonly z = new Float32Array(this.n);
  private readonly yaw = new Float32Array(this.n);
  private readonly size = new Float32Array(this.n);
  private readonly age = new Float32Array(this.n).fill(Infinity);
  private readonly opened = new Uint8Array(this.n);
  private readonly next = new Int32Array(KINDS.length);
  private live = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly tilt = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly side = new THREE.Vector3(1, 0, 0);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    time: { value: number },
    wind: { value: number },
    private readonly heightAt: (x: number, z: number) => number,
    /** A flower has just opened at (x, y, z) (its head): a puff of pollen there. */
    private readonly onOpen: (x: number, y: number, z: number) => void,
  ) {
    const mat = bloomMaterial(time, wind);
    for (const kind of KINDS) {
      const geo = flowerGeometry(kind);
      const bloom = new THREE.InstancedBufferAttribute(new Float32Array(PER_KIND * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(PER_KIND * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iBloom', bloom);
      geo.setAttribute('iTint', tint);
      const mesh = new THREE.InstancedMesh(geo, mat, PER_KIND);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < PER_KIND; i++) mesh.setMatrixAt(i, this.zero);
      this.meshes.push(mesh);
      this.bloom.push(bloom);
      this.tint.push(tint);
      this.group.add(mesh);
    }
    this.group.name = 'blooms';
    this.group.visible = false;
  }

  /** A small cluster (1–3 flowers, mostly of one kind and colour) round (x, z), on dry ground only. */
  spawnCluster(x: number, z: number, count = 1 + Math.floor(Math.random() * 3)): void {
    const kind = Math.floor(Math.random() * KINDS.length);
    const tint = TINTS[Math.floor(Math.random() * TINTS.length)];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 ? 0 : 0.08 + Math.random() * 0.14;
      const fx = x + Math.cos(a) * r;
      const fz = z + Math.sin(a) * r;
      const ground = this.heightAt(fx, fz);
      if (ground <= 0.05) continue;
      // Now and then one of another kind or colour, so a patch is not too neat.
      const k = Math.random() < 0.2 ? Math.floor(Math.random() * KINDS.length) : kind;
      const c = Math.random() < 0.2 ? TINTS[Math.floor(Math.random() * TINTS.length)] : tint;
      this.spawn(k, fx, ground, fz, c, i * 0.12);
    }
  }

  /** One flower of kind `k` at (x, groundY, z) in colour `c`, starting `delay` s late. */
  private spawn(k: number, x: number, groundY: number, z: number, c: THREE.Color, delay: number): void {
    const local = this.next[k];
    this.next[k] = (local + 1) % PER_KIND;
    const i = k * PER_KIND + local;
    this.x[i] = x;
    this.y[i] = groundY - 0.01;
    this.z[i] = z;
    this.yaw[i] = Math.random() * Math.PI * 2;
    this.size[i] = 1.2 + Math.random() * 0.9;
    this.age[i] = -delay;
    this.opened[i] = 0;
    this.tint[k].setXYZ(local, c.r, c.g, c.b);
    this.tint[k].needsUpdate = true;
    this.bloom[k].setXYZ(local, 0, Math.random() * 6.28, 0);
    // Hidden until it starts (a reused slot would show the old flower meanwhile).
    this.meshes[k].setMatrixAt(local, this.zero);
    this.meshes[k].instanceMatrix.needsUpdate = true;
    this.live++;
    this.group.visible = true;
  }

  update(dt: number): void {
    if (this.live === 0) return;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] === Infinity) continue;
      const a = (this.age[i] += dt);
      const k = Math.floor(i / PER_KIND);
      const local = i - k * PER_KIND;
      alive++;
      if (a < 0) continue;
      // Steady bloom: nothing changes on the CPU (the sway is in the shader).
      if (a > OPEN_AT + OPEN + 0.2 && a < OPEN_AT + OPEN + LIVE && a - dt > OPEN_AT + OPEN + 0.2) continue;
      let grow: number;
      let open: number;
      let droop = 0;
      if (a < OPEN_AT + OPEN + LIVE) {
        // Springs up with a little overshoot.
        const t = Math.min(1, a / GROW) - 1;
        grow = 1 + 2.2 * t * t * t + 1.2 * t * t;
        // Petals unfold, overshooting a touch, then settle.
        const o = Math.max(0, Math.min(1, (a - OPEN_AT) / OPEN));
        open = o < 1 ? o * o * (3 - 2 * o) * 1.08 : 1;
        if (a > OPEN_AT + OPEN * 0.85 && !this.opened[i]) {
          this.opened[i] = 1;
          this.onOpen(this.x[i], this.y[i] + HEAD * this.size[i], this.z[i]);
        }
      } else {
        // Wilting: petals close, the head droops, then it shrinks away.
        const w = (a - OPEN_AT - OPEN - LIVE) / WILT;
        if (w >= 1) {
          this.age[i] = Infinity;
          this.meshes[k].setMatrixAt(local, this.zero);
          this.meshes[k].instanceMatrix.needsUpdate = true;
          alive--;
          continue;
        }
        open = 1 - 0.7 * Math.min(1, w * 1.6);
        droop = w * 1.0;
        grow = w < 0.7 ? 1 : 1 - (w - 0.7) / 0.3;
      }
      this.bloom[k].setX(local, open);
      this.bloom[k].needsUpdate = true;
      this.p.set(this.x[i], this.y[i], this.z[i]);
      this.q.setFromAxisAngle(this.up, this.yaw[i]).multiply(this.tilt.setFromAxisAngle(this.side, droop));
      const s = this.size[i] * Math.max(0, grow);
      this.s.set(s, s, s);
      this.meshes[k].setMatrixAt(local, this.m.compose(this.p, this.q, this.s));
      this.meshes[k].instanceMatrix.needsUpdate = true;
    }
    this.live = alive;
    if (alive === 0) this.group.visible = false;
  }
}
