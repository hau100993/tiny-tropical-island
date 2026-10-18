import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from './geoBuilder';
import { cylinder, DESK, furnish, type InteriorParts } from './houseInterior';
import type { Heightmap } from './heightmap';
import type { Placement } from './layout';
import { createRng } from '../core/rng';

/**
 * Modern minimalist wooden house on stilts: one room (x ∈ [-3.5, 3.5], z ∈ [-2.5, 2.5] in local
 * space) with a floor-to-ceiling glass wall toward the sea (local +Z), a deck in front
 * (z ∈ [2.5, 4.6]) with steps down at its right end, and a mono-pitch roof rising toward the sea
 * with solar panels and a Starlink dish. Inside, Japanese-style and sparse: a desk with two
 * monitors facing the glass, a futon on tatami, a sofa, a wooden bathtub behind shoji screens.
 */
export const HOUSE_DIMS = {
  halfWidth: 3.5,
  roomBack: -2.5,
  roomFront: 2.5,
  deckFront: 4.6,
  /** Wall height at the back and at the glass front (the roof slopes between them). */
  wallLow: 2.55,
  wallHigh: 3.05,
  /** Floor height above the highest ground point under the house. */
  clearance: 1.6,
} as const;

/** A place to sit: eyes at (seatX, eyeY, seatZ) in house-local coordinates. */
export interface HouseSeat {
  seatX: number;
  seatZ: number;
  eyeY: number;
  standX: number;
  standZ: number;
  /** true: looks along local +Z (to the sea); false: along −Z (the back of the house). */
  facesSea: boolean;
  /** Default look up/down (rad). */
  pitch: number;
}

/** House-local box (x/z local, y absolute) used for collisions. */
export interface LocalBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

export interface LocalRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface HouseInfo {
  group: THREE.Group;
  floorY: number;
  placement: Placement;
  /** Lamp shades and the wall light: glow from dusk to dawn. */
  windowMaterial: THREE.MeshStandardMaterial;
  /** Window glass (see-through, no weather effects). */
  glassMaterial: THREE.MeshStandardMaterial;
  /** All wooden parts (gets the procedural wood grain). */
  woodMaterial: THREE.MeshStandardMaterial;
  /** Wall light by the door (off by day). */
  lamp: THREE.PointLight;
  /** Pendant lamp in the room (off by day). */
  roomLamp: THREE.PointLight;
  /** Soft daylight bounce inside, so the room isn't a black box next to a bright sea. */
  fillLight: THREE.PointLight;
  /** Top of the roof (for sheltering rain). */
  ridgeY: number;
  /** Things you can't walk through (walls, glass, railings, furniture, stilts). */
  solids: LocalBox[];
  /** Extra boxes only the third-person camera must stay out of (roof, floor slab, steps). */
  cameraSolids: LocalBox[];
  /** Walkable floor (room + deck) at `floorY`. */
  floor: LocalRect;
  /** Inside the walls (rain is muffled). */
  room: LocalRect;
  /** Under the roof. */
  roof: LocalRect;
  /** Height up to which the roof keeps things dry. */
  eaveY: number;
  /** Steps from the deck front down to the ground, along local +Z. */
  stairs: { x: number; halfWidth: number; z0: number; count: number; rise: number; depth: number };
  /** Work spot: chair, seated eye height, where you stand up; looks out to sea (local +Z). */
  desk: HouseSeat;
  /** Soaking in the tub: looks out of the back window at the forest (local −Z). */
  bath: HouseSeat;
  /** The two monitor screens (left, right as seen from the chair), textured by DeskScreens. */
  screens: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
}

// Exterior: charred dark cladding; interior: pale oak.
const CLAD = ['#3a2e26', '#2f251f', '#43352b'];
const LINING = '#d9bf97';
const OAK = '#c89b6a';
const OAK_LIGHT = '#d8b688';
const FLOOR_A = '#c9a476';
const FLOOR_B = '#bf9a6c';
const DECK_A = '#8d6a4a';
const DECK_B = '#7f5f42';
const POST = '#2b241f';
const METAL = '#1e2124';
const ROOF = '#34393e';
const FRAME = '#16181a';

