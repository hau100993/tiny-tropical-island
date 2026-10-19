import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';
import type { GeoBuilder } from './geoBuilder';

/** Builders the interior is drawn with (one draw call each). */
export interface InteriorParts {
  /** Wood with procedural grain (flat-shaded boxes). */
  wood: GeoBuilder;
  /** Metal, plastic, stone (flat-shaded). */
  plain: GeoBuilder;
  /** Rounded, smooth-shaded things: cushions, futon, ceramics, chair. */
  soft: GeoBuilder;
  /** Leaves: double-sided, smooth. */
  leaf: GeoBuilder;
  /** Lamp shades: glow at night. */
  glow: GeoBuilder;
  /** Keyboard backlight (an animated RGB shader). */
  rgb: GeoBuilder;
}

export type SolidFn = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => void;

const OAK = '#c89b6a';
const OAK_LIGHT = '#d8b688';
const OAK_DARK = '#8a6240';
const METAL = '#1e2124';
const TATAMI = '#cbbf8a';
const TATAMI_EDGE = '#4a4636';
const CHROME = '#c3c8cc';
const HINOKI = '#dcbf8f';
const CERAMIC = '#ebe7df';
const STEM = '#4f7a3a';
const MONSTERA = ['#2b5a2c', '#336a33', '#2f6230', '#3b7538'];

/** Monitors and chair position (shared with house.ts, which places the screens). */
export const DESK = { seatX: -0.8, seatZ: 1.1 } as const;

/**
 * Japanese-minimal interior: desk and chair at the glass, a tea corner with a low chabudai and
 * zabuton cushions by the left window, futon on tatami (back left), a low bookshelf and a
 * monstera against the back wall, an open bath corner (back right: hinoki tub at a big window
 * onto the forest, rain shower), a snake plant by the door, timber beams under the ceiling.
 */
