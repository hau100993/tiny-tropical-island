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
 * Terrain mesh on the heightmap grid, smooth-shaded (shared vertices, averaged normals), so no
 * individual triangles show. Per vertex it stores two candidate colors and a blend weight:
 *
 * - `color`: the land color (grass, forest floor, rock),
 * - `aSandColor`: the beach color (dry, wet, under water),
 * - `aGrass`: 0 = sand … 1 = land, a soft ramp around the sand line.
 *
 * The fragment shader (patchMaterial, WORLD_GROUND) adds world-space noise to `aGrass` and
 * sharpens it, so the sand/grass edge is ragged and crisp at any distance instead of following
 * the 1.5 m grid, and it adds the fine detail (sand grain and ripples, mottled grass).
 */
export function createTerrainMesh(hm: Heightmap, noise: Noise2D): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const seg = hm.config.segments;
  const res = hm.res;
  const count = res * res;
  const positions = new Float32Array(count * 3);
  const land = new Float32Array(count * 3);
  const sand = new Float32Array(count * 3);
  const grass = new Float32Array(count);
  const color = new THREE.Color();
  const tmp = new THREE.Color();

  const h0 = -hm.half;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const v = j * res + i;
      const x = h0 + i * hm.cell;
      const z = h0 + j * hm.cell;
      const h = hm.data[v];
      positions.set([x, h, z], v * 3);
      landColor(hm, noise, x, h, z, hm.normalYAt(x, z), color, tmp);
      land.set([color.r, color.g, color.b], v * 3);
      sandColor(h, color);
      sand.set([color.r, color.g, color.b], v * 3);
      const line = hm.sandLineAt(x, z);
      grass[v] = h < 0.3 ? 0 : smoothstep(line - 0.25, line + 0.25, h);
    }
  }

  // Same diagonal split as Heightmap.heightAt; counter-clockwise seen from above.
  const index = new Uint32Array(seg * seg * 6);
  let k = 0;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * res + i;
      const b = (j + 1) * res + i;
      const c = j * res + i + 1;
      const d = (j + 1) * res + i + 1;
      index.set([a, b, c, b, d, c], k);
      k += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(land, 3));
  geometry.setAttribute('aSandColor', new THREE.BufferAttribute(sand, 3));
  geometry.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

/** Beach color by height: dry sand above, the wet strip at the waterline, darker under water. */
function sandColor(h: number, out: THREE.Color): void {
  if (h < 0.3) out.copy(WET_SAND).lerp(DEEP_SAND, smoothstep(0.3, -5, h));
  else out.copy(DRY_SAND).lerp(WET_SAND, smoothstep(0.7, 0.3, h) * 0.6);
}

/** Land color: grass in varied greens, dark forest floor with leaf litter inland, rock on steep slopes. */
function landColor(
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
  out.copy(GRASS_A).lerp(n > 0 ? GRASS_C : GRASS_B, Math.abs(n));
  // Deeper in, the rainforest floor is dark and mossy with patches of leaf litter.
  const deep = smoothstep(0.28, 0.55, hm.inlandAt(x, z));
  if (deep > 0) {
    tmp.copy(FOREST_FLOOR).lerp(LEAF_LITTER, smoothstep(0.1, 0.6, noise(x * 0.21 - 9, z * 0.21 + 4)));
    out.lerp(tmp, deep * 0.85);
  }
  // Sun-bleached, sandy grass right next to the beach.
  const line = hm.sandLineAt(x, z);
  out.lerp(tmp.copy(DRY_SAND), smoothstep(line + 0.5, line, h) * 0.3);
  // Bare rock where the hill is steep.
  out.lerp(tmp.copy(ROCK), smoothstep(0.86, 0.78, normalY));
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
