import * as THREE from 'three';
import type { Heightmap } from '../../world/heightmap';

/** Cell size of the grid (m): finer than a palm's crown, coarse enough to bake in a blink. */
const CELL = 2;
/** Objects wider than this (m) are the ground, the sea or the sky, not obstacles. */
const MAX_FOOTPRINT = 40;
/** Objects lower than this (m) don't matter to something flying metres above them. */
const MIN_HEIGHT = 1;

const tmpBox = new THREE.Box3();
const tmpM = new THREE.Matrix4();

/**
 * The island's "skyline" for flying: per 2 m cell, the highest thing there (terrain, sea level,
 * the top of a tree, the house's roof, a rock). Baked once from the bounding boxes of the meshes
 * already in the scene (every instance of the forest's InstancedMeshes), so whatever the world
 * places, the manta flies over it. Outside the grid: the sea.
 *
 * Bounding boxes are a little generous (a palm's box includes the air under its fronds), which
 * suits a flyer: it keeps clear of the crowns.
 */
export class Skyline {
  private readonly n: number;
  private readonly half: number;
  /** Highest object top per cell (m); terrain and sea are added on read. */
  private readonly tops: Float32Array;

  constructor(
    private readonly heightmap: Heightmap,
    size: number,
  ) {
    this.n = Math.ceil(size / CELL);
    this.half = (this.n * CELL) / 2;
    this.tops = new Float32Array(this.n * this.n).fill(-Infinity);
  }

  /** Rasterizes every mesh under `root` (skipping `skip`); call once the world is built. */
  bake(root: THREE.Object3D, skip: ReadonlySet<THREE.Object3D>): void {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (skip.has(o) || !o.visible) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const local = geo.boundingBox;
      if (!local || local.isEmpty()) return;
      const inst = o as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, tmpM);
          tmpM.premultiply(inst.matrixWorld);
          this.add(tmpBox.copy(local).applyMatrix4(tmpM));
        }
      } else {
        this.add(tmpBox.copy(local).applyMatrix4(mesh.matrixWorld));
      }
    });
  }

  private add(b: THREE.Box3): void {
    if (b.max.x - b.min.x > MAX_FOOTPRINT || b.max.z - b.min.z > MAX_FOOTPRINT) return;
    if (b.max.y - b.min.y < MIN_HEIGHT) return;
    const n = this.n;
    const i0 = Math.max(0, Math.floor((b.min.x + this.half) / CELL));
    const i1 = Math.min(n - 1, Math.floor((b.max.x + this.half) / CELL));
    const j0 = Math.max(0, Math.floor((b.min.z + this.half) / CELL));
    const j1 = Math.min(n - 1, Math.floor((b.max.z + this.half) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        if (b.max.y > this.tops[k]) this.tops[k] = b.max.y;
      }
    }
  }

  /** Highest thing at (x, z): an object's top, the ground, or the sea surface (0). */
  floor(x: number, z: number): number {
    const ground = Math.max(0, this.heightmap.heightAt(x, z));
    const i = Math.floor((x + this.half) / CELL);
    const j = Math.floor((z + this.half) / CELL);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return ground;
    return Math.max(ground, this.tops[j * this.n + i]);
  }

  /**
   * Open ground at (x, z): nothing taller than a low bush (1.2 m) within `r` m (room for the
   * manta to hover, a metre up, wings spread).
   */
  open(x: number, z: number, r: number): boolean {
    return this.heightmap.heightAt(x, z) >= 0.2 && this.clear(x, z, r);
  }

  /**
   * Nothing taller than a low bush (1.2 m) within `r` m, whatever the ground: dry land, wet sand
   * or the shallows (where it can come down and you wade off).
   */
  clear(x: number, z: number, r: number): boolean {
    for (let dz = -r; dz <= r; dz += CELL) {
      for (let dx = -r; dx <= r; dx += CELL) {
        if (this.floor(x + dx, z + dz) > Math.max(0, this.heightmap.heightAt(x + dx, z + dz)) + 1.2) return false;
      }
    }
    return true;
  }
}
