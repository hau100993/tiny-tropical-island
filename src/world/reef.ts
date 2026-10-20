import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightmap } from './heightmap';
import { patchWorldMaterial, type CausticsUniforms } from './patchMaterial';
import { addCoralDetail, CoralKind } from './coralShader';
import type { SharedUniforms } from '../core/uniforms';
import { createRng, randRange, type Rng } from '../core/rng';

/**
 * The reef around the island, for diving. Reef rocks ("bommies": low mounds crusted with
 * coralline algae) carry most of the corals, the rest spreads over the sand around them:
 * brain, staghorn, table corals, sea fans (nets), tube sponges, sea anemones and soft corals
 * (both swaying), starfish and urchins, seagrass meadows, seaweed, rubble and shells, and
 * schools of fish. Surface detail is painted in the shader (see coralShader.ts).
 *
 * All instanced: one draw call per kind. Corals get the caustic light like the seabed; soft
 * things sway in their vertex shader; fish swim in theirs (circling their school's center,
 * tails beating), so the CPU does nothing per frame.
 *
 * Placement: clusters between 2 and 8 m deep, most of them off the beach by the house.
 */
export interface Reef {
  group: THREE.Group;
  /** How many of each kind were placed (for tests and the stats). */
  counts: Record<string, number>;
  /** Seabed height including the reef rocks (for anything that must stay above them). */
  floorAt(x: number, z: number): number;
}

const PALETTES = {
  bommie: ['#7d7468', '#8a7d70', '#6f6a62'],
  brain: ['#c9a24a', '#a8b860', '#d98c6a', '#9f86c6', '#7fae6e'],
  staghorn: ['#e88aa4', '#a173d8', '#e6b24c', '#62c3b8', '#d9c9a0'],
  table: ['#86b892', '#c9a37c', '#b8c27e', '#7fa3b8'],
  fan: ['#b04fd8', '#e4566c', '#f08a3c', '#e8c33a'],
  tube: ['#eaa83a', '#c84592', '#5aa0d8', '#8b5cc6'],
  anemone: ['#d9b8e8', '#f2c6a0', '#a8e0c8', '#f0a0b8'],
  soft: ['#f29ab0', '#f2d27a', '#c79ae8', '#f5a65b'],
  star: ['#f07a2a', '#d63a3a', '#3a6fd6'],
  urchin: ['#2a1f3a', '#3b2030'],
  rubble: ['#d8d0c0', '#c9b9a8', '#e3c9c9', '#b8b0a4'],
  seagrass: ['#6f9d3a', '#8aa83c', '#5d8b4a'],
  seaweed: ['#5f9d4a', '#8aa83c', '#4f8b5f', '#9a8a3a'],
} as const;
type ReefKind = keyof typeof PALETTES;

const v3 = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/** Merge parts (indexed or not) into one non-indexed geometry with position + normal only. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    return g;
  });
  const g = mergeGeometries(flat, false);
  if (!g) throw new Error('reef: merge failed');
  return g;
}

/** Brain coral: a low dome with bulging lobes. ~1 m across. The grooves are in the shader. */
function brainGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 13, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i);
    const a = Math.atan2(v3.z, v3.x);
    v3.multiplyScalar(1 + 0.06 * Math.sin(a * 3 + v3.y * 4) + 0.03 * Math.sin(a * 7 - v3.y * 9));
    v3.y *= 0.7;
    p.setXYZ(i, v3.x, v3.y, v3.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Staghorn: tapering branches forking upward, rounded tips. ~0.9 m tall. */
function staghornGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number): void => {
    const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, 5, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(from.x, from.y, from.z);
    parts.push(g);
    const end = from.clone().addScaledVector(dir, len);
    if (depth >= 3) {
      parts.push(new THREE.OctahedronGeometry(rad * 0.8, 0).translate(end.x, end.y, end.z));
      return;
    }
    const n = depth === 0 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 1.2;
      const tilt = 0.35 + rng() * 0.45;
      const d = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).lerp(dir, 0.35).normalize();
      branch(end, d, len * (0.72 + rng() * 0.2), rad * 0.7, depth + 1);
    }
  };
  branch(new THREE.Vector3(0, -0.05, 0), up.clone(), 0.26, 0.07, 0);
  return merge(parts);
}