/** Wood colors: parts in these go to the grained wood mesh, everything else to the plain one. */
const WOODS = new Set<string>([...CLAD, OAK, OAK_LIGHT, FLOOR_A, FLOOR_B, DECK_A, DECK_B, POST, '#8a6240']);

/** Same API as GeoBuilder; sends each part to the wood or the plain builder by its color. */
class Router {
  constructor(
    private readonly wood: GeoBuilder,
    private readonly plain: GeoBuilder,
  ) {}

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: string, rx = 0, ry = 0, rz = 0): void {
    (WOODS.has(color) ? this.wood : this.plain).box(w, h, d, x, y, z, color, rx, ry, rz);
  }

  add(g: THREE.BufferGeometry, color: string): void {
    (WOODS.has(color) ? this.wood : this.plain).add(g, color);
  }
}

const STEP_DEPTH = 0.3;
const OAK_DARK_TRIM = '#8a6240';

interface Hole {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export function createHouse(hm: Heightmap, placement: Placement, seed: number): HouseInfo {
  const rng = createRng(seed);
  const parts: InteriorParts = {
    wood: new GeoBuilder(rng, 0.06),
    plain: new GeoBuilder(rng, 0.04),
    soft: new GeoBuilder(rng, 0.03),
    leaf: new GeoBuilder(rng, 0.08),
    glow: new GeoBuilder(rng, 0),
  };
  const b = new Router(parts.wood, parts.plain);
  // Inside lining and ceiling: big, evenly coloured panels (grain only, no per-board tint).
  const lining = new GeoBuilder(rng, 0.012);
  const glass = new GeoBuilder(rng, 0);
  const glow = parts.glow;
  const D = HOUSE_DIMS;
  const cosR = Math.cos(placement.rotY);
  const sinR = Math.sin(placement.rotY);
  const groundAt = (lx: number, lz: number): number =>
    hm.heightAt(placement.x + lx * cosR + lz * sinR, placement.z - lx * sinR + lz * cosR);

  // Floor sits above the highest ground point under the footprint.
  let maxGround = -Infinity;
  for (let lz = D.roomBack; lz <= D.deckFront; lz += 0.5) {
    for (let lx = -D.halfWidth; lx <= D.halfWidth; lx += 0.5) maxGround = Math.max(maxGround, groundAt(lx, lz));
  }
  const F = maxGround + D.clearance;
  const W = D.halfWidth;
  const ZB = D.roomBack;
  const ZF = D.roomFront;
  const slope = (D.wallHigh - D.wallLow) / (ZF - ZB);
  /** Wall height (from the floor) at local z: the roof slopes up toward the sea. */
  const wallH = (z: number): number => D.wallLow + (z - ZB) * slope;

