import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geoBuilder';
import type { Heightmap } from './heightmap';
import type { IslandLayout, Placement } from './layout';
import { createRng, type Rng } from '../core/rng';

const ROCK_COLORS = ['#8d8a80', '#7b776d', '#9a958a'];

export interface Rocks {
  group: THREE.Group;
  /** Collision circles (Phase 5). */
  circles: Array<{ x: number; z: number; r: number }>;
}

/** Noise-shaped boulders, smooth shaded, drawn as 3 instanced variants. */
export function createRocks(hm: Heightmap, layout: IslandLayout, seed: number): Rocks {
  const rng = createRng(seed);
  const geos = ROCK_COLORS.map((c) => rockGeometry(rng, new THREE.Color(c)));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const group = new THREE.Group();
  group.name = 'rocks';

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let v = 0; v < geos.length; v++) {
    const list = layout.rocks.filter((r) => r.variant === v);
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(geos[v], material, list.length);
    list.forEach((r, i) => {
      p.set(r.x, hm.heightAt(r.x, r.z) - 0.25 * r.scale, r.z);
      e.set((rng() - 0.5) * 0.4, r.rotY, (rng() - 0.5) * 0.4);
      q.setFromEuler(e);
      s.set(r.scale * 1.2, r.scale * 0.8, r.scale);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return { group, circles: layout.rocks.map((r) => ({ x: r.x, z: r.z, r: r.scale * 1.0 })) };
}

/** Smooth 3D value noise in [0, 1] on a seeded lattice (for rock shapes). */
function createNoise3D(rng: Rng): (x: number, y: number, z: number) => number {
  const N = 256;
  const table = new Float32Array(N);
  for (let i = 0; i < N; i++) table[i] = rng();
  const perm = new Uint8Array(N);
  for (let i = 0; i < N; i++) perm[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const at = (x: number, y: number, z: number): number => table[perm[(perm[(perm[x & 255] + y) & 255] + z) & 255]];
  const fade = (t: number): number => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const w = fade(z - zi);
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const x00 = lerp(at(xi, yi, zi), at(xi + 1, yi, zi), u);
    const x10 = lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), u);
    const x01 = lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), u);
    const x11 = lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  };
}

/**
 * A weathered boulder: a finely subdivided sphere (1280 triangles) pushed in and out by layered
 * 3D noise (big lumps, then knobs and small pits), flattened underneath so it sits on the sand,
 * smooth-shaded. Vertex colors add mottling, dark crevices and a little moss on top, so no
 * individual triangle reads at walking distance.
 */
function rockGeometry(rng: Rng, color: THREE.Color): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  // The icosahedron comes non-indexed; weld it so neighbors share vertices (smooth normals).
  g = mergeVertices(g);
  const noise = createNoise3D(rng);
  const ox = rng() * 50;
  const oz = rng() * 50;
  const pos = g.getAttribute('position');
  const count = pos.count;
  const crev = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const big = noise(v.x * 1.3 + ox, v.y * 1.3, v.z * 1.3 + oz);
    const mid = noise(v.x * 3.1 + oz, v.y * 3.1 + 7, v.z * 3.1 + ox);
    const fine = noise(v.x * 7.5 - ox, v.y * 7.5, v.z * 7.5 - oz);
    const r = 0.72 + 0.45 * big + 0.16 * mid + 0.05 * fine;
    v.multiplyScalar(r);
    // Flat-ish bottom, slightly squashed overall: boulders rest, they don't float.
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
    crev[i] = mid * 0.6 + fine * 0.4;
  }
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  const moss = new THREE.Color('#6f7f4a');
  const dark = color.clone().multiplyScalar(0.55);
  for (let i = 0; i < count; i++) {
    c.copy(color).multiplyScalar(0.88 + 0.24 * noise(pos.getX(i) * 4 + 3, pos.getY(i) * 4, pos.getZ(i) * 4));
    // Pits and cracks are darker; upward faces collect a little moss and lichen.
    c.lerp(dark, Math.max(0, 0.55 - crev[i]) * 1.2);
    const up = nrm.getY(i);
    c.lerp(moss, Math.max(0, up - 0.55) * 0.5 * noise(pos.getX(i) * 2.5 - 9, 0.5, pos.getZ(i) * 2.5));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Beach umbrella, towel and lounge chair, as two meshes (canopy is double-sided). */
export function createBeachSet(hm: Heightmap, placement: Placement, seed: number): THREE.Group {
  const rng = createRng(seed);
  const b = new GeoBuilder(rng, 0.04);
  const ground = hm.heightAt(placement.x, placement.z);

  b.box(0.06, 2.5, 0.06, 0, ground + 1.05, 0, '#e8e2d0', 0.08, 0, 0.05);
  // Towel next to the umbrella.
  b.box(0.9, 0.02, 1.8, 1.0, ground + 0.03, 0.3, '#e0584a', 0, 0.3, 0);
  b.box(0.9, 0.021, 0.25, 1.0 - 0.07, ground + 0.035, 0.3 + 0.25, '#f4f0e6', 0, 0.3, 0);
  // Lounge chair: seat, backrest, legs.
  const cx = -1.1;
  b.box(0.6, 0.06, 1.3, cx, ground + 0.32, 0.2, '#f2efe6');
  b.box(0.6, 0.06, 0.7, cx, ground + 0.55, -0.6, '#f2efe6', -0.7, 0, 0);
  for (const [dx, dz] of [[-0.25, -0.35], [0.25, -0.35], [-0.25, 0.8], [0.25, 0.8]]) {
    b.box(0.04, 0.3, 0.04, cx + dx, ground + 0.15, 0.2 + dz, '#c9c3b4');
  }
  const base = new THREE.Mesh(
    b.build(),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }),
  );
  base.castShadow = true;
  base.receiveShadow = true;

  const canopy = new THREE.Mesh(
    canopyGeometry(1.6, 0.55, 10),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: 0.8 }),
  );
  canopy.position.set(0.1, ground + 2.25, 0.07);
  canopy.rotation.set(0.08, 0, 0.05);
  canopy.castShadow = true;

  const group = new THREE.Group();
  group.name = 'beach-set';
  group.add(base, canopy);
  group.position.set(placement.x, 0, placement.z);
  group.rotation.y = placement.rotY;
  return group;
}

