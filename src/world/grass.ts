import * as THREE from 'three';
import type { Heightmap } from './heightmap';
import { stairsPathDistance, type Placement } from './layout';
import type { Trail } from './trail';
import { patchWorldMaterial } from './patchMaterial';
import { fbm2, type Noise2D } from '../core/noise';
import { createRng, randRange } from '../core/rng';
import { GRASS_MAX } from '../core/quality';
import type { SharedUniforms } from '../core/uniforms';

const BLADE_HEIGHT = 0.6;

/**
 * Grass blades as one InstancedMesh: GRASS_MAX blades are placed once (shuffled), and the
 * quality preset just draws the first N of them — changing quality costs nothing.
 * Wind sway is computed per vertex in the shader (see patchMaterial.ts, SWAY_GRASS).
 */
export class Grass {
  readonly mesh: THREE.InstancedMesh;
  private readonly maxCount: number;

  constructor(hm: Heightmap, noise: Noise2D, house: Placement, trail: Trail, seed: number, shared: SharedUniforms) {
    const rng = createRng(seed);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    patchWorldMaterial(material, { sway: 'grass', wet: true, porosity: 0.5, snow: true, twoSided: true }, shared);
    this.mesh = new THREE.InstancedMesh(bladeGeometry(), material, GRASS_MAX);
    this.mesh.name = 'grass';
    this.mesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const extent = hm.config.radius;
    let placed = 0;
    for (let attempt = 0; attempt < GRASS_MAX * 12 && placed < GRASS_MAX; attempt++) {
      const x = randRange(rng, -extent, extent);
      const z = randRange(rng, -extent, extent);
      if (hm.surfaceAt(x, z) !== 'grass') continue;
      if (Math.hypot(x - house.x, z - house.z) < 5.5) continue;
      // Fewer blades on the trodden footpath (a quarter in the middle), thinning in toward it.
      // Thin out on the stone path from the steps to the sea.
      if (stairsPathDistance(house, x, z) < 0.6 && rng() > 0.15) continue;
      const toTrail = trail.distance(x, z);
      if (toTrail < 1.3 && rng() > 0.25 + (0.75 * toTrail) / 1.3) continue;
      // Clumps: more blades where the noise is high.
      const clump = 0.5 + 0.5 * fbm2(noise, x * 0.08 - 11, z * 0.08 + 5, 2);
      if (rng() > 0.25 + 0.75 * clump) continue;
      p.set(x, hm.heightAt(x, z) - 0.02, z);
      e.set((rng() - 0.5) * 0.25, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
      q.setFromEuler(e);
      const k = randRange(rng, 0.55, 1.25);
      s.set(k, k * randRange(rng, 0.8, 1.2), k);
      this.mesh.setMatrixAt(placed, m.compose(p, q, s));
      // Per-blade tint multiplies the vertex colors: slight brightness and hue variation.
      const b = 0.8 + rng() * 0.35;
      c.setRGB(b * (0.9 + rng() * 0.2), b, b * (0.85 + rng() * 0.2));
      this.mesh.setColorAt(placed, c);
      placed++;
    }
    this.maxCount = placed;
    this.mesh.count = placed;
    this.mesh.computeBoundingSphere();
  }

  setCount(count: number): void {
    this.mesh.count = Math.min(count, this.maxCount);
    this.mesh.visible = this.mesh.count > 0;
  }
}

/** One blade: a tapered, slightly curved strip of 3 segments, 0.6 m tall. */
function bladeGeometry(): THREE.BufferGeometry {
  const width = 0.06;
  const levels = [0, 0.35, 0.7];
  const pos: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color('#3f7a2a');
  const tip = new THREE.Color('#8cc152');
  const tmp = new THREE.Color();
  for (const t of levels) {
    const w = width * (1 - t * 0.85);
    const bend = t * t * 0.12;
    pos.push(-w / 2, t * BLADE_HEIGHT, bend, w / 2, t * BLADE_HEIGHT, bend);
    tmp.copy(base).lerp(tip, t);
    col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
  }
  pos.push(0, BLADE_HEIGHT, 0.12);
  col.push(tip.r, tip.g, tip.b);
  const index = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
