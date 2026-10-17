import * as THREE from 'three';
import { PlantBuilder } from './plantBuilder';
import type { Heightmap } from '../heightmap';
import type { Placement } from '../layout';
import { patchWorldMaterial } from '../patchMaterial';
import { fbm2, type Noise2D } from '../../core/noise';
import { createRng, randRange, type Rng } from '../../core/rng';
import type { SharedUniforms } from '../../core/uniforms';

/** Generated once; quality presets draw a prefix of each color's instances. */
export const FLOWERS_MAX = 10000;

const PETALS = ['#f28ab2', '#f6d23c', '#fbf7ee', '#a37be0'];

/**
 * Wildflower meadows: small clumps of stems with star-shaped blooms in four colors, placed in
 * noise-driven patches on grass and along the forest edge. They bend like grass.
 */
export class GroundFlowers {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly placed: number[] = [];

  constructor(hm: Heightmap, noise: Noise2D, house: Placement, seed: number, shared: SharedUniforms) {
    const rng = createRng(seed);
    this.group.name = 'ground-flowers';
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
    patchWorldMaterial(material, { sway: 'grass', snow: true, twoSided: true }, shared);

    const perColor = FLOWERS_MAX / PETALS.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const extent = hm.config.radius;
    PETALS.forEach((hex, ci) => {
      const mesh = new THREE.InstancedMesh(clumpGeometry(rng, new THREE.Color(hex)), material, perColor);
      mesh.receiveShadow = true;
      let n = 0;
      for (let attempt = 0; attempt < perColor * 40 && n < perColor; attempt++) {
        const x = randRange(rng, -extent, extent);
        const z = randRange(rng, -extent, extent);
        if (hm.surfaceAt(x, z) !== 'grass') continue;
        if (Math.hypot(x - house.x, z - house.z) < 4) continue;
        // Each color has its own patch pattern, so meadows are mixed but not uniform.
        const patch = 0.5 + 0.5 * fbm2(noise, x * 0.06 + ci * 37, z * 0.06 - ci * 19, 2);
        if (rng() > Math.pow(Math.max(0, (patch - 0.45) / 0.55), 1.5)) continue;
        p.set(x, hm.heightAt(x, z) - 0.02, z);
        q.setFromAxisAngle(up, rng() * Math.PI * 2);
        const k = randRange(rng, 0.7, 1.3);
        s.set(k, k, k);
        mesh.setMatrixAt(n++, m.compose(p, q, s));
      }
      mesh.count = n;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.placed.push(n);
      this.group.add(mesh);
    });
  }

  /** Total flowers to draw (split evenly across colors). */
  setCount(total: number): void {
    const each = Math.floor(total / this.meshes.length);
    this.meshes.forEach((mesh, i) => {
      mesh.count = Math.min(each, this.placed[i]);
      mesh.visible = mesh.count > 0;
    });
  }
}

function clumpGeometry(rng: Rng, petal: THREE.Color): THREE.BufferGeometry {
  const b = new PlantBuilder(rng, () => 0);
  const stem = new THREE.Color('#4f8a34');
  const heart = new THREE.Color('#f2c94c');
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rng();
    const h = randRange(rng, 0.22, 0.38);
    const top = new THREE.Vector3(Math.cos(a) * 0.06, h, Math.sin(a) * 0.06);
    b.tube([new THREE.Vector3(0, 0, 0), top], [0.008, 0.006], 3, () => stem);
    b.flower(top, new THREE.Vector3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3), randRange(rng, 0.045, 0.07), 5, petal, heart);
  }
  return b.build();
}
