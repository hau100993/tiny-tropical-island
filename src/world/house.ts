import * as THREE from 'three';
import { GeoBuilder, polygonGeometry } from './geoBuilder';
import type { Heightmap } from './heightmap';
import type { Placement } from './layout';
import { createRng } from '../core/rng';

/**
 * Stilt house: one room (x ∈ [-2.5, 2.5], z ∈ [-2, 2] in local space) plus a porch toward
 * local +Z (z ∈ [2, 4.3]) with steps down to the ground. Local +Z faces the sea.
 */
export const HOUSE_DIMS = {
  halfWidth: 2.5,
  roomBack: -2,
  roomFront: 2,
  porchFront: 4.3,
  wallHeight: 2.4,
  /** Floor height above the highest ground point under the house. */
  clearance: 1.1,
} as const;

export interface HouseInfo {
  group: THREE.Group;
  floorY: number;
  placement: Placement;
  /** Material of the window panes and lantern; glows from dusk to dawn. */
  windowMaterial: THREE.MeshStandardMaterial;
  /** Warm porch lantern light (off by day). */
  lamp: THREE.PointLight;
}

const WOOD = '#8b5a2b';
const WOOD_DARK = '#5c3a1e';
const PLANK_A = '#a87545';
const PLANK_B = '#94653a';
const WALL = '#b07a48';
const THATCH = '#c09a5c';
const THATCH_DARK = '#a5824a';
const FABRIC = '#d9d2c0';
const BLANKET = '#3f7f8f';

interface Hole {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export function createHouse(hm: Heightmap, placement: Placement, seed: number): HouseInfo {
  const rng = createRng(seed);
  const b = new GeoBuilder(rng);
  const glass = new GeoBuilder(rng, 0);
  const D = HOUSE_DIMS;
  const cosR = Math.cos(placement.rotY);
  const sinR = Math.sin(placement.rotY);
  const groundAt = (lx: number, lz: number): number =>
    hm.heightAt(placement.x + lx * cosR + lz * sinR, placement.z - lx * sinR + lz * cosR);

  // Floor sits above the highest ground point under the footprint.
  let maxGround = -Infinity;
  for (let lz = D.roomBack; lz <= D.porchFront; lz += 0.5) {
    for (let lx = -D.halfWidth; lx <= D.halfWidth; lx += 0.5) maxGround = Math.max(maxGround, groundAt(lx, lz));
  }
  const F = maxGround + D.clearance;

  // Stilts, sunk 0.4 m into the ground.
  for (const lz of [-1.9, 0, 1.9, 4.1]) {
    for (const lx of [-2.4, 0, 2.4]) {
      if (lz === 0 && lx === 0) continue;
      const bottom = groundAt(lx, lz) - 0.4;
      const top = F - 0.15;
      b.box(0.2, top - bottom, 0.2, lx, (top + bottom) / 2, lz, WOOD_DARK);
    }
  }
  // Beams under the floor.
  for (const lz of [-1.9, 1.9, 4.1]) b.box(5.4, 0.2, 0.22, 0, F - 0.25, lz, WOOD_DARK);

  // Floor planks running along Z.
  const depth = D.porchFront - D.roomBack + 0.1;
  for (let k = 0; k < 13; k++) {
    const lx = -2.6 + 0.2 + k * 0.4;
    b.box(0.38, 0.1, depth, lx, F - 0.05, (D.roomBack + D.porchFront) / 2, k % 2 ? PLANK_A : PLANK_B);
  }

  // Walls with door and window openings. u runs along the wall, v is height above the floor.
  const W = D.halfWidth;
  const H = D.wallHeight;
  const T = 0.12;
  const sideWindow: Hole[] = [{ u0: -0.6, u1: 0.6, v0: 1.0, v1: 1.8 }];
  wall(b, 'x', D.roomBack, -W, W, F, H, T, [{ u0: -0.7, u1: 0.7, v0: 1.0, v1: 1.9 }]);
  wall(b, 'x', D.roomFront, -W, W, F, H, T, [
    { u0: -0.55, u1: 0.55, v0: 0, v1: 2.05 },
    { u0: 1.2, u1: 2.1, v0: 1.0, v1: 1.8 },
    { u0: -2.1, u1: -1.2, v0: 1.0, v1: 1.8 },
  ]);
  wall(b, 'z', -W, D.roomBack, D.roomFront, F, H, T, sideWindow);
  wall(b, 'z', W, D.roomBack, D.roomFront, F, H, T, sideWindow);
  // Corner posts.
  for (const lx of [-W, W]) for (const lz of [D.roomBack, D.roomFront]) b.box(0.2, H, 0.2, lx, F + H / 2, lz, WOOD_DARK);

