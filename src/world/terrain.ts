import * as THREE from 'three';
import type { Heightmap } from './heightmap';
import type { Noise2D } from '../core/noise';
import { smoothstep } from '../core/math';

const DEEP_SAND = new THREE.Color('#9c8a66');
const WET_SAND = new THREE.Color('#cdb487');
const DRY_SAND = new THREE.Color('#f0dcab');
const GRASS_A = new THREE.Color('#5d9b39');
const GRASS_B = new THREE.Color('#45822f');
const GRASS_C = new THREE.Color('#7fb247');
const ROCK = new THREE.Color('#8b8577');
const FOREST_FLOOR = new THREE.Color('#3a5a24');
const LEAF_LITTER = new THREE.Color('#5f5230');

/**
 * Flat-shaded terrain mesh: every triangle has its own 3 vertices (non-indexed), so the
 * normals computed per face give the faceted low-poly look, and each face gets one color.
 */
export function createTerrainMesh(hm: Heightmap, noise: Noise2D): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const seg = hm.config.segments;
  const triCount = seg * seg * 2;
  const positions = new Float32Array(triCount * 9);
  const colors = new Float32Array(triCount * 9);
  const color = new THREE.Color();
  const tmp = new THREE.Color();
  let p = 0;

  const writeTri = (
    ax: number, az: number, ah: number,
    bx: number, bz: number, bh: number,
    cx: number, cz: number, ch: number,
  ): void => {
    positions.set([ax, ah, az, bx, bh, bz, cx, ch, cz], p);
    // Face normal Y from the cross product (b - a) × (c - a), used for slope.
    const ux = bx - ax, uy = bh - ah, uz = bz - az;
    const vx = cx - ax, vy = ch - ah, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const normalY = ny / Math.hypot(nx, ny, nz);
    const mx = (ax + bx + cx) / 3;
    const mz = (az + bz + cz) / 3;
    faceColor(hm, noise, mx, (ah + bh + ch) / 3, mz, normalY, color, tmp);
    for (let k = 0; k < 3; k++) {
      colors[p + k * 3] = color.r;
      colors[p + k * 3 + 1] = color.g;
      colors[p + k * 3 + 2] = color.b;
    }
    p += 9;
  };

  const h0 = -hm.half;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const x0 = h0 + i * hm.cell;
      const x1 = x0 + hm.cell;
      const z0 = h0 + j * hm.cell;
      const z1 = z0 + hm.cell;
      const a = hm.data[j * hm.res + i];
      const b = hm.data[(j + 1) * hm.res + i];
      const c = hm.data[j * hm.res + i + 1];
      const d = hm.data[(j + 1) * hm.res + i + 1];
      // Same diagonal split as Heightmap.heightAt; counter-clockwise seen from above.
      writeTri(x0, z0, a, x0, z1, b, x1, z0, c);
      writeTri(x0, z1, b, x1, z1, d, x1, z0, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

function faceColor(
  hm: Heightmap,
  noise: Noise2D,
  x: number,
  h: number,
  z: number,
  normalY: number,
  out: THREE.Color,
  tmp: THREE.Color,
): void {
  const n = noise(x * 0.11 + 40, z * 0.11 - 40);
  const sandLine = hm.sandLineAt(x, z);
  if (h < 0.3) {
    // Under water and the wet strip at the waterline.
    out.copy(WET_SAND).lerp(DEEP_SAND, smoothstep(0.3, -5, h));
  } else if (h < sandLine) {
    out.copy(DRY_SAND).lerp(WET_SAND, smoothstep(0.7, 0.3, h) * 0.6);
  } else if (normalY < 0.82) {
    out.copy(ROCK);
  } else {
    out.copy(GRASS_A).lerp(n > 0 ? GRASS_C : GRASS_B, Math.abs(n));
    // Deeper in, the rainforest floor is dark and mossy with patches of leaf litter.
    const deep = smoothstep(0.28, 0.55, hm.inlandAt(x, z));
    if (deep > 0) {
      tmp.copy(FOREST_FLOOR).lerp(LEAF_LITTER, smoothstep(0.1, 0.6, noise(x * 0.21 - 9, z * 0.21 + 4)));
      out.lerp(tmp, deep * 0.85);
    }
    // Sandy edge where grass meets the beach.
    tmp.copy(DRY_SAND);
    out.lerp(tmp, smoothstep(sandLine + 0.35, sandLine, h) * 0.45);
  }
  // Per-face brightness jitter: a cheap way to make flat shading look hand-made.
  const jitter = 1 + 0.05 * noise(x * 1.7, z * 1.7);
  out.multiplyScalar(jitter);
}

/** Height grid as a float texture, sampled by the water shader for depth and foam. */
export function createHeightTexture(hm: Heightmap): THREE.DataTexture {
  const tex = new THREE.DataTexture(hm.data, hm.res, hm.res, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
