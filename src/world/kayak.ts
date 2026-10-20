import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder';
import { createRng } from '../core/rng';
import { HULL, PADDLE } from '../activities/kayakPhysics';

const C = {
  hull: '#ffbf1a',
  hullLow: '#f2a20c',
  deck: '#ffd03f',
  seat: '#26384a',
  seatEdge: '#1b2834',
  black: '#1d1f22',
  hatch: '#2a2c2f',
  shaft: '#2e3238',
  blade: '#eef0ec',
  bladeEdge: '#1f8a86',
} as const;

export interface KayakModel {
  /** Origin at the waterline in the middle of the hull, bow toward −Z. */
  group: THREE.Group;
  /** The paddle: shaft along local X (left → right), blade faces ±Z. Child of `group`. */
  paddle: THREE.Group;
}

/** Hull half width along the boat (t = 0 bow … 1 stern): a fine bow, fullest just aft of the middle. */
const halfWidth = (t: number): number => HULL.halfBeam * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.94 + 0.03)), t < 0.55 ? 0.62 : 0.45);
/** Deck edge height above the waterline: the ends sweep up a little. */
const sheer = (t: number): number => 0.2 + 0.09 * Math.pow(Math.abs(2 * t - 1), 3);
/** Keel depth: full under the paddler, rising at the ends (rocker). */
const keel = (t: number): number => -HULL.draft + 0.11 * Math.pow(Math.abs(2 * t - 1), 2.5);
const smooth = (e0: number, e1: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};
/** How deep the cockpit is moulded into the deck at z: down to the seat, shallower at the feet. */
function recess(z: number): number {
  const sz = HULL.seatZ;
  const seat = smooth(sz + 0.45, sz + 0.3, z) * smooth(sz - 0.3, sz - 0.15, z);
  const feet = smooth(sz + 0.1, sz - 0.1, z) * smooth(sz - 1.25, sz - 1.0, z);
  return Math.max(seat * 0.14, feet * 0.075);
}
/** Deck height at (t along the boat, x across), including the cockpit recess. */
function deckY(t: number, x: number): number {
  const w = Math.max(halfWidth(t), 1e-4);
  const z = -HULL.length / 2 + t * HULL.length;
  const across = 1 - smooth(0.5, 0.82, Math.abs(x) / w);
  return sheer(t) + 0.03 * (1 - (x / w) ** 2) - recess(z) * across;
}

/**
 * A sit-on-top touring kayak (the kind rented on tropical beaches): yellow rotomoulded hull,
 * a moulded seat with a padded back, footwells, carry handles, a round hatch and deck
 * bungees at the bow. Two draw calls: hull + fittings, and the paddle.
 */
export function createKayak(seed: number): KayakModel {
  const rng = createRng(seed);
  const group = new THREE.Group();
  group.name = 'kayak';
  const plastic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
  const hull = new THREE.Mesh(hullGeometry(), plastic);
  hull.castShadow = true;
  hull.receiveShadow = true;

  const L = HULL.length;
  const zAt = (t: number): number => -L / 2 + t * L;
  const tAt = (z: number): number => (z + L / 2) / L;
  const b = new GeoBuilder(rng, 0.03);
  // Moulded seat: a dark pad in a shallow well, a padded backrest on two straps.
  const sz = HULL.seatZ;
  const seatTop = HULL.seatY;
  b.add(rounded(0.42, 0.04, 0.46, 0, seatTop - 0.02, sz + 0.02), C.seat);
  {
    // Backrest: a padded board leaning back, rounded at the top corners.
    const shape = new THREE.Shape();
    const w = 0.19;
    shape.moveTo(-w, 0);
    shape.lineTo(w, 0);
    shape.lineTo(w, 0.2);
    shape.quadraticCurveTo(w, 0.27, w - 0.07, 0.27);
    shape.lineTo(-w + 0.07, 0.27);
    shape.quadraticCurveTo(-w, 0.27, -w, 0.2);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
    g.rotateX(-0.25);
    g.translate(0, seatTop + 0.02, sz + 0.22);
    b.add(g, C.seat);
  }
  // Straps from the top of the backrest to the deck beside the seat.
  for (const s of [-1, 1]) b.box(0.022, 0.01, 0.34, s * 0.19, seatTop + 0.22, sz + 0.14, C.black, 0.62);
  // Footwells: three moulded steps on each side ahead of the seat.
  for (let k = 0; k < 3; k++) {
    for (const s of [-1, 1]) {
      const z = sz - 0.72 - k * 0.15;
      b.box(0.1, 0.03, 0.07, s * 0.16, deckY(tAt(z), s * 0.16) + 0.005, z, C.hullLow);
    }
  }
  // Round hatch at the bow and bungee cords over the deck in front of it; one behind the seat.
  {
    const z = zAt(0.2);
    const g = new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20);
    g.translate(0, deckY(0.2, 0) + 0.008, z);
    b.add(g, C.hatch);
    for (const dz of [-0.28, -0.42]) {
      const t = tAt(z + dz);
      const w = halfWidth(t) * 0.82;
      b.box(w * 2, 0.008, 0.008, 0, deckY(t, 0) + 0.006, z + dz, C.black);
      for (const s of [-1, 1]) b.box(0.012, 0.012, 0.16, s * w, deckY(t, w) + 0.006, z + dz + 0.07, C.black, 0, s * 0.3);
    }
    const zs = sz + 0.75;
    const ts = tAt(zs);
    const ws = halfWidth(ts) * 0.8;
    for (const dz of [0, 0.16]) b.box(ws * 2, 0.008, 0.008, 0, deckY(ts, 0) + 0.006, zs + dz, C.black);
  }
  // Toggle handles on short loops at bow and stern.
  for (const t of [0.015, 0.985]) {
    const g = new THREE.TorusGeometry(0.05, 0.008, 6, 14);
    g.rotateY(Math.PI / 2);
    g.translate(0, sheer(t) + 0.03, zAt(t) + (t < 0.5 ? 0.04 : -0.04));
    b.add(g, C.black);
  }
  const fittings = new THREE.Mesh(b.build(), plastic);
  fittings.castShadow = true;
  fittings.receiveShadow = true;
  group.add(hull, fittings);

  const paddle = new THREE.Group();
  paddle.name = 'paddle';
  const pb = new GeoBuilder(rng, 0);
  const shaft = new THREE.CylinderGeometry(0.015, 0.015, PADDLE.half * 2 * 0.66, 10);
  shaft.rotateZ(Math.PI / 2);
  pb.add(shaft, C.shaft);
  // Drip rings just inside the blades.
  for (const s of [-1, 1]) {
    const ring = new THREE.CylinderGeometry(0.035, 0.035, 0.006, 14);
    ring.rotateZ(Math.PI / 2);
    ring.translate(s * PADDLE.half * 0.56, 0, 0);
    pb.add(ring, C.black);
    pb.add(blade(s), C.blade);
    const edge = blade(s, 1.04, 0.004);
    edge.translate(0, 0, -0.002);
    pb.add(edge, C.bladeEdge);
  }
  const paddleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
  const pm = new THREE.Mesh(pb.build(), paddleMat);
  pm.castShadow = true;
  paddle.add(pm);
  group.add(paddle);
  return { group, paddle };
}