  // Glass panes (separate material so they can glow at night).
  glass.box(1.4, 0.9, 0.03, 0, F + 1.45, D.roomBack, '#ffffff');
  glass.box(0.9, 0.8, 0.03, 1.65, F + 1.4, D.roomFront, '#ffffff');
  glass.box(0.9, 0.8, 0.03, -1.65, F + 1.4, D.roomFront, '#ffffff');
  glass.box(0.03, 0.8, 1.2, -W, F + 1.4, 0, '#ffffff');
  glass.box(0.03, 0.8, 1.2, W, F + 1.4, 0, '#ffffff');

  // Gable roof, ridge along X, covering room and porch.
  const roofBack = D.roomBack - 0.5;
  const roofFront = D.porchFront + 0.4;
  const zc = (roofBack + roofFront) / 2;
  const run = (roofFront - roofBack) / 2;
  const rise = 1.6;
  const ridgeY = F + H + 1.45;
  const slope = Math.atan2(rise, run);
  const slab = Math.hypot(run, rise) + 0.3;
  const thick = 0.18;
  for (const sgn of [-1, 1]) {
    // sgn = -1: back half (rises toward +Z); sgn = +1: front half.
    const cz = zc + sgn * (Math.cos(slope) * slab) / 2;
    const cy = ridgeY - (Math.sin(slope) * slab) / 2;
    b.box(6.2, thick, slab, 0, cy, cz, THATCH, sgn < 0 ? -slope : slope);
    // Thatch bands for texture.
    for (let k = 1; k <= 3; k++) {
      const t = k / 4;
      b.box(6.25, 0.06, 0.12, 0, ridgeY - Math.sin(slope) * slab * t + thick * 0.55, zc + sgn * Math.cos(slope) * slab * t, THATCH_DARK, sgn < 0 ? -slope : slope);
    }
  }
  b.box(6.3, 0.22, 0.22, 0, ridgeY + 0.05, zc, WOOD_DARK);

  // Gable ends above the side walls (pentagon following the roof line).
  const roofY = (lz: number): number => ridgeY - (Math.abs(lz - zc) / run) * rise - thick / 2;
  for (const lx of [-W, W]) {
    const pts = [
      new THREE.Vector3(lx, F + H, D.roomBack),
      new THREE.Vector3(lx, F + H, D.roomFront),
      new THREE.Vector3(lx, roofY(D.roomFront), D.roomFront),
      new THREE.Vector3(lx, ridgeY - thick / 2, zc),
      new THREE.Vector3(lx, roofY(D.roomBack), D.roomBack),
    ];
    b.add(polygonGeometry(pts), WALL);
  }
  // Front gable (above the room's front wall) and back gable are covered by the roof slabs.
  // Fill the triangle between front wall top and roof.
  const frontPts = [
    new THREE.Vector3(-W, F + H, D.roomFront),
    new THREE.Vector3(W, F + H, D.roomFront),
    new THREE.Vector3(W, roofY(D.roomFront), D.roomFront),
    new THREE.Vector3(-W, roofY(D.roomFront), D.roomFront),
  ];
  b.add(polygonGeometry(frontPts), WALL);