/** Cone made of alternating red/white triangles from the apex to the rim. */
function canopyGeometry(radius: number, height: number, segments: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const red = new THREE.Color('#d9443a');
  const white = new THREE.Color('#f5f1e6');
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    pos.push(0, height, 0, Math.cos(a1) * radius, 0, Math.sin(a1) * radius, Math.cos(a0) * radius, 0, Math.sin(a0) * radius);
    const c = i % 2 ? red : white;
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Small rowboat. The hull is lofted from U-shaped cross sections along X; bow at +X.
 * Origin is at the waterline so bobbing only needs to set position.y.
 */
export function createBoat(seed: number): THREE.Group {
  const rng = createRng(seed);
  const length = 4.2;
  const halfWidth = 0.7;
  const depth = 0.55;
  const sections = 14;
  const around = 8;
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const hullLow = new THREE.Color('#8a3b2c');
  const hullHigh = new THREE.Color('#2f6f8f');
  const stripe = new THREE.Color('#f2efe6');

  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const x = -length / 2 + t * length;
    // Width profile: wide transom at the stern (t = 0), pointed bow (t = 1).
    const tt = 0.18 + t * 0.82;
    const ws = Math.pow(Math.max(0, 1 - (2 * tt - 1) ** 2), 0.45);
    const sheer = 0.12 * t * t;
    for (let j = 0; j <= around; j++) {
      const a = -Math.PI / 2 + (j / around) * Math.PI;
      const y = -depth * Math.cos(a) * (0.55 + 0.45 * ws) + sheer + 0.2;
      const z = halfWidth * ws * Math.sin(a);
      pos.push(x, y, z);
      const edge = Math.abs(j - around / 2) / (around / 2);
      const c = edge > 0.9 ? stripe : edge > 0.45 ? hullHigh : hullLow;
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < sections; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b2 = a + around + 1;
      index.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
  }
  // Transom: fan across the first section.
  const center = pos.length / 3;
  pos.push(-length / 2, 0.2 - depth * 0.5, 0);
  col.push(hullHigh.r, hullHigh.g, hullHigh.b);
  for (let j = 0; j < around; j++) index.push(center, j + 1, j);

  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hull.setIndex(index);
  const flatHull = hull.toNonIndexed();
  hull.dispose();
  flatHull.computeVertexNormals();

  const b = new GeoBuilder(rng, 0.05);
  b.box(0.3, 0.05, 1.2, -0.6, 0.15, 0, '#a87545');
  b.box(0.3, 0.05, 1.1, 0.6, 0.15, 0, '#a87545');
  // Oars resting inside.
  b.box(2.6, 0.04, 0.08, 0, 0.2, 0.3, '#c9a06a', 0, 0.06, 0);
  b.box(2.6, 0.04, 0.08, 0, 0.2, -0.3, '#c9a06a', 0, -0.06, 0);

  const group = new THREE.Group();
  group.name = 'boat';
  const hullMesh = new THREE.Mesh(
    flatHull,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: 0.7 }),
  );
  const fittings = new THREE.Mesh(
    b.build(),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  );
  for (const m of [hullMesh, fittings]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  group.add(hullMesh, fittings);
  return group;
}