  const solids: LocalBox[] = [];
  const cameraSolids: LocalBox[] = [];
  const solid = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): void => {
    solids.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0, y1 });
  };

  // ---- Stilts and floor ----
  const stiltX = [-3.4, 0, 3.4];
  const stiltZ = [-2.4, 0, 2.4, 4.5];
  for (const lz of stiltZ) {
    for (const lx of stiltX) {
      const bottom = groundAt(lx, lz) - 0.4;
      const top = F - 0.18;
      b.box(0.22, top - bottom, 0.22, lx, (top + bottom) / 2, lz, POST);
      // Top below the floor beams, so it never catches feet on the top step.
      solid(lx - 0.11, lx + 0.11, lz - 0.11, lz + 0.11, -100, F - 0.4);
    }
  }
  for (const lz of stiltZ) b.box(7.2, 0.2, 0.2, 0, F - 0.28, lz, POST);
  // Floor slab edge (a dark band around the platform).
  b.box(7.24, 0.2, 0.06, 0, F - 0.12, ZB - 0.03, POST);
  b.box(7.24, 0.2, 0.06, 0, F - 0.12, D.deckFront + 0.03, POST);
  for (const sx of [-1, 1]) b.box(0.06, 0.2, D.deckFront - ZB + 0.06, sx * 3.62, F - 0.12, (ZB + D.deckFront) / 2, POST);
  // Room floor: pale oak planks along X; deck: darker boards along X.
  for (let z = ZB; z < ZF - 1e-6; z += 0.2) b.box(7.0, 0.1, 0.19, 0, F - 0.05, z + 0.1, (Math.round((z - ZB) / 0.2) % 2) ? FLOOR_A : FLOOR_B);
  for (let z = ZF; z < D.deckFront - 1e-6; z += 0.15) b.box(7.2, 0.08, 0.135, 0, F - 0.04, z + 0.075, (Math.round((z - ZF) / 0.15) % 2) ? DECK_A : DECK_B);

  // ---- Walls: dark vertical boards outside, pale oak lining inside ----
  // Holes: u runs along the wall (local x for front/back, local z for the sides), v above the floor.
  const backHoles: Hole[] = [
    { u0: -3.1, u1: -0.3, v0: 1.75, v1: 2.25 }, // high strip window over the futon
    { u0: 1.6, u1: 3.3, v0: 0.72, v1: 2.35 }, // big bath window onto the forest
  ];
  const leftHoles: Hole[] = [{ u0: 0.55, u1: 2.2, v0: 0.85, v1: 2.3 }]; // beside the desk
  const rightHoles: Hole[] = [{ u0: -2.15, u1: -1.4, v0: 1.4, v1: 2.1 }]; // bath
  const glassTop = 2.9;
  const frontHoles: Hole[] = [{ u0: -3.4, u1: 3.4, v0: 0, v1: glassTop }];
  cladWall(parts.wood, lining, 'x', ZB, -1, -W, W, F, () => wallH(ZB), backHoles);
  cladWall(parts.wood, lining, 'x', ZF, 1, -W, W, F, () => wallH(ZF), frontHoles);
  cladWall(parts.wood, lining, 'z', -W, -1, ZB, ZF, F, wallH, leftHoles);
  cladWall(parts.wood, lining, 'z', W, 1, ZB, ZF, F, wallH, rightHoles);
  // Corner posts.
  for (const lx of [-W, W]) {
    for (const lz of [ZB, ZF]) b.box(0.16, wallH(lz) + 0.35, 0.16, lx, F + (wallH(lz) - 0.35) / 2, lz, POST);
  }
  const wallT = 0.09;
  const top = (z: number): number => F + wallH(z);
  solid(-W, W, ZB - wallT, ZB + wallT, F, top(ZB));
  solid(-W - wallT, -W + wallT, ZB, ZF, F, top(ZF));
  solid(W - wallT, W + wallT, ZB, ZF, F, top(ZF));

  // Window frames and glass in the holes.
  const frameHole = (axis: 'x' | 'z', at: number, h: Hole): void => {
    const len = h.u1 - h.u0;
    const hh = h.v1 - h.v0;
    const uc = (h.u0 + h.u1) / 2;
    const vc = F + (h.v0 + h.v1) / 2;
    const t = 0.05;
    if (axis === 'x') {
      b.box(len + t, t, 0.2, uc, F + h.v0, at, FRAME);
      b.box(len + t, t, 0.2, uc, F + h.v1, at, FRAME);
      b.box(t, hh, 0.2, h.u0, vc, at, FRAME);
      b.box(t, hh, 0.2, h.u1, vc, at, FRAME);
      glass.box(len, hh, 0.02, uc, vc, at, '#ffffff');
    } else {
      b.box(0.2, t, len + t, at, F + h.v0, uc, FRAME);
      b.box(0.2, t, len + t, at, F + h.v1, uc, FRAME);
      b.box(0.2, hh, t, at, vc, h.u0, FRAME);
      b.box(0.2, hh, t, at, vc, h.u1, FRAME);
      glass.box(0.02, hh, len, at, vc, uc, '#ffffff');
    }
  };
  for (const h of backHoles) frameHole('x', ZB, h);
  for (const h of leftHoles) frameHole('z', -W, h);
  for (const h of rightHoles) frameHole('z', W, h);

  // The glass wall: three fixed panes and an opening on the right with the sliding pane parked
  // in front of its neighbour.
  const mullions = [-3.4, -1.9, 0.4, 2.0, 3.4];
  for (const mx of mullions) b.box(0.06, glassTop, 0.1, mx, F + glassTop / 2, ZF, FRAME);
  b.box(6.86, 0.08, 0.12, 0, F + glassTop, ZF, FRAME);
  b.box(5.46, 0.03, 0.1, -0.7, F + 0.015, ZF, FRAME);
  const panes: Array<[number, number]> = [[-3.4, -1.9], [-1.9, 0.4], [0.4, 2.0]];
  for (const [x0, x1] of panes) {
    glass.box(x1 - x0 - 0.04, glassTop - 0.06, 0.02, (x0 + x1) / 2, F + glassTop / 2, ZF, '#ffffff');
    solid(x0, x1, ZF - 0.06, ZF + 0.06, F, F + glassTop);
  }
  // Sliding pane (open): parked outside the middle-right fixed pane.
  glass.box(1.56, glassTop - 0.08, 0.02, 1.22, F + glassTop / 2, ZF + 0.08, '#ffffff');
  b.box(0.04, glassTop - 0.06, 0.04, 2.0, F + glassTop / 2, ZF + 0.08, FRAME);
  b.box(0.04, glassTop - 0.06, 0.04, 0.44, F + glassTop / 2, ZF + 0.08, FRAME);
  // Above the door opening only the camera can reach (the walker's head is lower).
  cameraSolids.push({ x0: 2.0, x1: 3.4, z0: ZF - 0.08, z1: ZF + 0.08, y0: F + glassTop - 0.05, y1: top(ZF) });

  // ---- Roof: one slab sloping up toward the sea, with a pale soffit / ceiling ----
  const roofZ0 = ZB - 0.45;
  const roofZ1 = D.deckFront - 0.5;
  const roofHalfX = W + 0.4;
  const angle = Math.atan(slope);
  const roofLen = (roofZ1 - roofZ0) / Math.cos(angle);
  const roofMidZ = (roofZ0 + roofZ1) / 2;
  const roofT = 0.16;
  // A box rotated by −angle around X rises toward +Z.
  b.box(roofHalfX * 2, roofT, roofLen, 0, top(roofMidZ) + roofT / 2, roofMidZ, ROOF, -angle);
  lining.box(roofHalfX * 2 - 0.02, 0.025, roofLen - 0.02, 0, top(roofMidZ) - 0.015, roofMidZ, LINING, -angle);
  // Wooden fascia boards on the roof edges.
  b.box(roofHalfX * 2 + 0.04, 0.26, 0.05, 0, top(roofZ1) + 0.05, roofZ1 + 0.02, POST);
  b.box(roofHalfX * 2 + 0.04, 0.26, 0.05, 0, top(roofZ0) + 0.05, roofZ0 - 0.02, POST);
  for (const sx of [-1, 1]) b.box(0.05, 0.26, roofLen, sx * (roofHalfX + 0.02), top(roofMidZ) + 0.05, roofMidZ, POST, -angle);
  const roofTop = (z: number): number => top(z) + roofT / Math.cos(angle);
  // Slim posts carrying the roof over the deck.
  for (const lx of [-3.5, 3.5]) b.box(0.1, top(roofZ1 - 0.15) - F, 0.1, lx, (F + top(roofZ1 - 0.15)) / 2, roofZ1 - 0.15, FRAME);
  solid(-3.55, -3.45, roofZ1 - 0.2, roofZ1 - 0.1, F, top(roofZ1));
  solid(3.45, 3.55, roofZ1 - 0.2, roofZ1 - 0.1, F, top(roofZ1));

  // Solar panels: 2 rows × 4, slightly raised above the roof, with cell lines.
  for (const zc of [-1.75, 0.0]) {
    for (const xc of [-2.65, -1.55, -0.45, 0.65]) {
      const y = roofTop(zc) + 0.07;
      b.box(1.04, 0.04, 1.66, xc, y, zc, '#b8bec4', -angle);
      b.box(1.0, 0.045, 1.62, xc, y + 0.004, zc, '#1b2740', -angle);
      for (const dz of [-0.4, 0, 0.4]) b.box(0.98, 0.048, 0.012, xc, y + 0.006 + dz * Math.sin(angle), zc + dz * Math.cos(angle), '#43506a', -angle);
      b.box(0.012, 0.048, 1.6, xc, y + 0.006, zc, '#43506a', -angle);
    }
  }
  // Starlink: a flat white dish on a short mast at the back right corner, cable down the wall.
  const mastX = 3.25;
  const mastZ = ZB - 0.2;
  const mastBase = roofTop(mastZ);
  b.add(cylinder(0.025, 0.9, 8, mastX, mastBase + 0.45, mastZ), '#c9cdd1');
  b.box(0.52, 0.035, 0.3, mastX, mastBase + 0.95, mastZ, '#f2f2ef', -0.55);
  b.box(0.08, 0.06, 0.08, mastX, mastBase + 0.9, mastZ, '#c9cdd1');
  b.box(0.015, mastBase - F + 0.2, 0.015, W + 0.08, (mastBase + F - 0.2) / 2, ZB + 0.25, METAL);
  // Battery and inverter for the solar panels, under the floor by the right-hand stilt.
  b.box(0.55, 0.85, 0.22, 3.4 - 0.5, F - 0.9, 0, '#e9e9e4');
  b.box(0.4, 0.5, 0.16, 3.4 - 0.5, F - 0.85, -0.45, '#8e959b');
  b.box(0.03, 0.4, 0.03, 3.4 - 0.5, F - 0.35, 0, METAL);

  // ---- Deck: glass railing with a wooden cap, open at the steps ----
  const railH = 1.0;
  const stairsX = 2.8;
  const stairsHalf = 0.5;
  const edge = D.deckFront - 0.05;
  const railSegs: Array<[number, number, number, number]> = [
    [-3.55, edge, stairsX - stairsHalf - 0.05, edge],
    [stairsX + stairsHalf + 0.05, edge, 3.55, edge],
    [-3.55, ZF + 0.05, -3.55, edge],
    [3.55, ZF + 0.05, 3.55, edge],
  ];
  for (const [x0, z0, x1, z1] of railSegs) {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    glass.box(alongX ? len : 0.015, railH - 0.08, alongX ? 0.015 : len, cx, F + (railH - 0.08) / 2 + 0.02, cz, '#ffffff');
    b.box(alongX ? len + 0.04 : 0.07, 0.04, alongX ? 0.07 : len + 0.04, cx, F + railH, cz, OAK);
    for (const [px, pz] of [[x0, z0], [x1, z1]]) b.box(0.04, railH, 0.04, px, F + railH / 2, pz, FRAME);
    solid(cx - (alongX ? len / 2 : 0.05), cx + (alongX ? len / 2 : 0.05), cz - (alongX ? 0.05 : len / 2), cz + (alongX ? 0.05 : len / 2), F, F + railH);
  }

  // ---- Open stairs down from the deck (right end): stringers, thick treads, handrails ----
  const footZ = D.deckFront + 2.0;
  const stepGround = groundAt(stairsX, footZ);
  const totalRise = F - stepGround;
  const count = Math.max(1, Math.ceil(totalRise / 0.19));
  const rise = totalRise / count;
  const run = count * STEP_DEPTH;
  for (let k = 1; k < count; k++) {
    const yTop = F - k * rise;
    const lz = D.deckFront + (k - 0.5) * STEP_DEPTH;
    b.box(stairsHalf * 2 - 0.04, 0.05, STEP_DEPTH + 0.03, stairsX, yTop - 0.025, lz, k % 2 ? DECK_A : DECK_B);
  }
  const slant = Math.atan2(totalRise, run);
  const stringerLen = Math.hypot(run, totalRise) + 0.15;
  for (const sx of [-1, 1]) {
    // Inclined beam from under the deck edge down to the ground; a box rotated by +slant about X
    // falls toward +Z.
    const x = stairsX + sx * stairsHalf;
    b.box(0.06, 0.24, stringerLen, x, F - totalRise / 2 - 0.1, D.deckFront + run / 2, POST, slant);
    // Handrail: posts at both ends, a rail following the slope.
    const yTopPost = F;
    const yFoot = stepGround;
    b.box(0.05, 0.95, 0.05, x, yTopPost + 0.475, D.deckFront + 0.05, FRAME);
    b.box(0.05, 0.95, 0.05, x, yFoot + 0.475, D.deckFront + run - 0.1, FRAME);
    b.box(0.045, 0.045, stringerLen - 0.1, x, (yTopPost + yFoot) / 2 + 0.93, D.deckFront + run / 2 - 0.02, OAK, slant);
  }
  // Stone pad at the foot.
  b.box(1.4, 0.12, 0.7, stairsX, stepGround + 0.02, D.deckFront + run + 0.25, '#8f8d86');
  const stairsLen = Math.max(0, count - 1) * STEP_DEPTH;
  // Lower half of the flight for the camera (the upper treads are under the floor box).
  cameraSolids.push({
    x0: stairsX - stairsHalf, x1: stairsX + stairsHalf, z0: D.deckFront, z1: D.deckFront + stairsLen,
    y0: F - count * rise - 0.5, y1: F - (count / 2) * rise,
  });

  // ---- Interior ----
  furnish(parts, F, (z) => top(z) - 0.02, solid);
  // Baseboards along the inside of the walls.
  for (const [w, d, x, z] of [[6.85, 0.02, 0, ZB + 0.08], [0.02, 4.84, -W + 0.08, 0], [0.02, 4.84, W - 0.08, 0]] as const) {
    b.box(w, 0.08, d, x, F + 0.04, z, OAK_DARK_TRIM);
  }

  // Wall light by the door, outside.
  glow.box(0.12, 0.22, 0.06, 3.38, F + 2.15, ZF + 0.12, '#ffffff');

  // Monitors: two screens on the desk, angled toward the chair.
  const screens: HouseInfo['screens'] = [];
  // 24" screens sit low on short stands, so the sea stays in view above them.
  const seatX = DESK.seatX;
  const seatZ = DESK.seatZ;
  // Seated facing the sea (local +Z), local −X is on your right: list the left screen first.
  for (const [mx, theta] of [[-0.51, 0.17], [-1.09, -0.17]] as const) {
    const my = F + 0.94;
    const mz = 2.16;
    const bezel = new RoundedBoxGeometry(0.555, 0.325, 0.022, 2, 0.008);
    bezel.rotateY(theta);
    bezel.translate(mx, my, mz);
    parts.soft.add(bezel, '#121314');
    b.box(0.05, 0.16, 0.03, mx - Math.sin(theta) * 0.04, F + 0.82, mz + Math.cos(theta) * 0.04, '#2a2c2f', 0, theta);
    b.box(0.22, 0.012, 0.16, mx - Math.sin(theta) * 0.04, F + 0.746, mz + Math.cos(theta) * 0.05, '#2a2c2f', 0, theta);
    const mat = new THREE.MeshBasicMaterial({ color: '#000000', toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 0.3), mat);
    // The plane faces +Z by default; turn it to face the chair (local −Z, angled by theta).
    screen.rotation.y = Math.PI + theta;
    screen.position.set(mx + Math.sin(theta) * 0.012, my, mz - Math.cos(theta) * 0.012);
    screen.name = 'monitor';
    screens.push(screen);
  }

  // ---- Materials and meshes ----
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6, metalness: 0.1 });
  const softMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: '#fff3dd',
    roughness: 0.8,
    emissive: new THREE.Color('#ffc46b'),
    emissiveIntensity: 0,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: '#a9c6d2',
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });

  const group = new THREE.Group();
  group.name = 'house';
  const meshes = [
    new THREE.Mesh(parts.wood.build(), woodMat),
    new THREE.Mesh(lining.build(), woodMat),
    new THREE.Mesh(parts.plain.build(), plainMat),
    new THREE.Mesh(parts.soft.build(), softMat),
    new THREE.Mesh(parts.leaf.build(), leafMat),
  ];
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  const glassMesh = new THREE.Mesh(glass.build(), glassMaterial);
  glassMesh.name = 'glass';
  const glowMesh = new THREE.Mesh(glow.build(), windowMaterial);
  const lamp = new THREE.PointLight('#ffb867', 0, 12, 2);
  lamp.position.set(2.8, F + 2.0, ZF + 0.9);
  const roomLamp = new THREE.PointLight('#ffc27a', 0, 9, 2);
  // Under the washi pendant over the tea table.
  roomLamp.position.set(-2.6, F + 1.25, 1.4);
  const fillLight = new THREE.PointLight('#fff4e6', 0, 9, 1.5);
  fillLight.position.set(-0.5, F + 2.2, 0.6);
  group.add(...meshes, glassMesh, glowMesh, lamp, roomLamp, fillLight, ...screens);
  group.position.set(placement.x, 0, placement.z);
  group.rotation.y = placement.rotY;

  const roofTopY = Math.max(roofTop(roofZ0), roofTop(roofZ1));
  cameraSolids.push(
    { x0: -roofHalfX, x1: roofHalfX, z0: roofZ0, z1: roofZ1, y0: top(ZB) - 0.05, y1: roofTopY + 0.1 },
    { x0: -W - 0.15, x1: W + 0.15, z0: ZB - 0.05, z1: D.deckFront, y0: F - 1.2, y1: F - 0.02 },
  );

  return {
    group,
    floorY: F,
    placement,
    windowMaterial,
    glassMaterial,
    woodMaterial: woodMat,
    lamp,
    roomLamp,
    fillLight,
    ridgeY: roofTopY + 0.2,
    solids,
    cameraSolids,
    floor: { x0: -W - 0.12, x1: W + 0.12, z0: ZB - 0.05, z1: D.deckFront },
    room: { x0: -W, x1: W, z0: ZB, z1: ZF },
    roof: { x0: -roofHalfX, x1: roofHalfX, z0: roofZ0, z1: roofZ1 },
    eaveY: top(ZB) - 0.1,
    stairs: { x: stairsX, halfWidth: stairsHalf, z0: D.deckFront, count, rise, depth: STEP_DEPTH },
    desk: { seatX, seatZ, eyeY: F + 1.24, standX: -0.15, standZ: 0.75, facesSea: true, pitch: -0.13 },
    bath: { seatX: 2.62, seatZ: -1.72, eyeY: F + 0.86, standX: 1.75, standZ: -0.9, facesSea: false, pitch: -0.14 },
    screens,
  };
}