/** Table coral: a wide plate with a raised, wavy rim, on a short stalk. */
function tableGeometry(): THREE.BufferGeometry {
  const plate = new THREE.CylinderGeometry(0.6, 0.5, 0.06, 22, 1);
  const p = plate.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i);
    const r = Math.hypot(v3.x, v3.z);
    const a = Math.atan2(v3.z, v3.x);
    v3.y += 0.06 * (r / 0.6) ** 2 + 0.02 * Math.sin(a * 5) * (r / 0.6);
    p.setXYZ(i, v3.x, v3.y, v3.z);
  }
  plate.computeVertexNormals();
  plate.translate(0, 0.42, 0);
  const stalk = new THREE.CylinderGeometry(0.06, 0.12, 0.42, 7).translate(0, 0.21, 0);
  return merge([plate, stalk]);
}

/** Sea fan: an irregular, wavy half disc on a short stem; the shader cuts it into a net. */
function fanGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(0.5, 24, 0, Math.PI);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    const k = 1 + 0.12 * Math.sin(a * 4 + 1);
    p.setXYZ(i, x * k * 1.1, y * k, 0.06 * Math.sin(x * 9) * r);
  }
  g.computeVertexNormals();
  const stem = new THREE.CylinderGeometry(0.012, 0.02, 0.1, 5).translate(0, 0.0, 0);
  return merge([g, stem]);
}

/** Tube sponges: a few open, slightly flared tubes of different heights. */
function tubeGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const h = randRange(rng, 0.3, 0.75);
    const r = randRange(rng, 0.05, 0.09);
    parts.push(new THREE.CylinderGeometry(r * 1.15, r * 0.8, h, 10, 2, true).translate(randRange(rng, -0.15, 0.15), h / 2, randRange(rng, -0.15, 0.15)));
  }
  return merge(parts);
}

/** Sea anemone: a short column with a crown of tentacles (they sway). */
function anemoneGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.16, 0.18, 0.12, 12, 1).translate(0, 0.06, 0)];
  for (let k = 0; k < 30; k++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.15;
    const len = randRange(rng, 0.12, 0.22);
    const d = new THREE.Vector3(Math.cos(a) * r * 2.2, 1, Math.sin(a) * r * 2.2).normalize();
    const c = new THREE.CylinderGeometry(0.005, 0.013, len, 5, 1, true).translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    parts.push(c.translate(Math.cos(a) * r, 0.11, Math.sin(a) * r));
  }
  return merge(parts);
}

/** Soft coral: a fleshy stalk branching into puffs of polyps (sways a little). */
function softGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.05, 0.08, 0.25, 7).translate(0, 0.12, 0)];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + rng();
    const tilt = randRange(rng, 0.3, 0.8);
    const d = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    const len = randRange(rng, 0.15, 0.3);
    const arm = new THREE.CylinderGeometry(0.025, 0.04, len, 5, 1, true).translate(0, len / 2, 0);
    arm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    arm.translate(0, 0.22, 0);
    parts.push(arm);
    const tip = d.clone().multiplyScalar(len).add(new THREE.Vector3(0, 0.22, 0));
    for (let j = 0; j < 2; j++) {
      parts.push(new THREE.IcosahedronGeometry(randRange(rng, 0.05, 0.075), 0).translate(tip.x + randRange(rng, -0.04, 0.04), tip.y + randRange(rng, 0, 0.05), tip.z + randRange(rng, -0.04, 0.04)));
    }
  }
  return merge(parts);
}

/** Starfish: a flat five-armed star. ~0.25 m. */
function starGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.13 : 0.045;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.012, 0);
  return merge([g]);
}

/** Sea urchin: a dark ball with spines. */
function urchinGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.IcosahedronGeometry(0.06, 1)];
  for (let k = 0; k < 18; k++) {
    const d = new THREE.Vector3(rng() - 0.5, rng() * 0.8, rng() - 0.5).normalize();
    const c = new THREE.ConeGeometry(0.006, 0.16, 3).translate(0, 0.08, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    parts.push(c);
  }
  const g = merge(parts);
  g.translate(0, 0.04, 0);
  return g;
}