export function furnish(p: InteriorParts, F: number, ceilingY: (z: number) => number, solid: SolidFn): void {
  const { wood, plain, soft, glow } = p;

  // ---- Desk along the glass ----
  wood.box(1.9, 0.04, 0.66, -0.8, F + 0.72, 2.05, OAK);
  for (const lx of [-1.71, 0.11]) plain.box(0.04, 0.7, 0.6, lx, F + 0.35, 2.05, '#2a2a2a');
  solid(-1.75, 0.15, 1.72, 2.38, F, F + 0.76);
  // Felt desk pad, mechanical keyboard, mouse on the right; mug, a washi paper lamp, an orchid.
  workstation(p, F + 0.74);
  soft.add(mug(0.0, F + 0.74, 2.18), CERAMIC);
  akariLamp(p, -1.6, F + 0.74, 2.22);
  orchid(p, -1.56, F + 0.74, 1.86);

  // ---- Office chair (rounded cushions) ----
  const cx = DESK.seatX;
  const cz = DESK.seatZ;
  soft.add(rounded(0.5, 0.08, 0.48, 0.03, cx, F + 0.47, cz), '#2c2f33');
  const back = rounded(0.46, 0.6, 0.06, 0.03, 0, 0, 0);
  back.rotateX(0.12);
  back.translate(cx, F + 0.86, cz - 0.27);
  soft.add(back, '#33373c');
  plain.add(cylinder(0.025, 0.36, 10, cx, F + 0.25, cz), METAL);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    plain.box(0.3, 0.03, 0.04, cx + Math.cos(a) * 0.15, F + 0.06, cz + Math.sin(a) * 0.15, METAL, 0, -a);
    const wheel = new THREE.SphereGeometry(0.025, 8, 6);
    wheel.translate(cx + Math.cos(a) * 0.29, F + 0.025, cz + Math.sin(a) * 0.29);
    soft.add(wheel, '#151618');
  }
  for (const sx of [-1, 1]) soft.add(rounded(0.05, 0.03, 0.3, 0.012, cx + sx * 0.27, F + 0.67, cz - 0.02), '#2c2f33');
  solid(cx - 0.28, cx + 0.28, cz - 0.3, cz + 0.25, F, F + 1.15);

  // ---- Tea corner by the left window: tatami, chabudai, zabuton, tea set, books ----
  const tx = -2.6;
  const tz = 1.4;
  tatami(plain, -3.43, -1.86, 0.42, 2.42, F);
  const top = F + 0.32;
  soft.add(rounded(0.86, 0.035, 0.6, 0.012, tx, top, tz), OAK_LIGHT);
  for (const [dx, dz] of [[-0.36, -0.22], [0.36, -0.22], [-0.36, 0.22], [0.36, 0.22]] as const) {
    wood.box(0.045, 0.29, 0.045, tx + dx, F + 0.155, tz + dz, OAK_DARK);
  }
  solid(tx - 0.43, tx + 0.43, tz - 0.3, tz + 0.3, F, top + 0.02);
  // Cushions: one facing the sea, one at the side.
  soft.add(rounded(0.55, 0.075, 0.55, 0.035, tx, F + 0.09, tz - 0.62), '#5b6b7d');
  soft.add(rounded(0.55, 0.075, 0.55, 0.035, tx - 0.58, F + 0.09, tz + 0.02), '#8a5a4a');
  // Tea set on a small tray: cast-iron teapot, two cups.
  wood.box(0.34, 0.015, 0.22, tx + 0.15, top + 0.025, tz + 0.05, OAK_DARK);
  const pot = new TeapotGeometry(0.045, 6);
  pot.translate(tx + 0.1, top + 0.072, tz + 0.05);
  soft.add(pot, '#34302c');
  for (const dx of [0.22, 0.29]) soft.add(cup(tx + dx, top + 0.033, tz + 0.08 - (dx - 0.22) * 0.8), CERAMIC);
  // An open book and a small stack.
  const pageL = rounded(0.15, 0.012, 0.21, 0.004, 0, 0, 0);
  pageL.rotateZ(0.08);
  pageL.translate(tx - 0.2, top + 0.03, tz - 0.08);
  soft.add(pageL, '#f3efe4');
  const pageR = rounded(0.15, 0.012, 0.21, 0.004, 0, 0, 0);
  pageR.rotateZ(-0.08);
  pageR.translate(tx - 0.05, top + 0.03, tz - 0.08);
  soft.add(pageR, '#f3efe4');
  soft.add(rounded(0.16, 0.025, 0.22, 0.004, tx - 0.28, top + 0.03, tz + 0.18), '#2f4a6b');
  soft.add(rounded(0.15, 0.022, 0.2, 0.004, tx - 0.28, top + 0.054, tz + 0.18), '#8a3b2e');
  // Washi pendant lamp low over the table.
  plain.box(0.008, ceilingY(tz) - (F + 1.55), 0.008, tx, (ceilingY(tz) + F + 1.55) / 2, tz, METAL);
  glow.add(sphere(0.21, 0.92, tx, F + 1.38, tz), '#ffffff');

  // ---- Futon on tatami (back left), paper lantern ----
  tatami(plain, -3.43, -1.4, -2.43, -0.4, F);
  soft.add(rounded(0.95, 0.11, 2.0, 0.05, -2.6, F + 0.11, -1.4), '#ece6da');
  const blanket = rounded(0.99, 0.06, 1.15, 0.03, -2.6, F + 0.19, -0.95);
  soft.add(blanket, '#3d5280');
  soft.add(rounded(0.55, 0.1, 0.33, 0.045, -2.6, F + 0.21, -2.12), '#f4f1ea');
  wood.box(0.26, 0.03, 0.26, -1.68, F + 0.065, -2.15, OAK);
  glow.box(0.2, 0.34, 0.2, -1.68, F + 0.25, -2.15, '#ffffff');
  for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as const) {
    wood.box(0.02, 0.36, 0.02, -1.68 + dx, F + 0.26, -2.15 + dz, OAK_DARK);
  }

  // ---- Low bookshelf and a monstera against the back wall ----
  const sx0 = -0.95;
  const sx1 = 0.7;
  wood.box(sx1 - sx0, 0.03, 0.36, (sx0 + sx1) / 2, F + 0.48, -2.25, OAK);
  wood.box(sx1 - sx0, 0.03, 0.36, (sx0 + sx1) / 2, F + 0.24, -2.25, OAK);
  wood.box(sx1 - sx0, 0.03, 0.36, (sx0 + sx1) / 2, F + 0.03, -2.25, OAK);
  for (const x of [sx0, (sx0 + sx1) / 2, sx1]) wood.box(0.03, 0.48, 0.36, x, F + 0.255, -2.25, OAK);
  const spines = ['#8a3b2e', '#2f4a6b', '#d4c7a6', '#4d6b4a', '#c08a3e', '#3a3d42', '#a8a39a'];
  let bx = sx0 + 0.05;
  for (let k = 0; bx < sx1 - 0.08 && k < 22; k++) {
    if (Math.abs(bx - (sx0 + sx1) / 2) < 0.04) bx += 0.06;
    const w = 0.025 + (k % 3) * 0.008;
    const h = 0.16 + ((k * 7) % 5) * 0.012;
    soft.add(rounded(w, h, 0.17, 0.003, bx + w / 2, F + 0.26 + h / 2, -2.25), spines[k % spines.length]);
    bx += w + 0.003;
  }
  soft.add(rounded(0.14, 0.2, 0.14, 0.02, sx0 + 0.2, F + 0.6, -2.25), '#3a3d42');
  soft.add(vase(0.35, F + 0.495, -2.25), '#b9a58c');
  solid(sx0, sx1, -2.45, -2.05, F, F + 0.52);
  monstera(p, 1.05, F, -1.7, 1.0);
  solid(0.8, 1.3, -1.95, -1.45, F, F + 1.4);

  // ---- Open bath corner (back right): slate floor, hinoki tub at a big window onto the
  // forest, a rain shower on the side wall, stool, bucket, towel rail, a fern on the sill ----
  slateFloor(plain, 1.5, 3.44, -2.44, -0.45, F);
  const tx0 = 1.95;
  const tx1 = 3.3;
  const tz0 = -2.36;
  const tz1 = -1.55;
  const th = 0.62;
  const rim = 0.06;
  wood.box(tx1 - tx0, th, rim, (tx0 + tx1) / 2, F + th / 2, tz0, HINOKI);
  wood.box(tx1 - tx0, th, rim, (tx0 + tx1) / 2, F + th / 2, tz1, HINOKI);
  wood.box(rim, th, tz1 - tz0, tx0, F + th / 2, (tz0 + tz1) / 2, HINOKI);
  wood.box(rim, th, tz1 - tz0, tx1, F + th / 2, (tz0 + tz1) / 2, HINOKI);
  // Dark band around the rim (copper hoops of a traditional tub).
  for (const y of [0.15, 0.47]) {
    plain.box(tx1 - tx0 + 0.012, 0.025, 0.012, (tx0 + tx1) / 2, F + y, tz1 + rim / 2, '#6b4a2b');
  }
  plain.box(tx1 - tx0 - rim, 0.02, tz1 - tz0 - rim, (tx0 + tx1) / 2, F + th - 0.1, (tz0 + tz1) / 2, '#86c9c8');
  // Spout over the tub's left end, out of the view through the window.
  plain.add(cylinder(0.015, 0.16, 10, 2.1, F + 0.78, -2.4), CHROME);
  const spout = new THREE.CylinderGeometry(0.014, 0.014, 0.14, 10);
  spout.rotateX(Math.PI / 2);
  spout.translate(2.1, F + 0.86, -2.33);
  plain.add(spout, CHROME);
  solid(tx0 - 0.04, tx1 + 0.04, tz0 - 0.04, tz1 + 0.04, F, F + th);

  // Rain shower on the right wall: drain, pipe, arm, square head, mixer.
  const shX = 3.43;
  const shZ = -0.95;
  plain.box(0.3, 0.006, 0.06, 2.95, F + 0.024, shZ, '#2a2c2f');
  plain.add(cylinder(0.013, 1.95, 10, shX - 0.03, F + 1.15, shZ), CHROME);
  plain.box(0.4, 0.02, 0.02, shX - 0.23, F + 2.12, shZ, CHROME);
  soft.add(rounded(0.26, 0.012, 0.26, 0.004, shX - 0.42, F + 2.1, shZ), CHROME);
  plain.add(cylinder(0.035, 0.012, 16, shX - 0.42, F + 2.092, shZ), '#5a5e63');
  soft.add(rounded(0.03, 0.12, 0.12, 0.01, shX - 0.02, F + 1.1, shZ), CHROME);
  const knob = new THREE.CylinderGeometry(0.025, 0.025, 0.04, 12);
  knob.rotateZ(Math.PI / 2);
  knob.translate(shX - 0.05, F + 1.1, shZ);
  plain.add(knob, CHROME);

  // Stool and bucket by the shower, towel rail with towels.
  wood.box(0.34, 0.03, 0.22, 2.3, F + 0.2, -0.95, HINOKI);
  for (const dx of [-0.13, 0.13]) wood.box(0.04, 0.19, 0.2, 2.3 + dx, F + 0.095, -0.95, HINOKI);
  solid(2.12, 2.48, -1.07, -0.83, F, F + 0.22);
  const bucket = new THREE.CylinderGeometry(0.11, 0.09, 0.14, 16, 1, true);
  bucket.translate(2.3, F + 0.29, -0.95);
  wood.add(bucket, HINOKI);
  plain.add(cylinder(0.1, 0.01, 16, 2.3, F + 0.225, -0.95), HINOKI);
  const rail = new THREE.CylinderGeometry(0.01, 0.01, 0.6, 8);
  rail.rotateX(Math.PI / 2);
  rail.translate(3.4, F + 1.25, -1.85);
  plain.add(rail, CHROME);
  for (const dz of [-0.13, 0.12]) soft.add(rounded(0.045, 0.5, 0.24, 0.02, 3.39, F + 1.03, -1.85 + dz), dz < 0 ? '#f2efe8' : '#c9d6d3');
  // A fern on the window sill, a stack of towels on the tub's end.
  wood.box(1.85, 0.04, 0.16, 2.42, F + 0.69, -2.44, OAK);
  fern(p, 3.05, F + 0.71, -2.42);
  soft.add(rounded(0.3, 0.06, 0.22, 0.02, 2.05, F + th + 0.03, -1.96), '#f2efe8');
  soft.add(rounded(0.28, 0.05, 0.2, 0.02, 2.05, F + th + 0.085, -1.96), '#d9c7a8');

  // ---- Snake plant by the door ----
  soft.add(lathe([[0, 0], [0.13, 0], [0.15, 0.3], [0.155, 0.32], [0.14, 0.32], [0, 0.3]], 3.1, F, 1.05), '#3a3d42');
  for (let k = 0; k < 9; k++) {
    const a = k * 2.39;
    const blade = bladeGeometry(0.06 + (k % 3) * 0.008, 0.65 + ((k * 5) % 4) * 0.09, 0.15 + (k % 2) * 0.1);
    blade.rotateY(a);
    blade.translate(3.1 + Math.cos(a) * 0.05, F + 0.3, 1.05 + Math.sin(a) * 0.05);
    p.leaf.add(blade, k % 2 ? '#4f7a3a' : '#3c6532');
  }
  solid(2.94, 3.26, 0.89, 1.21, F, F + 1.1);

  // ---- Timber beams under the ceiling ----
  for (const z of [-1.9, -0.95, 0, 0.95, 1.9]) wood.box(6.9, 0.12, 0.09, 0, ceilingY(z) - 0.07, z, OAK_DARK);
}