/**
 * A wall along `axis` (front/back: 'x'; sides: 'z') at the fixed coordinate `at`, from u0 to u1,
 * with its top at `height(u)` above `baseY`. Outside: vertical boards in a few dark tones
 * (`outward` = which side faces out); inside: a pale lining. Holes are left open.
 */
function cladWall(
  b: GeoBuilder,
  lining: GeoBuilder,
  axis: 'x' | 'z',
  at: number,
  outward: number,
  u0: number,
  u1: number,
  baseY: number,
  height: (u: number) => number,
  holes: Hole[],
): void {
  const BOARD = 0.18;
  const n = Math.ceil((u1 - u0) / BOARD);
  for (let i = 0; i < n; i++) {
    const a = u0 + i * BOARD;
    const c = Math.min(u1, a + BOARD);
    // Split the board where holes start or end, so openings get clean edges.
    const cuts = [a, c, ...holes.flatMap((h) => [h.u0, h.u1]).filter((x) => x > a && x < c)].sort((p, q) => p - q);
    for (let j = 0; j < cuts.length - 1; j++) {
      const s0 = cuts[j];
      const s1 = cuts[j + 1];
      if (s1 - s0 < 1e-4) continue;
      const mid = (s0 + s1) / 2;
      const H = height(axis === 'z' ? mid : at);
      const covering = holes.filter((h) => h.u0 <= mid && mid <= h.u1).sort((p, q) => p.v0 - q.v0);
      const spans: Array<[number, number]> = [];
      let v = -0.3;
      for (const h of covering) {
        if (h.v0 > v) spans.push([v, h.v0]);
        v = Math.max(v, h.v1);
      }
      if (v < H) spans.push([v, H]);
      const color = CLAD[(i * 7 + 3) % CLAD.length];
      for (const [v0, v1] of spans) {
        const len = s1 - s0;
        const y = baseY + (v0 + v1) / 2;
        const outer = at + outward * 0.065;
        const inner = at - outward * 0.05;
        const lv0 = Math.max(v0, 0);
        const ly = baseY + (lv0 + v1) / 2;
        if (axis === 'x') {
          b.box(len, v1 - v0, 0.035, mid, y, outer, color);
          if (v1 > lv0) lining.box(len, v1 - lv0, 0.03, mid, ly, inner, LINING);
        } else {
          b.box(0.035, v1 - v0, len, outer, y, mid, color);
          if (v1 > lv0) lining.box(0.03, v1 - lv0, len, inner, ly, mid, LINING);
        }
      }
    }
  }
}