/** Smooth 3D value noise in 0..1 (for shaping rocks; build time only). */
function noise3(x: number, y: number, z: number, seed: number): number {
  const h = (i: number, j: number, k: number): number => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + seed * 19.3) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number): number => t * t * (3 - 2 * t);
  const u = f(x - xi);
  const v = f(y - yi);
  const w = f(z - zi);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Reef rock: a lumpy, flattened mound (unit radius, unit height before scaling). */
function bommieGeometry(rng: Rng): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.getAttribute('position');
  const sd = rng() * 100;
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i);
    // Knobbly: big lobes, smaller boulders, rough grain.
    const n =
      0.55 +
      0.7 * noise3(v3.x * 1.6, v3.y * 1.6, v3.z * 1.6, sd) +
      0.3 * noise3(v3.x * 4, v3.y * 4, v3.z * 4, sd + 1) +
      0.1 * noise3(v3.x * 10, v3.y * 10, v3.z * 10, sd + 2);
    v3.multiplyScalar(n);
    // Flat bottom sunk into the sand.
    v3.y = Math.max(v3.y, -0.3);
    p.setXYZ(i, v3.x, v3.y, v3.z);
  }
  // Weld the faces back together for smooth normals (a weathered rock, not a cut gem).
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const welded = mergeVertices(g);
  welded.computeVertexNormals();
  return merge([welded]);
}

/** Rubble and shells: small flattened stones. */
function rubbleGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.05, 0);
  g.scale(1.3, 0.5, 1);
  return merge([g]);
}

/** A blade of seagrass or seaweed (1 m tall before scaling); width in meters. */
function bladeGeometry(width: number, rows: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, 1, 1, rows).translate(0, 0.5, 0);
  // Taper to a point.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - 0.8 * p.getY(i)));
  return merge([g]);
}