/** A tatami area: mats with dark cloth borders. */
function tatami(plain: GeoBuilder, x0: number, x1: number, z0: number, z1: number, F: number): void {
  const xc = (x0 + x1) / 2;
  const zc = (z0 + z1) / 2;
  plain.box(x1 - x0, 0.05, z1 - z0, xc, F + 0.025, zc, TATAMI);
  const e = 0.035;
  plain.box(x1 - x0, 0.055, e, xc, F + 0.027, z0 + e / 2, TATAMI_EDGE);
  plain.box(x1 - x0, 0.055, e, xc, F + 0.027, z1 - e / 2, TATAMI_EDGE);
  plain.box(e, 0.055, z1 - z0, x0 + e / 2, F + 0.027, zc, TATAMI_EDGE);
  plain.box(e, 0.055, z1 - z0, x1 - e / 2, F + 0.027, zc, TATAMI_EDGE);
  plain.box(e, 0.055, z1 - z0, xc, F + 0.027, zc, TATAMI_EDGE);
}

/**
 * Monstera in a ceramic pot: leaves are heart-shaped with deep side slits and a few holes,
 * cupped and drooping, on curved stems of different heights.
 */
function monstera(p: InteriorParts, x: number, F: number, z: number, scale: number): void {
  const potH = 0.42 * scale;
  p.soft.add(lathe([[0, 0], [0.17, 0], [0.22, potH * 0.9], [0.235, potH], [0.215, potH], [0, potH * 0.92]].map(([r, y]) => [r * scale, y]) as Array<[number, number]>, x, F, z), CERAMIC);
  const soil = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 0.01, 18);
  soil.translate(x, F + potH * 0.93, z);
  p.plain.add(soil, '#3b2a1e');
  const leaves = 9;
  for (let k = 0; k < leaves; k++) {
    const a = k * 2.399 + 0.4;
    const h = (0.55 + (k % 4) * 0.17 + (k / leaves) * 0.15) * scale;
    const reach = (0.22 + (k % 3) * 0.09) * scale;
    const base = new THREE.Vector3(x + Math.cos(a) * 0.04, F + potH * 0.93, z + Math.sin(a) * 0.04);
    const tip = new THREE.Vector3(x + Math.cos(a) * reach, F + h, z + Math.sin(a) * reach);
    const mid = new THREE.Vector3(x + Math.cos(a) * reach * 0.35, F + h * 0.85, z + Math.sin(a) * reach * 0.35);
    const stem = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(base, mid, tip), 10, 0.007 * scale, 5, false);
    p.soft.add(stem, STEM);
    const len = (0.36 + (k % 3) * 0.06) * scale;
    const leaf = monsteraLeaf(len, k);
    // Leaf plane XY (pointing +Y) → tilt outward and down, turn toward its stem's direction.
    leaf.rotateX(-1.1 - (k % 3) * 0.12);
    leaf.rotateY(-a - Math.PI / 2);
    leaf.translate(tip.x, tip.y, tip.z);
    p.leaf.add(leaf, MONSTERA[k % MONSTERA.length]);
  }
}

