import type { Heightmap } from './heightmap';
import type { Rng } from '../core/rng';
import { Trail } from './trail';
import type { SurfFrame } from '../water/surf';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface Placement {
  x: number;
  z: number;
  /** Rotation around +Y, radians. */
  rotY: number;
}

export interface RockPlacement {
  x: number;
  z: number;
  scale: number;
  rotY: number;
  variant: number;
}

/** Where the hand-placed things go. Derived from the heightmap so it survives terrain tweaks. */
export interface IslandLayout {
  house: Placement;
  umbrella: Placement;
  boat: Placement;
  /** The kayak, pulled up on the sand beside the house (away from the trail), bow to the water. */
  kayak: Placement;
  rocks: RockPlacement[];
  /** Areas kept free of palms. */
  clearings: Circle[];
  /** The footpath through the forest. */
  trail: Trail;
  /** The surf break (a quarter of the way round the island from the house) and its board on the sand. */
  surf: { frame: SurfFrame; board: Placement };
  /** A hammock between two coconut palms on the dry sand, along the beach. */
  hammock: HammockLayout;
}

export interface HammockLayout {
  /** Midpoint between the two palms (ground). */
  x: number;
  z: number;
  /** The two palms; their local +X (the way they lean) points away from the hammock. */
  palms: [Placement, Placement];
  /** Kept free of other trees and undergrowth. */
  clearing: Circle;
}

/** Palm-to-palm distance of the hammock (m). */
export const HAMMOCK_SPAN = 4.2;

/**
 * True inside the wedge seen from the house's glass wall toward the sea (house-local +Z,
 * about ±45°): trees are kept out so the view from the desk stays open.
 */
export function inHouseView(house: Placement, x: number, z: number): boolean {
  const dx = x - house.x;
  const dz = z - house.z;
  const c = Math.cos(house.rotY);
  const s = Math.sin(house.rotY);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return lz > 2 && lz < 90 && Math.abs(lx) < 5 + lz;
}

/**
 * The deck's steps (house-local x of their center line, half their width) and where the
 * stone path from their foot starts (house-local z; it runs straight on, down to the sea).
 */
export const STAIRS = { x: 2.5, halfWidth: 0.72, pathFrom: 8.1 } as const;

/** House-local point (+Z toward the sea) to world x, z. */
export function houseToWorld(house: Placement, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(house.rotY);
  const s = Math.sin(house.rotY);
  return { x: house.x + lx * c + lz * s, z: house.z - lx * s + lz * c };
}

/**
 * Distance (m) from the center line of the steps and the stone path below them, from the deck
 * edge down to the sea; Infinity anywhere else.
 */
export function stairsPathDistance(house: Placement, x: number, z: number): number {
  const dx = x - house.x;
  const dz = z - house.z;
  const c = Math.cos(house.rotY);
  const s = Math.sin(house.rotY);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return lz > 4.2 && lz < 60 ? Math.abs(lx - STAIRS.x) : Infinity;
}

/**
 * True on the steps or the path from them to the sea (a strip a little wider than the flight,
 * widened by `margin`, e.g. a bush's spread). Bushes, flowers and rocks stay out of it.
 */
export function inStairsPath(house: Placement, x: number, z: number, margin = 0): boolean {
  return stairsPathDistance(house, x, z) < STAIRS.halfWidth + 1.3 + margin;
}

/** Compass direction (radians, in the x-z plane) the house faces. */
const HOUSE_ANGLE = 0.7;
/** The surf beach: a long, gently shelving stretch of sand with no rocks, out of the desk's view. */
const SURF_ANGLE = HOUSE_ANGLE + 1.5;
/** The hammock: a little past the beach umbrella, along the same beach. */
const HAMMOCK_ANGLE = HOUSE_ANGLE + 0.62;