const FISH_VERT = /* glsl */ `
attribute vec3 iCenter;  // school center
attribute vec4 iSwim;    // radius, angular speed (rad/s, signed), phase, length (m)
attribute vec3 iOffset;  // place in the school (right, up, along)
attribute vec3 iColor;
attribute vec3 iColor2;
uniform float uTime;
varying vec3 vColor;
varying vec3 vColor2;
varying vec3 vNormalW;
varying vec3 vLocal;
#include <fog_pars_vertex>
void main() {
  float a = iSwim.z + uTime * iSwim.y;
  float r = iSwim.x;
  // Heading along the circle (tangent), the direction of travel.
  vec3 dir = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(iSwim.y));
  vec3 right = vec3(-dir.z, 0.0, dir.x);
  // Each fish weaves a little around its place in the school.
  float wob = iSwim.z * 13.0 + iOffset.x * 3.1;
  vec3 c = iCenter + vec3(cos(a) * r, 0.35 * sin(uTime * 0.27 + iSwim.z), sin(a) * r);
  c += right * (iOffset.x + 0.15 * sin(uTime * 0.9 + wob)) + vec3(0.0, iOffset.y + 0.1 * sin(uTime * 1.3 + wob), 0.0) + dir * iOffset.z;
  // The body bends: the tail half swings side to side (faster for small fish).
  vec3 p = position;
  float beat = sin(uTime * (14.0 - 20.0 * iSwim.w) + wob - p.z * 6.0);
  p.x += beat * 0.12 * smoothstep(-0.1, 0.6, p.z);
  p *= iSwim.w;
  vLocal = position;
  // Local −Z is the nose: world = right·x + up·y − dir·z.
  vec3 w = c + right * p.x + vec3(0.0, p.y, 0.0) - dir * p.z;
  vNormalW = normalize(right * normal.x + vec3(0.0, normal.y, 0.0) - dir * normal.z);
  vColor = iColor;
  vColor2 = iColor2;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FISH_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uDayLight;
varying vec3 vColor;
varying vec3 vColor2;
varying vec3 vNormalW;
varying vec3 vLocal;
#include <fog_pars_fragment>
void main() {
  vec3 n = normalize(vNormalW);
  // Stripes across the body, a paler belly.
  float stripe = step(0.62, fract(vLocal.z * 3.2 + 0.3));
  vec3 base = mix(vColor, vColor2, stripe);
  base = mix(base, vec3(0.9), smoothstep(0.0, -0.3, vLocal.y) * 0.35);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  vec3 light = vec3(0.35, 0.5, 0.55) + uSunColor * diff * 0.9;
  // A silvery sheen on top.
  light += vec3(0.25) * pow(max(n.y, 0.0), 4.0);
  vec3 col = base * light * (0.06 + 0.94 * uDayLight);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Fish body: a slim ellipsoid (nose at −Z) with a forked tail fin, 1 m long before scaling. */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 10, 7);
  body.scale(0.2, 0.42, 1);
  const tail = new THREE.BufferGeometry();
  const t = [0, 0, 0.42, 0, 0.26, 0.72, 0, 0.0, 0.58, 0, 0, 0.42, 0, 0.0, 0.58, 0, -0.26, 0.72];
  tail.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
  tail.computeVertexNormals();
  const dorsal = new THREE.BufferGeometry();
  dorsal.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.18, -0.15, 0, 0.36, 0.1, 0, 0.18, 0.25], 3));
  dorsal.computeVertexNormals();
  const b = body.toNonIndexed();
  b.deleteAttribute('uv');
  const g = mergeGeometries([b, tail, dorsal], false);
  if (!g) throw new Error('reef: fish merge failed');
  return g;
}

interface Spot {
  x: number;
  z: number;
  y: number;
}

/** A point on the seabed `depth` m deep at `angle` from the island center (the outermost one). */
function seabedAt(hm: Heightmap, angle: number, depth: number): Spot {
  const r = hm.shoreDistance(angle, -depth);
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  return { x, z, y: hm.heightAt(x, z) };
}

export function createReef(hm: Heightmap, seed: number, shared: SharedUniforms, caustics: CausticsUniforms, houseAngle: number): Reef {
  const rng = createRng(seed);
  const group = new THREE.Group();
  group.name = 'reef';
  const counts: Record<string, number> = {};

  // Cluster centers: most off the house beach (the diving spot), some all round the island.
  // Most clusters grow on a reef rock: a low mound the corals crowd onto.
  interface Mound {
    x: number;
    z: number;
    y: number;
    r: number;
    h: number;
  }
  const clusters: Spot[] = [];
  const mounds: Mound[] = [];
  for (let i = 0; i < 46; i++) {
    const near = i < 28;
    const a = near ? houseAngle + randRange(rng, -0.75, 0.75) : rng() * Math.PI * 2;
    const c = seabedAt(hm, a, randRange(rng, 2.6, 8));
    clusters.push(c);
    if (rng() < 0.75) mounds.push({ x: c.x, z: c.z, y: c.y, r: randRange(rng, 1.2, 2.6), h: Math.min(randRange(rng, 0.8, 1.7), -c.y - 1.6) });
  }
  /** Seabed with the reef rocks on it (their smooth dome, a little under the lumpy mesh). */
  const floorAt = (x: number, z: number): number => {
    let y = hm.heightAt(x, z);
    for (const m of mounds) {
      const d = Math.hypot(x - m.x, z - m.z) / m.r;
      if (d < 1) y = Math.max(y, m.y + m.h * 0.88 * Math.sqrt(1 - d * d));
    }
    return y;
  };

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();
  const pick = (kind: ReefKind): THREE.Color => {
    const pal = PALETTES[kind];
    return color.set(pal[Math.floor(rng() * pal.length)]).multiplyScalar(randRange(rng, 0.85, 1.1));
  };
  const material = (kind: CoralKind, sway = 0, roughness = 0.85): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ roughness, side: THREE.DoubleSide });
    patchWorldMaterial(m, { caustics }, shared);
    addCoralDetail(m, kind, sway);
    return m;
  };
  const add = (name: string, geo: THREE.BufferGeometry, mat: THREE.Material, n: number, place: (i: number) => void): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
      place(i);
      mesh.setMatrixAt(i, m4.compose(pos, q, s));
      mesh.setColorAt(i, color);
    }
    mesh.name = `reef-${name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Swaying instances move outside their bounds; the reef is small, never cull it.
    mesh.frustumCulled = false;
    group.add(mesh);
    counts[name] = n;
    return mesh;
  };

  // Reef rocks.
  add('bommie', bommieGeometry(createRng(seed + 4)), material(CoralKind.bommie, 0, 0.95), mounds.length, (i) => {
    const m = mounds[i];
    pos.set(m.x, m.y, m.z);
    q.setFromEuler(e.set(0, rng() * Math.PI * 2, 0));
    s.set(m.r, m.h, m.r * randRange(rng, 0.8, 1.1));
    pick('bommie');
  });

  /** Spots for one kind: `onRock` of them on the reef rocks, the rest on the sand around. */
  const spots = (perCluster: number, onRock: number, minDepth = 1.4): Spot[] => {
    const list: Spot[] = [];
    for (const c of clusters) {
      const mound = mounds.find((m) => m.x === c.x && m.z === c.z);
      const n = Math.round(perCluster * randRange(rng, 0.6, 1.6));
      for (let k = 0; k < n; k++) {
        let x: number;
        let z: number;
        if (mound && rng() < onRock) {
          const a = rng() * Math.PI * 2;
          const r = Math.sqrt(rng()) * mound.r * 0.85;
          x = mound.x + Math.cos(a) * r;
          z = mound.z + Math.sin(a) * r;
        } else {
          x = c.x + randRange(rng, -4.5, 4.5);
          z = c.z + randRange(rng, -4.5, 4.5);
        }
        const y = floorAt(x, z);
        if (y > -minDepth || y < -11) continue;
        list.push({ x, z, y });
      }
    }
    return list;
  };

  // Corals: kind, per cluster, share on the rocks, scale range, sway, how it stands.
  const corals: Array<[ReefKind, CoralKind, THREE.BufferGeometry, number, number, number, number, number]> = [
    ['brain', CoralKind.brain, brainGeometry(), 4, 0.8, 0.4, 1.2, 0],
    ['staghorn', CoralKind.staghorn, staghornGeometry(createRng(seed + 1)), 4, 0.8, 0.6, 1.3, 0],
    ['table', CoralKind.table, tableGeometry(), 1.2, 0.6, 0.6, 1.4, 0],
    ['fan', CoralKind.fan, fanGeometry(), 2, 0.6, 0.6, 1.3, 0.05],
    ['tube', CoralKind.tube, tubeGeometry(createRng(seed + 2)), 2.5, 0.6, 0.7, 1.3, 0],
    ['anemone', CoralKind.anemone, anemoneGeometry(createRng(seed + 5)), 1.5, 0.85, 0.8, 1.5, 0.18],
    ['soft', CoralKind.soft, softGeometry(createRng(seed + 6)), 3, 0.8, 0.7, 1.4, 0.08],
    ['star', CoralKind.star, starGeometry(), 2, 0.2, 0.7, 1.4, 0],
    ['urchin', CoralKind.urchin, urchinGeometry(createRng(seed + 3)), 2, 0.4, 0.8, 1.4, 0],
  ];
  for (const [name, kind, geo, per, onRock, s0, s1, sway] of corals) {
    const list = spots(per, onRock);
    const mat = material(kind, sway, name === 'urchin' ? 0.6 : 0.85);
    add(name, geo, mat, list.length, (i) => {
      const p = list[i];
      const k = randRange(rng, s0, s1);
      // Corals grow upright (a little leaning); fans stand across the current.
      const lean = name === 'star' || name === 'urchin' ? 0.05 : 0.15;
      e.set(randRange(rng, -lean, lean), rng() * Math.PI * 2, randRange(rng, -lean, lean));
      q.setFromEuler(e);
      s.set(k, k * (name === 'brain' ? randRange(rng, 0.7, 1.2) : 1), k);
      pos.set(p.x, p.y - 0.03 * k, p.z);
      pick(name);
    });
  }

  // Seagrass meadows on the sand between the reefs, seaweed clumps on and around them.
  {
    const meadow: Spot[] = [];
    for (let i = 0; i < 26; i++) {
      const a = i < 16 ? houseAngle + randRange(rng, -0.9, 0.9) : rng() * Math.PI * 2;
      const c = seabedAt(hm, a, randRange(rng, 1.6, 4.5));
      for (let k = 0; k < 60; k++) {
        const r = Math.sqrt(rng()) * 3.5;
        const t = rng() * Math.PI * 2;
        const x = c.x + Math.cos(t) * r;
        const z = c.z + Math.sin(t) * r;
        const y = hm.heightAt(x, z);
        // Sand only (not on the reef rocks).
        if (y > -1.3 || y < -6 || floorAt(x, z) > y + 0.02) continue;
        meadow.push({ x, z, y });
      }
    }
    add('seagrass', bladeGeometry(0.035, 4), material(CoralKind.seagrass, 0.12, 0.7), meadow.length, (i) => {
      const p = meadow[i];
      pos.set(p.x, p.y - 0.02, p.z);
      q.setFromEuler(e.set(randRange(rng, -0.2, 0.2), rng() * Math.PI, randRange(rng, -0.2, 0.2)));
      s.set(1, randRange(rng, 0.25, 0.55), 1);
      pick('seagrass');
    });
    const weed: Array<Spot & { h: number }> = [];
    for (let i = 0; i < 60; i++) {
      const c = i < 40 ? clusters[i % clusters.length] : seabedAt(hm, rng() * Math.PI * 2, randRange(rng, 1.5, 6));
      const cx = c.x + randRange(rng, -5, 5);
      const cz = c.z + randRange(rng, -5, 5);
      for (let k = 0; k < 8; k++) {
        const x = cx + randRange(rng, -0.6, 0.6);
        const z = cz + randRange(rng, -0.6, 0.6);
        const y = floorAt(x, z);
        if (y > -1.2 || y < -10) continue;
        weed.push({ x, z, y, h: Math.min(-y - 0.4, randRange(rng, 0.5, 1.6)) });
      }
    }
    add('seaweed', bladeGeometry(0.07, 8), material(CoralKind.seagrass, 0.16, 0.7), weed.length, (i) => {
      const p = weed[i];
      q.setFromEuler(e.set(randRange(rng, -0.1, 0.1), rng() * Math.PI, randRange(rng, -0.1, 0.1)));
      pos.set(p.x, p.y - 0.05, p.z);
      s.set(randRange(rng, 0.8, 1.5), p.h, 1);
      pick('seaweed');
    });
  }

  // Rubble and shells scattered over the sand around the reefs.
  {
    const list: Spot[] = [];
    for (const c of clusters) {
      for (let k = 0; k < 16; k++) {
        const x = c.x + randRange(rng, -6, 6);
        const z = c.z + randRange(rng, -6, 6);
        const y = floorAt(x, z);
        if (y > -1.3) continue;
        list.push({ x, z, y });
      }
    }
    add('rubble', rubbleGeometry(), material(CoralKind.star, 0, 0.9), list.length, (i) => {
      const p = list[i];
      pos.set(p.x, p.y, p.z);
      q.setFromEuler(e.set(randRange(rng, -0.3, 0.3), rng() * Math.PI * 2, randRange(rng, -0.3, 0.3)));
      const k = randRange(rng, 0.5, 2);
      s.set(k, k, k);
      pick('rubble');
    });
  }

  // Fish: schools circling over the reef, a few small groups close to the corals.
  {
    const centers: Array<{ c: Spot; r: number; n: number; size: number; colors: [string, string]; spread: number }> = [];
    const schoolColors: Array<[string, string]> = [
      ['#f2d23a', '#f2d23a'], // yellow tang
      ['#3a7fe0', '#f2d23a'], // blue and yellow
      ['#c8d4dc', '#7f8e99'], // silver
      ['#f07a2a', '#ffffff'], // clownfish
      ['#2fb5c8', '#1d5b8c'], // blue-green
      ['#e04a6a', '#f2b0c0'], // pink
    ];
    for (let i = 0; i < 14; i++) {
      const big = i < 6;
      const a = i < 10 ? houseAngle + randRange(rng, -0.8, 0.8) : rng() * Math.PI * 2;
      const bed = seabedAt(hm, a, big ? randRange(rng, 4, 9) : randRange(rng, 2.5, 6));
      // A circle that stays in water deep enough for the whole school.
      let r = big ? randRange(rng, 4, 8) : randRange(rng, 1.2, 2.5);
      const spread = big ? 1.6 : 0.6;
      // Highest seabed under the circle (and the school's width around it).
      let top = bed.y;
      for (let tries = 0; tries < 6; tries++) {
        top = bed.y;
        for (let k = 0; k < 16; k++) {
          const t = (k / 16) * Math.PI * 2;
          for (const rr of [r - spread, r, r + spread]) top = Math.max(top, floorAt(bed.x + Math.cos(t) * rr, bed.z + Math.sin(t) * rr));
        }
        if (top < -2) break;
        r *= 0.7;
      }
      // Above the reef all the way round, still under the surface.
      const y = Math.min(-0.9, top + spread * 0.4 + (big ? randRange(rng, 1, 2) : randRange(rng, 0.5, 0.9)));
      centers.push({
        c: { x: bed.x, z: bed.z, y },
        r,
        n: big ? 18 + Math.floor(rng() * 14) : 4 + Math.floor(rng() * 4),
        size: big ? randRange(rng, 0.26, 0.4) : randRange(rng, 0.2, 0.32),
        colors: schoolColors[Math.floor(rng() * schoolColors.length)],
        spread,
      });
    }
    const total = centers.reduce((n, c) => n + c.n, 0);
    const geo = new THREE.InstancedBufferGeometry();
    const base = fishGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    const iCenter = new Float32Array(total * 3);
    const iSwim = new Float32Array(total * 4);
    const iOffset = new Float32Array(total * 3);
    const iColor = new Float32Array(total * 3);
    const iColor2 = new Float32Array(total * 3);
    let f = 0;
    for (const sc of centers) {
      const speed = (rng() < 0.5 ? -1 : 1) * randRange(rng, 0.35, 0.7) / sc.r;
      const phase = rng() * Math.PI * 2;
      const c1 = new THREE.Color(sc.colors[0]);
      const c2 = new THREE.Color(sc.colors[1]);
      for (let k = 0; k < sc.n; k++, f++) {
        iCenter.set([sc.c.x, sc.c.y, sc.c.z], f * 3);
        iSwim.set([sc.r, speed, phase, sc.size * randRange(rng, 0.85, 1.15)], f * 4);
        iOffset.set([randRange(rng, -1, 1) * sc.spread * 0.6, randRange(rng, -0.5, 0.5) * sc.spread * 0.5, randRange(rng, -1, 1) * sc.spread], f * 3);
        iColor.set([c1.r, c1.g, c1.b], f * 3);
        iColor2.set([c2.r, c2.g, c2.b], f * 3);
      }
    }
    geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(iCenter, 3));
    geo.setAttribute('iSwim', new THREE.InstancedBufferAttribute(iSwim, 4));
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(iOffset, 3));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));
    geo.setAttribute('iColor2', new THREE.InstancedBufferAttribute(iColor2, 3));
    geo.instanceCount = total;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: FISH_VERT,
      fragmentShader: FISH_FRAG,
      side: THREE.DoubleSide,
      fog: true,
    });
    mat.uniforms.uTime = shared.uTime;
    mat.uniforms.uSunDir = shared.uSunDir;
    mat.uniforms.uSunColor = shared.uSunColor;
    mat.uniforms.uDayLight = shared.uDayLight;
    const fish = new THREE.Mesh(geo, mat);
    fish.name = 'reef-fish';
    fish.frustumCulled = false;
    group.add(fish);
    counts.fish = total;
  }
  return { group, counts, floorAt };
}