/** A small potted plant: a cluster of rounded leaves in a ceramic pot. */
/**
 * One monstera leaf in the XY plane, base at the origin, pointing +Y: a heart-shaped outline with
 * deep slits on both sides and two rows of small holes, then cupped and drooping.
 */
function monsteraLeaf(L: number, seed: number): THREE.BufferGeometry {
  const W = L * 1.05;
  const n = 40;
  const slits = [0.3, 0.45, 0.6, 0.75];
  const half = (s: number): number => (W / 2) * Math.pow(Math.sin(Math.PI * s), 0.75);
  const yAt = (s: number): number => -0.12 * L + s * 1.12 * L;
  const side: Array<[number, number]> = [];
  for (let i = 1; i < n; i++) {
    const s = i / n;
    side.push([half(s), yAt(s)]);
    for (const c of slits) {
      if (s < c && (i + 1) / n >= c) {
        // A V-shaped slit cutting in toward the midrib.
        const depth = 0.68 + 0.12 * Math.sin(seed + c * 10);
        side.push([half(c) * (1 - depth), yAt(c) + 0.015 * L]);
        side.push([half(c + 0.012), yAt(c + 0.012)]);
      }
    }
  }
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.04 * L);
  for (const [x, y] of side) shape.lineTo(x, y);
  shape.lineTo(0, L);
  for (let i = side.length - 1; i >= 0; i--) shape.lineTo(-side[i][0], side[i][1]);
  shape.closePath();
  // Small oval holes near the midrib.
  for (const sgn of [-1, 1]) {
    for (const s of [0.38, 0.53, 0.68]) {
      const hole = new THREE.Path();
      const hx = sgn * half(s) * 0.2;
      const hy = yAt(s) + 0.02 * L;
      hole.absellipse(hx, hy, 0.015 * L, 0.03 * L, 0, Math.PI * 2, false, 0);
      shape.holes.push(hole);
    }
  }
  const g = new THREE.ShapeGeometry(shape, 6);
  // Cup across the leaf and droop toward the tip.
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const u = px / (W / 2);
    const v = Math.max(0, py / L);
    pos.setZ(i, 0.07 * L * u * u - 0.14 * L * v * v);
  }
  g.computeVertexNormals();
  return g;
}

