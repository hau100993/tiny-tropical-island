import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightmap } from './heightmap';
import type { Circle } from './layout';
import type { Noise2D } from '../core/noise';
import { createRng, randRange, type Rng } from '../core/rng';
import { fbm2 } from '../core/noise';
import type { SharedUniforms } from '../core/uniforms';
import { createSwayDepthMaterial, patchWorldMaterial } from './patchMaterial';

/** Trunk position, kept for first-person collision (Phase 5). */
export interface PalmInstance {
  x: number;
  z: number;
  radius: number;
}

export interface PalmForest {
  group: THREE.Group;
  instances: PalmInstance[];
}

const VARIANTS = 3;
const TARGET_COUNT = 380;
const TRUNK_LIGHT = new THREE.Color('#9a7b56');
const TRUNK_DARK = new THREE.Color('#6f5638');
const LEAF_BASE = new THREE.Color('#2e6a27');
const LEAF_TIP = new THREE.Color('#62ad3c');
const COCONUT = new THREE.Color('#6b5a2a');

interface PalmShape {
  trunk: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

export function createPalms(
  hm: Heightmap,
  clearings: Circle[],
  noise: Noise2D,
  seed: number,
  shared: SharedUniforms,
): PalmForest {
  const rng = createRng(seed);
  const shapes: PalmShape[] = [];
  for (let v = 0; v < VARIANTS; v++) shapes.push(buildPalmShape(rng, 7 + v * 1.4));

  const instances = placePalms(hm, clearings, noise, rng);

  // Group instance transforms by variant.
  const perVariant: THREE.Matrix4[][] = [[], [], []];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (const p of instances) {
    const y = hm.heightAt(p.x, p.z) - 0.15;
    const s = p.scale;
    pos.set(p.x, y, p.z);
    q.setFromAxisAngle(up, p.rotY);
    scale.set(s, s, s);
    perVariant[p.variant].push(new THREE.Matrix4().compose(pos, q, scale));
  }

  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.75,
  });
  // Wind sway runs in the vertex shader; shadows use matching swaying depth materials.
  patchWorldMaterial(trunkMat, { sway: 'palm', wet: true, porosity: 0.7, snow: true }, shared);
  patchWorldMaterial(leafMat, { sway: 'palm', tip: true, wet: true, porosity: 0.4, snow: true, twoSided: true }, shared);
  const trunkDepth = createSwayDepthMaterial({ sway: 'palm' }, shared);
  const leafDepth = createSwayDepthMaterial({ sway: 'palm', tip: true }, shared);

  const group = new THREE.Group();
  group.name = 'palms';
  for (let v = 0; v < VARIANTS; v++) {
    const mats = perVariant[v];
    if (mats.length === 0) continue;
    const trunk = new THREE.InstancedMesh(shapes[v].trunk, trunkMat, mats.length);
    const leaves = new THREE.InstancedMesh(shapes[v].leaves, leafMat, mats.length);
    mats.forEach((m, i) => {
      trunk.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
    });
    trunk.customDepthMaterial = trunkDepth;
    leaves.customDepthMaterial = leafDepth;
    for (const mesh of [trunk, leaves]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  return {
    group,
    instances: instances.map((p) => ({ x: p.x, z: p.z, radius: 0.3 * p.scale })),
  };
}

interface PalmPlacement {
  x: number;
  z: number;
  rotY: number;
  scale: number;
  variant: number;
}

/** Rejection sampling with a minimum spacing; denser in noise-driven "forest" patches. */
function placePalms(hm: Heightmap, clearings: Circle[], noise: Noise2D, rng: Rng): PalmPlacement[] {
  const out: PalmPlacement[] = [];
  const cellSize = 3;
  const grid = new Map<string, PalmPlacement[]>();
  const key = (cx: number, cz: number): string => `${cx},${cz}`;
  const extent = hm.config.radius * 1.05;

  for (let attempt = 0; attempt < 20000 && out.length < TARGET_COUNT; attempt++) {
    const x = randRange(rng, -extent, extent);
    const z = randRange(rng, -extent, extent);
    const h = hm.heightAt(x, z);
    if (h < 0.45 || h > 10) continue;
    if (hm.normalYAt(x, z) < 0.8) continue;
    if (clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) continue;

    const onBeach = h < hm.sandLineAt(x, z);
    const density = 0.5 + 0.5 * fbm2(noise, x * 0.03 + 7, z * 0.03 - 3, 2);
    const accept = onBeach ? 0.12 : 0.25 + 0.75 * density;
    if (rng() > accept) continue;

    const minDist = onBeach ? 5 : 2.6;
    const cx = Math.floor(x / cellSize);
    const cz = Math.floor(z / cellSize);
    let blocked = false;
    for (let dz = -2; dz <= 2 && !blocked; dz++) {
      for (let dx = -2; dx <= 2 && !blocked; dx++) {
        const cell = grid.get(key(cx + dx, cz + dz));
        if (cell?.some((o) => Math.hypot(o.x - x, o.z - z) < minDist)) blocked = true;
      }
    }
    if (blocked) continue;

    // Trunks bend along local +X. Beach palms lean out over the sand toward the sea.
    const outward = Math.atan2(z, x);
    const rotY = onBeach ? -outward + (rng() - 0.5) * 0.6 : rng() * Math.PI * 2;
    const p: PalmPlacement = {
      x,
      z,
      rotY,
      scale: randRange(rng, 0.8, 1.2),
      variant: Math.floor(rng() * VARIANTS),
    };
    out.push(p);
    const k = key(cx, cz);
    const cell = grid.get(k);
    if (cell) cell.push(p);
    else grid.set(k, [p]);
  }
  return out;
}

function buildPalmShape(rng: Rng, height: number): PalmShape {
  const bend = randRange(rng, 1.0, 2.6);
  const { geometry: trunk, top } = buildTrunk(height, bend);
  const parts: THREE.BufferGeometry[] = [trunk];

  // Coconuts clustered under the crown.
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI * 2 + rng();
    const nut = new THREE.IcosahedronGeometry(0.17, 0);
    nut.deleteAttribute('uv');
    nut.translate(top.x + Math.cos(a) * 0.22, top.y - 0.25, top.z + Math.sin(a) * 0.22);
    setColor(nut, COCONUT);
    parts.push(nut);
  }
  const trunkMerged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  for (const g of parts) g.dispose();
  if (!trunkMerged) throw new Error('palm trunk merge failed');
  trunkMerged.computeVertexNormals();

  return { trunk: trunkMerged, leaves: buildCrown(rng, top) };
}

