import * as THREE from 'three';
import { SPECIES, type Site, type Species } from './species';
import type { Heightmap } from '../heightmap';
import { inHouseView, inStairsPath, type Circle, type Placement } from '../layout';
import type { Trail } from '../trail';
import { createSwayDepthMaterial, patchWorldMaterial } from '../patchMaterial';
import { fbm2, type Noise2D } from '../../core/noise';
import { createRng, randRange } from '../../core/rng';
import type { SharedUniforms } from '../../core/uniforms';

/** Trunk position for first-person collision (Phase 5). */
export interface TrunkInstance {
  x: number;
  z: number;
  radius: number;
}

export interface Forest {
  group: THREE.Group;
  trunks: TrunkInstance[];
  /** Plants per species id (for stats/tests). */
  counts: Record<string, number>;
}

interface Placed {
  x: number;
  z: number;
  r: number;
  layer: 'tree' | 'under';
}

/**
 * Places every species by its habitat rules and builds one InstancedMesh per species variant.
 * All plants share ONE material (vertex colors + weather patch), so each variant is a single
 * draw call no matter how many plants it has.
 */
export function createForest(
  hm: Heightmap,
  noise: Noise2D,
  house: Placement,
  clearings: Circle[],
  seed: number,
  shared: SharedUniforms,
  trail: Trail,
  /** Placed by hand (the hammock's palms): grown first, collide like the others. */
  fixedPalms: readonly Placement[] = [],
  /** No plant at all inside these (the hammock and the sand under it). */
  keepOut: readonly Circle[] = [],
): Forest {
  const rng = createRng(seed);

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  patchWorldMaterial(material, { sway: 'plant', wet: true, porosity: 0.5, snow: true, twoSided: true }, shared);
  const depth = createSwayDepthMaterial({ sway: 'plant' }, shared);

  const grid = new SpatialGrid(8);
  const group = new THREE.Group();
  group.name = 'forest';
  const trunks: TrunkInstance[] = [];
  const counts: Record<string, number> = {};
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const extent = hm.config.radius * 1.05;

  for (const sp of SPECIES) {
    const placements: Array<{ x: number; z: number; rotY: number; s: number; v: number }> = [];
    if (sp.id === 'coconut') {
      // Middle variant (8.4 m), full size: a hammock hangs at a sensible height on its trunk.
      for (const p of fixedPalms) {
        placements.push({ x: p.x, z: p.z, rotY: p.rotY, s: 1, v: FIXED_PALM_VARIANT });
        grid.add({ x: p.x, z: p.z, r: sp.radius, layer: 'tree' });
        trunks.push({ x: p.x, z: p.z, radius: sp.trunk });
      }
    }
    for (let attempt = 0; attempt < sp.count * 60 && placements.length < sp.count; attempt++) {
      const x = randRange(rng, -extent, extent);
      const z = randRange(rng, -extent, extent);
      const h = hm.heightAt(x, z);
      if (h < 0.45) continue;
      if (hm.normalYAt(x, z) < (sp.layer === 'tree' ? 0.8 : 0.7)) continue;
      const site: Site = {
        x,
        z,
        height: h,
        inland: hm.inlandAt(x, z),
        onSand: h < hm.sandLineAt(x, z),
        house: Math.hypot(x - house.x, z - house.z),
        patch: 0.5 + 0.5 * fbm2(noise, x * 0.04 + 31, z * 0.04 - 17, 2),
      };
      if (site.house < (sp.layer === 'tree' ? 9 + sp.radius * 0.5 : 6)) continue;
      if (sp.layer === 'tree' && clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) continue;
      if (keepOut.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + sp.radius * 0.5)) continue;
      if (sp.layer === 'tree' && inHouseView(house, x, z)) continue;
      // Keep the steps and the path from them to the sea clear, crowns included (the plant
      // grows somewhere else).
      if (inStairsPath(house, x, z, sp.radius * sp.scale[1] * 0.6)) continue;
      // The footpath: trunks stand back from it (it stays walkable, the crowns still meet
      // overhead); undergrowth crowds right up to its edges.
      const near = trail.nearest(x, z);
      const toTrail = near.d;
      // The entrance from the beach (first ~25 m) is a little more open.
      const open = near.s < 25 ? 0.7 : 0;
      if (toTrail < (sp.layer === 'tree' ? 2.0 + sp.radius * 0.3 : 0.6 + sp.radius * 0.6) + open) continue;
      let habitat = sp.habitat(site);
      if (sp.layer === 'under' && toTrail < 3.5 && site.inland > 0.2) habitat = Math.min(1, habitat * 1.8 + 0.2);
      if (rng() > habitat) continue;
      const s = randRange(rng, sp.scale[0], sp.scale[1]);
      if (!grid.free(x, z, sp, s)) continue;
      grid.add({ x, z, r: sp.radius * s, layer: sp.layer });

      const rotY = sp.leanOutward
        ? -Math.atan2(z, x) + (rng() - 0.5) * 0.6 // local +X (the lean) points out to sea
        : rng() * Math.PI * 2;
      placements.push({ x, z, rotY, s, v: Math.floor(rng() * sp.variants) });
      if (sp.trunk > 0) trunks.push({ x, z, radius: sp.trunk * s });
    }
    counts[sp.id] = placements.length;

    for (let v = 0; v < sp.variants; v++) {
      const list = placements.filter((p) => p.v === v);
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(sp.build(createRng(seed * 31 + v * 7 + sp.id.length), v), material, list.length);
      mesh.name = `${sp.id}-${v}`;
      list.forEach((p, i) => {
        pos.set(p.x, hm.heightAt(p.x, p.z) - 0.1, p.z);
        q.setFromAxisAngle(up, p.rotY);
        scl.set(p.s, p.s, p.s);
        mesh.setMatrixAt(i, m.compose(pos, q, scl));
      });
      mesh.castShadow = sp.castShadow;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depth;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  return { group, trunks, counts };
}

/** Variant of the hand-placed palms (fixedPalms): the 8.4 m one. */
const FIXED_PALM_VARIANT = 1;

/**
 * Trunk center and radius of a hand-placed palm (see `fixedPalms`) at `y` m above its foot.
 * Coconut trunks curve along their local +X; the curve comes from the variant's first random
 * draw, repeated here so things tied to the trunk (the hammock ropes) sit right round it.
 */
export function fixedPalmTrunkAt(forestSeed: number, p: Placement, y: number): { x: number; z: number; r: number } {
  const v = FIXED_PALM_VARIANT;
  // Same seed and first draw as coconut.build() (species.ts): height, then bend.
  const bend = randRange(createRng(forestSeed * 31 + v * 7 + 'coconut'.length), 1, 2.6);
  const t = (y + 0.1) / (7 + v * 1.4);
  const off = bend * t * t;
  return { x: p.x + Math.cos(p.rotY) * off, z: p.z - Math.sin(p.rotY) * off, r: 0.3 - 0.13 * t };
}

/** Uniform-grid neighbor lookup for spacing checks. */
class SpatialGrid {
  private readonly cells = new Map<string, Placed[]>();

  constructor(private readonly size: number) {}

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  add(p: Placed): void {
    const k = this.key(Math.floor(p.x / this.size), Math.floor(p.z / this.size));
    const cell = this.cells.get(k);
    if (cell) cell.push(p);
    else this.cells.set(k, [p]);
  }

  /**
   * Trees keep crowns apart (they may overlap a little, like a real canopy). Understory
   * plants only avoid tree trunks and each other.
   */
  free(x: number, z: number, sp: Species, s: number): boolean {
    const r = sp.radius * s;
    const cx = Math.floor(x / this.size);
    const cz = Math.floor(z / this.size);
    const reach = Math.ceil((r + 8) / this.size);
    for (let dz = -reach; dz <= reach; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const cell = this.cells.get(this.key(cx + dx, cz + dz));
        if (!cell) continue;
        for (const o of cell) {
          const d = Math.hypot(o.x - x, o.z - z);
          // 0.55: rainforest crowns interlock; trunks still stay a few meters apart.
          if (sp.layer === 'tree' && o.layer === 'tree' && d < (r + o.r) * 0.55) return false;
          if (sp.layer === 'under' && o.layer === 'tree' && d < 1.2) return false;
          if (sp.layer === 'under' && o.layer === 'under' && d < (r + o.r) * 0.8) return false;
        }
      }
    }
    return true;
  }
}