/** A snake-plant blade: a tapered strip standing up, leaning and slightly twisted. */
function bladeGeometry(width: number, height: number, lean: number): THREE.BufferGeometry {
  const rows = 8;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const w = width * (1 - Math.pow(t, 1.6)) * 0.5 + 0.002;
    const twist = t * 0.6;
    const y = t * height;
    const off = lean * t * t * height * 0.4;
    for (const sgn of [-1, 1]) pos.push(sgn * w * Math.cos(twist) + off, y, sgn * w * Math.sin(twist));
  }
  for (let j = 0; j < rows; j++) {
    const a = j * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mug(x: number, y: number, z: number): THREE.BufferGeometry {
  const body = lathe([[0, 0], [0.035, 0], [0.04, 0.09], [0.036, 0.09], [0.031, 0.01], [0, 0.01]], x, y, z);
  const handle = new THREE.TorusGeometry(0.022, 0.006, 6, 12, Math.PI);
  handle.rotateZ(-Math.PI / 2);
  handle.translate(x + 0.04, y + 0.045, z);
  return merge([body, handle]);
}

function cup(x: number, y: number, z: number): THREE.BufferGeometry {
  return lathe([[0, 0], [0.022, 0], [0.032, 0.05], [0.029, 0.05], [0.019, 0.006], [0, 0.006]], x, y, z);
}

function vase(x: number, y: number, z: number): THREE.BufferGeometry {
  return lathe([[0, 0], [0.04, 0], [0.055, 0.06], [0.03, 0.15], [0.026, 0.17], [0.03, 0.18], [0, 0.17]], x, y, z);
}

/** Lathe (revolved profile [radius, height]) at (x, y, z). */
function lathe(profile: Array<[number, number]>, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 20);
  g.translate(x, y, z);
  return g;
}

function rounded(w: number, h: number, d: number, r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
  g.translate(x, y, z);
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small helper for two-part objects: concatenate indexed geometries (position + normal).
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

export function cylinder(r: number, h: number, seg: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(x, y, z);
  return g;
}

function sphere(r: number, squash: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 16, 12);
  g.scale(1, squash, 1);
  g.translate(x, y, z);
  return g;
}

/** Dark slate tiles with light grout lines. */
function slateFloor(plain: GeoBuilder, x0: number, x1: number, z0: number, z1: number, F: number): void {
  plain.box(x1 - x0, 0.02, z1 - z0, (x0 + x1) / 2, F + 0.01, (z0 + z1) / 2, '#9a9a94');
  const tile = 0.4;
  for (let x = x0; x < x1 - 0.01; x += tile) {
    for (let z = z0; z < z1 - 0.01; z += tile) {
      const w = Math.min(tile, x1 - x) - 0.008;
      const d = Math.min(tile, z1 - z) - 0.008;
      plain.box(w, 0.022, d, x + w / 2 + 0.004, F + 0.011, z + d / 2 + 0.004, (Math.round((x + z) * 7) % 3) ? '#4a4c4d' : '#55585a');
    }
  }
}

/** A small fern: arching fronds of tiny leaflets in a ceramic pot. */
function fern(p: InteriorParts, x: number, y: number, z: number): void {
  p.soft.add(lathe([[0, 0], [0.07, 0], [0.085, 0.12], [0.09, 0.13], [0, 0.12]], x, y, z), CERAMIC);
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9;
    const frond = new THREE.BufferGeometry();
    const pos: number[] = [];
    const idx: number[] = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const r = t * 0.22;
      const h = 0.12 + 0.12 * Math.sin(t * Math.PI * 0.8) - 0.06 * t * t;
      const w = 0.04 * Math.sin(Math.PI * Math.min(1, t * 1.1));
      pos.push(r, h, -w, r, h, w);
    }
    for (let i = 0; i < n; i++) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    frond.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    frond.setIndex(idx);
    frond.computeVertexNormals();
    frond.rotateY(-a);
    frond.translate(x, y, z);
    p.leaf.add(frond, k % 2 ? '#4f8a3e' : '#3f7a34');
  }
}

/** Keychron K8 colors: space-gray frame, dark alphas, lighter modifiers, orange Esc. */
const K8 = { frame: '#3c3f44', alpha: '#2e3034', mod: '#5b5f66', accent: '#e8742c', pad: '#4b535d' } as const;
/** One key unit (19.05 mm). */
const U = 0.01905;

/**
 * The work spot on the desk top at height `y` (seated facing +Z, so the user's right is −X):
 * a felt desk pad, a tenkeyless (87-key) mechanical keyboard in the Keychron K8 style, every
 * key a rounded cap on its real layout, the case tilted up at the back, and an ergonomic mouse
 * on the right with a scroll wheel.
 */