/** Tapered tube following a quadratic curve that bends toward +X. */
function buildTrunk(height: number, bend: number): { geometry: THREE.BufferGeometry; top: THREE.Vector3 } {
  const radial = 6;
  const rings = 9;
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const c = new THREE.Vector3();
  const t3 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    c.set(bend * t * t, height * t, 0);
    t3.set(2 * bend * t, height, 0).normalize();
    n.set(t3.y, -t3.x, 0);
    // Slight flare at the base, thinner toward the crown.
    const r = 0.3 - 0.13 * t + 0.12 * (1 - Math.min(1, t * 8));
    const col = k % 2 === 0 ? TRUNK_LIGHT : TRUNK_DARK;
    for (let a = 0; a < radial; a++) {
      const ang = (a / radial) * Math.PI * 2;
      const ca = Math.cos(ang) * r;
      const sa = Math.sin(ang) * r;
      positions.push(c.x + n.x * ca, c.y + n.y * ca, c.z + sa);
      colors.push(col.r, col.g, col.b);
    }
  }
  for (let k = 0; k < rings; k++) {
    for (let a = 0; a < radial; a++) {
      const a1 = (a + 1) % radial;
      const i0 = k * radial + a;
      const i1 = k * radial + a1;
      const i2 = (k + 1) * radial + a;
      const i3 = (k + 1) * radial + a1;
      index.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return { geometry: g, top: new THREE.Vector3(bend, height, 0) };
}

/** Drooping fronds: each is a strip with a center rib and a slight V fold. */
function buildCrown(rng: Rng, top: THREE.Vector3): THREE.BufferGeometry {
  const fronds = 8;
  const segs = 6;
  const positions: number[] = [];
  const colors: number[] = [];
  const tips: number[] = [];
  const index: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const center = new THREE.Vector3();
  const col = new THREE.Color();

  for (let f = 0; f < fronds; f++) {
    const phi = (f / fronds) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const len = randRange(rng, 3.4, 4.6);
    const lift = randRange(rng, 0.25, 0.55);
    const droop = randRange(rng, 0.75, 1.05);
    const width = randRange(rng, 0.55, 0.75);
    dir.set(Math.cos(phi), 0, Math.sin(phi));
    side.set(-dir.z, 0, dir.x);
    const base = positions.length / 3;

    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      center
        .copy(top)
        .addScaledVector(dir, len * t)
        .addScaledVector(up, len * (lift * t - droop * t * t) - 0.05);
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.8);
      const fold = 0.35 * w;
      col.copy(LEAF_BASE).lerp(LEAF_TIP, t);
      // left edge, rib, right edge
      positions.push(
        center.x + side.x * w, center.y - fold, center.z + side.z * w,
        center.x, center.y, center.z,
        center.x - side.x * w, center.y - fold, center.z - side.z * w,
      );
      colors.push(col.r * 0.9, col.g * 0.9, col.b * 0.9, col.r * 1.1, col.g * 1.1, col.b * 1.1, col.r * 0.9, col.g * 0.9, col.b * 0.9);
      tips.push(t, t, t);
    }
    for (let s = 0; s < segs; s++) {
      const r0 = base + s * 3;
      const r1 = r0 + 3;
      index.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
      index.push(r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // 0 at the frond base … 1 at the tip: drives leaf flutter in the vertex shader.
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tips, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function setColor(g: THREE.BufferGeometry, c: THREE.Color): void {
  const count = g.getAttribute('position').count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