  // Porch posts up to the eave, railing with a gap for the steps.
  const eaveY = roofY(D.porchFront - 0.1);
  for (const lx of [-2.4, 2.4]) b.box(0.18, eaveY - F, 0.18, lx, (F + eaveY) / 2, D.porchFront - 0.1, WOOD_DARK);
  const railY = F + 0.9;
  const railSegments: Array<[number, number, number, number]> = [
    [-W, D.roomFront, -W, D.porchFront - 0.1],
    [W, D.roomFront, W, D.porchFront - 0.1],
    [-W, D.porchFront - 0.1, -0.7, D.porchFront - 0.1],
    [0.7, D.porchFront - 0.1, W, D.porchFront - 0.1],
  ];
  for (const [x0, z0, x1, z1] of railSegments) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    b.box(alongX ? len : 0.08, 0.08, alongX ? 0.08 : len, (x0 + x1) / 2, railY, (z0 + z1) / 2, WOOD);
    const n = Math.max(2, Math.round(len / 0.45));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      b.box(0.06, 0.9, 0.06, x0 + (x1 - x0) * t, F + 0.45, z0 + (z1 - z0) * t, WOOD);
    }
  }

  // Steps: solid blocks from each tread down into the ground.
  const stepGround = groundAt(0, D.porchFront + 1.5);
  const totalRise = F - stepGround;
  const steps = Math.max(1, Math.ceil(totalRise / 0.22));
  for (let k = 1; k < steps; k++) {
    const top = F - (k * totalRise) / steps;
    const lz = D.porchFront + (k - 0.5) * 0.32;
    const bottom = groundAt(0, lz) - 0.2;
    b.box(1.3, top - bottom, 0.32, 0, (top + bottom) / 2, lz, k % 2 ? PLANK_A : PLANK_B);
  }

  // Interior: bed, table, stool.
  b.box(1.0, 0.4, 2.0, -1.85, F + 0.2, -0.9, WOOD);
  b.box(0.95, 0.12, 1.9, -1.85, F + 0.46, -0.9, FABRIC);
  b.box(0.97, 0.06, 1.1, -1.85, F + 0.54, -0.55, BLANKET);
  b.box(1.0, 0.06, 0.7, 1.5, F + 0.75, -1.3, WOOD);
  for (const [dx, dz] of [[-0.42, -0.28], [0.42, -0.28], [-0.42, 0.28], [0.42, 0.28]]) {
    b.box(0.06, 0.72, 0.06, 1.5 + dx, F + 0.36, -1.3 + dz, WOOD_DARK);
  }
  b.box(0.35, 0.45, 0.35, 1.5, F + 0.225, -0.6, WOOD_DARK);

  // Lantern hanging over the porch (glows in Phase 4).
  b.box(0.02, 0.5, 0.02, 0.9, eaveY - 0.25, D.porchFront - 0.6, WOOD_DARK);
  glass.box(0.22, 0.3, 0.22, 0.9, eaveY - 0.65, D.porchFront - 0.6, '#ffffff');

  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: '#3c4a5a',
    roughness: 0.2,
    metalness: 0.1,
    emissive: new THREE.Color('#ffc46b'),
    emissiveIntensity: 0,
  });

  const group = new THREE.Group();
  group.name = 'house';
  const body = new THREE.Mesh(b.build(), woodMat);
  body.castShadow = true;
  body.receiveShadow = true;
  const panes = new THREE.Mesh(glass.build(), windowMaterial);
  // Lantern light: lights the porch, steps and the ground in front of the house at night.
  const lamp = new THREE.PointLight('#ffb867', 0, 16, 2);
  lamp.position.set(0.9, eaveY - 0.8, D.porchFront - 0.6);
  group.add(body, panes, lamp);
  group.position.set(placement.x, 0, placement.z);
  group.rotation.y = placement.rotY;

  return { group, floorY: F, placement, windowMaterial, lamp };
}

/**
 * A wall along `axis` at the fixed coordinate `at`, spanning u ∈ [u0, u1], height H from `baseY`,
 * with rectangular holes. Split into vertical strips at hole edges; each strip emits boxes for
 * the parts not covered by a hole.
 */
function wall(
  b: GeoBuilder,
  axis: 'x' | 'z',
  at: number,
  u0: number,
  u1: number,
  baseY: number,
  H: number,
  T: number,
  holes: Hole[],
): void {
  const cuts = [u0, u1, ...holes.flatMap((h) => [h.u0, h.u1])].sort((a, c) => a - c);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const c = cuts[i + 1];
    if (c - a < 1e-4) continue;
    const mid = (a + c) / 2;
    const covering = holes.filter((h) => h.u0 <= mid && mid <= h.u1).sort((p, q) => p.v0 - q.v0);
    let v = 0;
    const spans: Array<[number, number]> = [];
    for (const h of covering) {
      if (h.v0 > v) spans.push([v, h.v0]);
      v = Math.max(v, h.v1);
    }
    if (v < H) spans.push([v, H]);
    for (const [v0, v1] of spans) {
      const len = c - a;
      const y = baseY + (v0 + v1) / 2;
      if (axis === 'x') b.box(len, v1 - v0, T, mid, y, at, WALL);
      else b.box(T, v1 - v0, len, at, y, mid, WALL);
    }
  }
}