function workstation(p: InteriorParts, y: number): void {
  const { soft, plain } = p;
  const kx = -0.8;
  const kz = 1.9;
  soft.add(rounded(0.74, 0.003, 0.32, 0.0015, -0.92, y + 0.0015, 1.93), K8.pad);

  // Keyboard, built around its own center then tilted (back up ~5°) and moved onto the pad.
  const parts: THREE.BufferGeometry[] = [];
  const colors: string[] = [];
  const put = (g: THREE.BufferGeometry, c: string): void => {
    parts.push(g);
    colors.push(c);
  };
  const width = 18.25 * U + 0.012;
  const depth = 6.25 * U + 0.012;
  put(rounded(width, 0.022, depth, 0.004, 0, 0.011, 0), K8.frame);
  // Rows from the back (function row, with its gap) to the front (space bar row).
  const rowZ = [2.75, 1.5, 0.5, -0.5, -1.5, -2.5].map((r) => r * U - 0.06 * U);
  // [start, width, color] in key units from the left edge.
  type Key = readonly [number, number, string];
  const a = K8.alpha;
  const m = K8.mod;
  const row = (start: number, n: number, c: string): Key[] => Array.from({ length: n }, (_, i) => [start + i, 1, c] as const);
  const nav = (n: number, c = m): Key[] => row(15.25, n, c);
  const rows: Key[][] = [
    [[0, 1, K8.accent], ...row(2, 4, m), ...row(6.5, 4, a), ...row(11, 4, m), ...nav(3)],
    [...row(0, 13, a), [13, 2, m], ...nav(3)],
    [[0, 1.5, m], ...row(1.5, 12, a), [13.5, 1.5, m], ...nav(3)],
    [[0, 1.75, m], ...row(1.75, 11, a), [12.75, 2.25, K8.accent]],
    [[0, 2.25, m], ...row(2.25, 10, a), [12.25, 2.75, m], [16.25, 1, m]],
    [[0, 1.25, m], [1.25, 1.25, m], [2.5, 1.25, m], [3.75, 6.25, a], [10, 1.25, m], [11.25, 1.25, m], [12.5, 1.25, m], [13.75, 1.25, m], ...nav(3)],
  ];
  rows.forEach((keys, r) => {
    for (const [start, w, c] of keys) {
      // Left edge of the board is the user's left (+X); keys run toward −X.
      const lx = 9.125 * U - (start + w / 2) * U;
      const cap = new RoundedBoxGeometry(w * U - 0.0028, 0.0095, U - 0.0028, 1, 0.0022);
      // Sculpted rows: the caps lean a little toward the typist the further back they are.
      cap.rotateX(-0.05 * (r - 3));
      cap.translate(lx, 0.022 + 0.0062, rowZ[r]);
      put(cap, c);
    }
  });
  // Merge, tilt and place (soft material: smooth rounded caps).
  const tilt = new THREE.Matrix4().makeRotationX(-0.085).setPosition(kx, y + 0.004, kz);
  parts.forEach((g, i) => {
    g.applyMatrix4(tilt);
    soft.add(g, colors[i]);
  });
  // RGB backlight: a lit plate just above the case top, under the keycaps; it shows in the
  // gaps between the keys like a real backlit board.
  const plate = new THREE.BoxGeometry(18.25 * U, 0.001, 6.25 * U);
  plate.translate(0, 0.0226, 0);
  plate.applyMatrix4(tilt);
  p.rgb.add(plate, '#ffffff');
  // Rubber feet lifting the back.
  for (const sx of [-1, 1]) plain.box(0.03, 0.01, 0.012, kx + sx * 0.15, y + 0.005, kz + depth / 2 - 0.01, '#1b1c1e');

  // Ergonomic mouse on the right (−X): flat base, a hump toward the back, split buttons in
  // front, a scroll wheel.
  const mx = -1.09;
  const mz = 1.93;
  const mouse = new THREE.SphereGeometry(1, 24, 16);
  const pos = mouse.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const yy = pos.getY(i);
    const z = pos.getZ(i);
    // z < 0 is the back (toward the user): taller and wider there, slimmer at the buttons.
    const back = 0.5 - 0.5 * z;
    pos.setXYZ(i, x * (0.029 + 0.006 * back), yy < 0 ? yy * 0.004 : yy * (0.022 + 0.012 * back * (1 - back) * 2.2), z * 0.058);
  }
  mouse.computeVertexNormals();
  mouse.translate(mx, y + 0.004, mz);
  soft.add(mouse, '#3a3d42');
  // Scroll wheel in the slot between the buttons, just proud of the shell.
  const wheel = new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 16);
  wheel.rotateZ(Math.PI / 2);
  wheel.translate(mx, y + 0.0175, mz + 0.03);
  soft.add(wheel, '#6b7078');
}

/**
 * Japanese paper lamp in the Akari style: an ovoid globe of washi paper on fine bamboo ribs
 * (the ribs show as faint rings, darker against the glow at night), a small black cap, three
 * thin black wire legs on the desk. The paper glows from dusk to dawn (glow material).
 */