/** Superellipse cross sections lofted along the boat; one colour per quad (deck vs hull). */
function hullGeometry(): THREE.BufferGeometry {
  const sections = 48;
  const around = 28;
  const pos: number[] = [];
  const index: number[] = [];
  const L = HULL.length;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const z = -L / 2 + t * L;
    const w = halfWidth(t);
    const top = sheer(t);
    const bot = keel(t);
    // Round the very ends to a point.
    const end = Math.min(1, Math.min(t, 1 - t) / 0.02);
    for (let j = 0; j <= around; j++) {
      // j: port deck edge → keel → starboard deck edge → back over the deck (closed loop).
      const a = (j / around) * Math.PI * 2;
      const s = Math.sin(a);
      const c = Math.cos(a);
      // a = π: keel. Lower half (cos < 0): the rounded hull; upper half: the deck.
      const x = w * Math.sign(s) * Math.pow(Math.abs(s), 0.55) * end;
      const y = c < 0 ? top - (top - bot) * Math.pow(-c, 0.8) : deckY(t, x);
      pos.push(x, y, z);
    }
  }
  const triColor: THREE.Color[] = [];
  const deck = new THREE.Color(C.deck);
  const hullC = new THREE.Color(C.hull);
  const low = new THREE.Color(C.hullLow);
  for (let i = 0; i < sections; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
      const ang = ((j + 0.5) / around) * Math.PI * 2;
      const k = Math.cos(ang) > 0 ? deck : Math.cos(ang) < -0.7 ? low : hullC;
      triColor.push(k, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  // Smooth normals from the shared vertices (rotomoulded plastic has no facets), then split
  // the triangles so each quad can carry its own colour.
  g.computeVertexNormals();
  const flat = g.toNonIndexed();
  g.dispose();
  const col = new Float32Array(triColor.length * 9);
  triColor.forEach((k, n) => {
    for (let v = 0; v < 3; v++) col.set([k.r, k.g, k.b], (n * 3 + v) * 3);
  });
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return flat;
}

/** A rounded pad (a squashed sphere) centered at (x, y, z), tilted by `rx`. */
function rounded(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 16, 8);
  g.scale(w, h, d);
  g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

/** An asymmetric touring blade at the shaft's end `s` (−1 left, +1 right), in the XY plane. */
function blade(s: number, grow = 1, thick = 0.008): THREE.BufferGeometry {
  const len = PADDLE.half * (1 - PADDLE.bladeFrom) * grow;
  const shape = new THREE.Shape();
  const n = 14;
  // Upper edge straighter, lower edge fuller: the classic asymmetric touring shape.
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const y = 0.09 * grow * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.95)), 0.6) * (0.55 + 0.45 * u);
    if (i === 0) shape.moveTo(0, 0.012);
    shape.lineTo(u * len, y);
  }
  for (let i = n; i >= 0; i--) {
    const u = i / n;
    const y = -0.07 * grow * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + u * 0.95)), 0.8) * (0.6 + 0.4 * u);
    shape.lineTo(u * len, Math.min(-0.012, y));
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  const x0 = PADDLE.half * PADDLE.bladeFrom - 0.02;
  if (s < 0) {
    g.scale(-1, 1, 1);
    g.translate(-x0, 0, 0);
  } else {
    g.translate(x0, 0, 0);
  }
  return g;
}
