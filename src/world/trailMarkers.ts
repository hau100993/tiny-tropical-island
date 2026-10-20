import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder';
import type { Heightmap } from './heightmap';
import type { Trail } from './trail';
import { STAIRS, houseToWorld, type Placement } from './layout';
import { createRng, randRange } from '../core/rng';

const STONES = ['#9a958a', '#8b867c', '#a7a196'] as const;
const WOOD = '#7a5636';
const WOOD_DARK = '#5e4129';

/**
 * Flat stepping stones from the foot of the house's steps down the beach to the water's edge,
 * and a weathered wooden signpost ("Đường mòn") where the forest footpath leaves the sand.
 * One mesh for stones and post, one small textured board for the sign's lettering.
 */
export function createTrailMarkers(hm: Heightmap, trail: Trail, house: Placement, seed: number): THREE.Group {
  const rng = createRng(seed);
  const b = new GeoBuilder(rng, 0.08);
  const pts = trail.points;
  const along = trail.along;
  const at = (s: number): { x: number; z: number; dx: number; dz: number } => {
    let i = 0;
    while (i < along.length - 2 && along[i + 1] < s) i++;
    const f = (s - along[i]) / Math.max(1e-6, along[i + 1] - along[i]);
    const dx = pts[i + 1].x - pts[i].x;
    const dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: pts[i].x + dx * f, z: pts[i].z + dz * f, dx: dx / len, dz: dz / len };
  };
  // A stone every ~0.75 m from the steps (house-local +Z) until the sand is wet.
  for (let lz = STAIRS.pathFrom, k = 0; lz < 60; lz += 0.75 + rng() * 0.15, k++) {
    // Zigzag a little to either side, like stones set by hand for left and right feet.
    const off = (k % 2 ? 0.18 : -0.18) + randRange(rng, -0.05, 0.05);
    const { x, z } = houseToWorld(house, STAIRS.x + off, lz);
    if (hm.heightAt(x, z) < 0.2) break;
    const g = new THREE.CylinderGeometry(1, 1, 1, 7);
    g.scale(randRange(rng, 0.24, 0.32), randRange(rng, 0.06, 0.09), randRange(rng, 0.2, 0.28));
    g.rotateY(rng() * Math.PI);
    g.translate(x, hm.heightAt(x, z) + 0.015, z);
    b.add(g, STONES[k % STONES.length]);
  }
  // Where the footpath leaves the sand.
  let grassAt = -1;
  for (let s = 0.4; s < 40 && grassAt < 0; s += 0.5) {
    const p = at(s);
    if (hm.surfaceAt(p.x, p.z) === 'grass') grassAt = s;
  }
  const group = new THREE.Group();
  group.name = 'trail-markers';
  // Signpost on the left of the path where it leaves the sand, the board facing the beach.
  const sp = at(Math.max(2, grassAt));
  const px = sp.x + sp.dz * 1.1;
  const pz = sp.z - sp.dx * 1.1;
  const py = hm.heightAt(px, pz);
  // Board face (local +Z) toward the beach, i.e. against the path; its arrow (local +X) then
  // points across to the path, which runs on the post's right.
  const yaw = Math.atan2(-sp.dx, -sp.dz);
  const post = new GeoBuilder(rng, 0.06);
  post.box(0.1, 1.5, 0.1, 0, 0.7, 0, WOOD_DARK);
  post.box(0.95, 0.28, 0.05, 0.5, 1.25, 0, WOOD);
  // Arrow tip on the board's end, pointing into the forest.
  const tip = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 3);
  tip.rotateX(Math.PI / 2);
  tip.rotateZ(-Math.PI / 2);
  tip.scale(0.7, 0.7, 1);
  tip.translate(1.03, 1.25, 0);
  post.add(tip, WOOD);
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  const postMesh = new THREE.Mesh(post.build(), wood);
  const stones = new THREE.Mesh(b.build(), wood);
  postMesh.castShadow = true;
  stones.receiveShadow = true;
  const sign = new THREE.Group();
  sign.add(postMesh, signText());
  sign.position.set(px, py - 0.05, pz);
  sign.rotation.y = yaw;
  group.add(stones, sign);
  return group;
}

/** "Đường mòn" burnt into the board, on both faces (a small canvas texture, made once). */
function signText(): THREE.Group {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const group = new THREE.Group();
  if (!ctx) return group;
  ctx.fillStyle = '#7a5636';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#2e1d10';
  ctx.font = 'bold 40px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Đường mòn', 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.22), mat);
    plane.position.set(0.5, 1.25, side * 0.027);
    if (side < 0) plane.rotation.y = Math.PI;
    group.add(plane);
  }
  return group;
}