function akariLamp(p: InteriorParts, x: number, y: number, z: number): void {
  const R = 0.12;
  const H = 0.27;
  const base = y + 0.07;
  // Full, egg-like profile (rounded shoulders, a little wider below the middle).
  const radius = (t: number): number => R * Math.pow(Math.sin(Math.PI * t), 0.55) * (1.02 - 0.08 * t);
  const profile: Array<[number, number]> = [];
  const n = 18;
  for (let i = 0; i <= n; i++) profile.push([Math.max(0.012, radius(i / n)), (i / n) * H]);
  p.glow.add(lathe(profile, x, base, z), '#ffffff');
  // Ribs: horizontal rings every ~2.5 cm, just outside the paper.
  for (let i = 1; i < 11; i++) {
    const t = i / 11;
    const ring = new THREE.TorusGeometry(radius(t) + 0.0008, 0.0009, 4, 40);
    ring.rotateX(Math.PI / 2);
    ring.translate(x, base + t * H, z);
    p.plain.add(ring, '#cbbd9f');
  }
  // Top cap and the wire frame: a ring under the globe on three splayed legs.
  p.plain.add(cylinder(0.014, 0.012, 12, x, base + H + 0.004, z), METAL);
  const foot = new THREE.TorusGeometry(0.03, 0.0025, 6, 24);
  foot.rotateX(Math.PI / 2);
  foot.translate(x, base + 0.008, z);
  p.plain.add(foot, METAL);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    const leg = new THREE.CylinderGeometry(0.0022, 0.0022, 0.085, 6);
    leg.rotateZ(0.42);
    leg.rotateY(-a);
    leg.translate(x + Math.cos(a) * 0.05, y + 0.036, z + Math.sin(a) * 0.05);
    p.plain.add(leg, METAL);
  }
}

/** Phalaenopsis colors: white petals with a soft blush, magenta lip, yellow throat. */
const ORCHID = {
  petal: '#f8f0f4',
  blush: '#f3dbe7',
  lip: '#b8236a',
  throat: '#f2c94c',
  bud: '#dfe8c8',
  stem: '#5f7a3a',
  leaf: '#2f5a2a',
  leafLight: '#3d6b33',
} as const;

/**
 * A long, broad, thick orchid leaf: a grid along its length (width rounded at both ends),
 * folded a little along the midrib and arching down. Built pointing +Z from the origin.
 */
function orchidLeaf(L: number, W: number, droop: number): THREE.BufferGeometry {
  const rows = 12;
  const cols = 6;
  const pos: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const half = (W / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.88)), 0.55);
    for (let i = 0; i <= cols; i++) {
      const v = i / cols - 0.5;
      const fold = Math.abs(v) * half * 0.5;
      pos.push(v * 2 * half, fold + t * L * 0.35 - droop * t * t * L, t * L);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** One flat, slightly cupped petal (`w` × `h`, base at the origin, pointing +Y). */
function petal(w: number, h: number, cup: number, round = 0.5): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Narrow at the base (claw), broad above.
    const yy = (h / 2) * (1 - Math.cos(a));
    const k = Math.pow(Math.sin(Math.PI * (yy / h)), round);
    const xx = (w / 2) * Math.sin(a) * k;
    if (i === 0) shape.moveTo(xx, yy);
    else shape.lineTo(xx, yy);
  }
  const g = new THREE.ShapeGeometry(shape, 6);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const xx = pos.getX(i);
    const yy = pos.getY(i);
    // Cup toward the viewer (+Z) at the sides and the tip.
    pos.setZ(i, cup * ((xx / w) * (xx / w) * 4 + (yy / h) * (yy / h)));
  }
  g.computeVertexNormals();
  return g;
}

/**
 * One Phalaenopsis flower (~8 cm), facing +Z, built at the origin: dorsal sepal up, two
 * lateral sepals down-left/right, two broad round petals to the sides, a magenta lip with
 * side lobes in the middle and a small column with a yellow throat.
 */
function orchidFlower(scale: number, tilt: number): Array<[THREE.BufferGeometry, string]> {
  const out: Array<[THREE.BufferGeometry, string]> = [];
  const add = (g: THREE.BufferGeometry, angle: number, z: number, color: string): void => {
    g.rotateZ(angle);
    g.translate(0, 0, z);
    g.scale(scale, scale, scale);
    out.push([g, color]);
  };
  add(petal(0.026, 0.04, 0.004), 0, 0, ORCHID.petal);
  for (const s of [-1, 1]) add(petal(0.024, 0.038, 0.004), s * 2.35, 0, ORCHID.petal);
  for (const s of [-1, 1]) add(petal(0.042, 0.04, 0.006, 0.4), s * 1.45 + 0.08 * tilt, 0.002, ORCHID.blush);
  // Lip: a small rounded tongue pointing down, two raised side lobes, then the column.
  add(petal(0.016, 0.026, 0.008, 0.7), Math.PI, 0.006, ORCHID.lip);
  for (const s of [-1, 1]) add(petal(0.01, 0.016, 0.006), Math.PI - s * 0.7, 0.009, ORCHID.lip);
  const col = new THREE.SphereGeometry(0.0055, 8, 6);
  col.scale(1, 1.3, 0.9);
  col.translate(0, 0.004, 0.01);
  col.scale(scale, scale, scale);
  out.push([col, ORCHID.throat]);
  return out;
}