export function createLayout(hm: Heightmap, rng: Rng): IslandLayout {
  // House: a little inland from the dry-sand line, door facing the sea.
  const houseR = hm.shoreDistance(HOUSE_ANGLE, 1.4) - 9;
  const house: Placement = {
    x: Math.cos(HOUSE_ANGLE) * houseR,
    z: Math.sin(HOUSE_ANGLE) * houseR,
    // Rotates local +Z (the door side) to point along HOUSE_ANGLE.
    rotY: Math.PI / 2 - HOUSE_ANGLE,
  };

  const umbrellaAngle = HOUSE_ANGLE + 0.32;
  const umbrellaR = hm.shoreDistance(umbrellaAngle, 0) - 7;
  const umbrella: Placement = {
    x: Math.cos(umbrellaAngle) * umbrellaR,
    z: Math.sin(umbrellaAngle) * umbrellaR,
    rotY: Math.PI / 2 - umbrellaAngle,
  };

  const boatAngle = HOUSE_ANGLE - 0.28;
  const boatR = hm.shoreDistance(boatAngle, -1.3);
  const boat: Placement = {
    x: Math.cos(boatAngle) * boatR,
    z: Math.sin(boatAngle) * boatR,
    rotY: -boatAngle + 0.4,
  };

  const kayakAngle = HOUSE_ANGLE - 0.1;
  const kayakR = hm.shoreDistance(kayakAngle, 0.45);
  const kx = Math.cos(kayakAngle) * kayakR;
  const kz = Math.sin(kayakAngle) * kayakR;
  // Bow (local −Z, i.e. (−sin rotY, −cos rotY)) straight down the beach, toward the water.
  const kgx = hm.heightAt(kx + 2, kz) - hm.heightAt(kx - 2, kz);
  const kgz = hm.heightAt(kx, kz + 2) - hm.heightAt(kx, kz - 2);
  const kayak: Placement = { x: kx, z: kz, rotY: Math.atan2(kgx, kgz) };

  // Surf break: its waterline point, the swell heading straight in. The board lies on the dry
  // sand above it, nose to the sea.
  const surfR = hm.shoreDistance(SURF_ANGLE, 0);
  const sc = Math.cos(SURF_ANGLE);
  const ss = Math.sin(SURF_ANGLE);
  const boardR = hm.shoreDistance(SURF_ANGLE + 0.04, 0.7);
  const surf = {
    frame: { ox: sc * surfR, oz: ss * surfR, ux: -sc, uz: -ss },
    // Nose (local −Z) out to sea: (−sin rotY, −cos rotY) = (cos a, sin a).
    board: { x: Math.cos(SURF_ANGLE + 0.04) * boardR, z: Math.sin(SURF_ANGLE + 0.04) * boardR, rotY: Math.atan2(-sc, -ss) },
  };

  // Hammock: on the dry sand above the swash, slung along the shore; the palms lean apart and a
  // little out to sea, like coconut palms on a beach do. Start where the beach is 0.75 m up and
  // step inland until both palms and the middle stand on sand.
  const hc = Math.cos(HAMMOCK_ANGLE);
  const hs = Math.sin(HAMMOCK_ANGLE);
  const at = (r: number, side: number): { x: number; z: number } => ({
    x: hc * r - hs * side * (HAMMOCK_SPAN / 2),
    z: hs * r + hc * side * (HAMMOCK_SPAN / 2),
  });
  const sandy = (q: { x: number; z: number }): boolean => hm.surfaceAt(q.x, q.z) === 'sand' && hm.heightAt(q.x, q.z) > 0.7;
  let hr = hm.shoreDistance(HAMMOCK_ANGLE, 0.75);
  for (let dr = 0; dr < 8; dr += 0.25) {
    const r = hm.shoreDistance(HAMMOCK_ANGLE, 0.75) - dr;
    if (sandy(at(r, -1)) && sandy(at(r, 1)) && sandy(at(r, 0))) {
      // A step further up the beach if that's still sand: a little more room to the water.
      hr = sandy(at(r - 1, -1)) && sandy(at(r - 1, 1)) ? r - 1 : r;
      break;
    }
  }
  const hx = hc * hr;
  const hz = hs * hr;
  const palm = (side: number): Placement => {
    const q = at(hr, side);
    // Lean: away from the other palm (tangent × side), a little seaward.
    const lx = -hs * side + 0.45 * hc;
    const lz = hc * side + 0.45 * hs;
    // Rotation θ maps local +X to (cos θ, −sin θ).
    return { x: q.x, z: q.z, rotY: Math.atan2(-lz, lx) };
  };
  const hammock: HammockLayout = {
    x: hx,
    z: hz,
    palms: [palm(-1), palm(1)],
    clearing: { x: hx, z: hz, r: HAMMOCK_SPAN / 2 + 2.5 },
  };

  const clearings: Circle[] = [
    hammock.clearing,
    { x: house.x, z: house.z, r: 11 },
    { x: umbrella.x, z: umbrella.z, r: 5 },
    // Path from the porch steps down to the beach.
    { x: (house.x + umbrella.x) / 2, z: (house.z + umbrella.z) / 2, r: 4 },
    // No palm right over the surfboard.
    { x: surf.board.x, z: surf.board.z, r: 5 },
  ];

  const rocks: RockPlacement[] = [];
  const addRock = (angle: number, targetH: number, scale: number): void => {
    const r = hm.shoreDistance(angle, targetH);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (clearings.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + scale)) return;
    if (inStairsPath(house, x, z, scale)) return;
    // No rocks in the surf break.
    if (Math.hypot(x - surf.frame.ox, z - surf.frame.oz) < 60) return;
    rocks.push({ x, z, scale, rotY: rng() * Math.PI * 2, variant: Math.floor(rng() * 3) });
  };
  // Clusters along the shoreline, some half-submerged.
  for (let c = 0; c < 7; c++) {
    const base = rng() * Math.PI * 2;
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      addRock(base + (rng() - 0.5) * 0.12, -0.6 + rng() * 1.4, 0.5 + rng() * 1.3);
    }
  }
  // A few lone rocks a bit further out in the water.
  for (let k = 0; k < 5; k++) addRock(rng() * Math.PI * 2, -1.8 - rng() * 1.5, 0.9 + rng() * 1.0);

  return { house, umbrella, boat, kayak, rocks, clearings, trail: new Trail(hm, house), surf, hammock };
}