/**
 * A Phalaenopsis (moth orchid) in a glossy white pot: bark mix on top, four broad arching
 * leaves, and a flower spike tied to a bamboo stake that arches over toward the chair with
 * seven open flowers and three buds at its tip.
 */
function orchid(p: InteriorParts, x: number, y: number, z: number): void {
  // Pot: tapered, with a rolled rim; bark chips on top.
  p.soft.add(lathe([[0, 0], [0.052, 0], [0.062, 0.1], [0.066, 0.104], [0.064, 0.11], [0.058, 0.106], [0.057, 0.09]], x, y, z), CERAMIC);
  p.plain.add(cylinder(0.058, 0.006, 20, x, y + 0.094, z), '#5a3f27');
  for (let k = 0; k < 12; k++) {
    const a = k * 2.399;
    const r = 0.012 + 0.04 * Math.sqrt((k + 0.5) / 12);
    const chip = new THREE.SphereGeometry(0.009, 6, 4);
    chip.scale(1.2, 0.5, 0.8);
    chip.rotateY(a);
    chip.translate(x + Math.cos(a) * r, y + 0.1, z + Math.sin(a) * r);
    p.plain.add(chip, k % 2 ? '#7a5634' : '#5e4129');
  }
  // Leaves: two pairs, alternating, arching out and down over the rim.
  const leaves: Array<[number, number, number, number]> = [
    [0.2, 0.072, 0.0, 0.62],
    [0.19, 0.068, Math.PI + 0.25, 0.6],
    [0.15, 0.06, 1.5, 0.5],
    [0.13, 0.055, -1.4, 0.45],
  ];
  leaves.forEach(([L, W, yaw, droop], i) => {
    const g = orchidLeaf(L, W, droop);
    g.rotateX(-0.25);
    g.rotateY(yaw);
    g.translate(x, y + 0.105 + i * 0.006, z);
    p.leaf.add(g, i % 2 ? ORCHID.leafLight : ORCHID.leaf);
  });

  // Bamboo stake and the spike: up along the stake, then arching toward the chair (−Z) and a
  // little to the left of the plant (+X), where the flowers hang.
  const stakeTop = y + 0.4;
  p.plain.add(cylinder(0.0025, stakeTop - y - 0.05, 6, x + 0.012, (stakeTop + y + 0.05) / 2, z + 0.01), '#c9b27a');
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(x + 0.008, y + 0.1, z + 0.006),
    new THREE.Vector3(x + 0.01, y + 0.25, z + 0.008),
    new THREE.Vector3(x + 0.012, y + 0.38, z + 0.004),
    new THREE.Vector3(x + 0.04, y + 0.45, z - 0.05),
    new THREE.Vector3(x + 0.08, y + 0.44, z - 0.13),
    new THREE.Vector3(x + 0.11, y + 0.39, z - 0.2),
  ]);
  p.soft.add(new THREE.TubeGeometry(curve, 40, 0.0028, 6, false), ORCHID.stem);
  // A clip holding the spike to the stake.
  const clip = new THREE.TorusGeometry(0.006, 0.0018, 4, 10);
  clip.rotateX(Math.PI / 2);
  clip.translate(x + 0.011, y + 0.3, z + 0.008);
  p.plain.add(clip, '#e8e2d4');

  // Flowers along the arch, each on a short pedicel, alternating sides, facing the chair and a
  // little up; buds at the tip get smaller.
  const pt = new THREE.Vector3();
  const at = new THREE.Vector3();
  const face = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  for (let k = 0; k < 7; k++) {
    const t = 0.5 + k * 0.065;
    curve.getPointAt(t, pt);
    const side = k % 2 ? 1 : -1;
    at.set(pt.x + side * 0.018, pt.y - 0.022, pt.z);
    // Matrix4.lookAt aims the local +Z axis away from the target: aim at −face to face it.
    face.set(0.25 + side * 0.25, 0.15, -1).normalize();
    m.lookAt(origin, face.clone().negate(), up);
    m.setPosition(at);
    for (const [g, c] of orchidFlower(1 - k * 0.04, side)) {
      g.applyMatrix4(m);
      p.leaf.add(g, c);
    }
    const ped = new THREE.CylinderGeometry(0.0012, 0.0012, 0.026, 4);
    ped.translate(0, -0.013, 0);
    ped.rotateZ(side * 0.6);
    ped.translate(pt.x, pt.y, pt.z);
    p.soft.add(ped, ORCHID.stem);
  }
  for (let k = 0; k < 3; k++) {
    curve.getPointAt(0.95 + k * 0.02, pt);
    const bud = new THREE.SphereGeometry(0.009 - k * 0.0022, 8, 6);
    bud.scale(1, 0.8, 1.2);
    bud.translate(pt.x, pt.y - 0.01, pt.z);
    p.soft.add(bud, ORCHID.bud);
  }
}
