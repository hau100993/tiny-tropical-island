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
}

export type SolidFn = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => void;

const OAK = '#c89b6a';
const OAK_LIGHT = '#d8b688';
const OAK_DARK = '#8a6240';
const METAL = '#1e2124';
const TATAMI = '#cbbf8a';
const TATAMI_EDGE = '#4a4636';
const PAPER = '#efe9dc';
const HINOKI = '#dcbf8f';
const CERAMIC = '#ebe7df';
const STEM = '#4f7a3a';
const MONSTERA = ['#2b5a2c', '#336a33', '#2f6230', '#3b7538'];

/** Monitors and chair position (shared with house.ts, which places the screens). */
export const DESK = { seatX: -0.8, seatZ: 1.1 } as const;

/**
 * Japanese-minimal interior: desk and chair at the glass, a tea corner with a low chabudai and
 * zabuton cushions by the left window, futon on tatami (back left), a low bookshelf and a
 * monstera against the back wall, hinoki bath behind shoji (back right), a snake plant by the
 * door, timber beams under the ceiling.
 */
export function furnish(p: InteriorParts, F: number, ceilingY: (z: number) => number, solid: SolidFn): void {
  const { wood, plain, soft, glow } = p;

  // ---- Desk along the glass ----
  wood.box(1.9, 0.04, 0.66, -0.8, F + 0.72, 2.05, OAK);
  for (const lx of [-1.71, 0.11]) plain.box(0.04, 0.7, 0.6, lx, F + 0.35, 2.05, '#2a2a2a');
  solid(-1.75, 0.15, 1.72, 2.38, F, F + 0.76);
  // Keyboard and mouse (rounded), mug with handle, desk lamp, a small potted plant.
  soft.add(rounded(0.44, 0.022, 0.14, 0.008, -0.8, F + 0.752, 1.9), '#2b2d31');
  soft.add(rounded(0.41, 0.006, 0.115, 0.002, -0.8, F + 0.765, 1.9), '#55585e');
  const mouse = new THREE.SphereGeometry(1, 14, 10);
  mouse.scale(0.032, 0.016, 0.055);
  mouse.translate(-0.42, F + 0.752, 1.9);
  soft.add(mouse, '#2b2d31');
  soft.add(mug(0.0, F + 0.74, 2.18), CERAMIC);
  plain.add(cylinder(0.06, 0.015, 16, -1.6, F + 0.748, 2.28), METAL);
  plain.box(0.015, 0.42, 0.015, -1.6, F + 0.95, 2.28, METAL, 0.25);
  glow.add(cone(0.06, 0.08, -1.6, F + 1.12, 2.2), '#ffffff');
  pottedPlant(p, -1.58, F + 0.74, 1.9, 0.35);

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

  // ---- Bath corner (back right): stone floor, hinoki tub, stool, bucket, towel, shoji ----
  plain.box(1.9, 0.02, 1.33, 2.5, F + 0.01, -1.83, '#8d8f8c');
  const tx0 = 2.05;
  const tx1 = 3.3;
  const tz0 = -2.35;
  const tz1 = -1.45;
  const th = 0.62;
  wood.box(tx1 - tx0, th, 0.07, (tx0 + tx1) / 2, F + th / 2, tz0, HINOKI);
  wood.box(tx1 - tx0, th, 0.07, (tx0 + tx1) / 2, F + th / 2, tz1, HINOKI);
  wood.box(0.07, th, tz1 - tz0, tx0, F + th / 2, (tz0 + tz1) / 2, HINOKI);
  wood.box(0.07, th, tz1 - tz0, tx1, F + th / 2, (tz0 + tz1) / 2, HINOKI);
  plain.box(tx1 - tx0 - 0.07, 0.02, tz1 - tz0 - 0.07, (tx0 + tx1) / 2, F + th - 0.1, (tz0 + tz1) / 2, '#86c9c8');
  wood.box(0.32, 0.2, 0.22, 1.85, F + 0.1, -1.95, HINOKI);
  soft.add(rounded(0.26, 0.05, 0.17, 0.02, 1.85, F + 0.225, -1.95), '#f2efe8');
  const bucket = new THREE.CylinderGeometry(0.11, 0.09, 0.14, 16, 1, true);
  bucket.translate(1.85, F + 0.07, -1.6);
  wood.add(bucket, HINOKI);
  solid(tx0 - 0.04, tx1 + 0.04, tz0 - 0.04, tz1 + 0.04, F, F + th);
  shoji(wood, plain, 'x', -1.12, 1.55, 2.85, F, solid);
  shoji(wood, plain, 'z', 1.55, -2.45, -1.12, F, solid);

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

/** A shoji screen (wood grid over paper), 1.9 m tall, from u0 to u1 along the wall axis. */
function shoji(wood: GeoBuilder, plain: GeoBuilder, axis: 'x' | 'z', at: number, u0: number, u1: number, F: number, solid: SolidFn): void {
  const len = u1 - u0;
  const uc = (u0 + u1) / 2;
  const H = 1.9;
  const put = (w: number, h: number, u: number, y: number, c: string, thick: number, to = wood): void => {
    if (axis === 'x') to.box(w, h, thick, u, y, at, c);
    else to.box(thick, h, w, at, y, u, c);
  };
  // Paper has no wood grain.
  put(len, H, uc, F + H / 2, PAPER, 0.02, plain);
  for (let k = 0; k <= 4; k++) put(len, 0.025, uc, F + 0.05 + (k * (H - 0.1)) / 4, '#7a5a3a', 0.04);
  const cols = Math.max(2, Math.round(len / 0.32));
  for (let k = 0; k <= cols; k++) put(0.025, H, u0 + (k * len) / cols, F + H / 2, '#7a5a3a', 0.04);
  if (axis === 'x') solid(u0, u1, at - 0.04, at + 0.04, F, F + H);
  else solid(at - 0.04, at + 0.04, u0, u1, F, F + H);
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
function pottedPlant(p: InteriorParts, x: number, y: number, z: number, s: number): void {
  p.soft.add(lathe([[0, 0], [0.11, 0], [0.13, 0.2], [0.135, 0.21], [0, 0.2]].map(([r, h]) => [r * s, h * s]) as Array<[number, number]>, x, y, z), CERAMIC);
  for (let k = 0; k < 8; k++) {
    const a = k * 2.4;
    const leaf = new THREE.SphereGeometry(1, 10, 6);
    leaf.scale(0.035 * s * 3, 0.006, 0.02 * s * 3);
    leaf.rotateZ(0.5);
    leaf.rotateY(-a);
    leaf.translate(x + Math.cos(a) * 0.04, y + 0.075 + (k % 3) * 0.015, z + Math.sin(a) * 0.04);
    p.leaf.add(leaf, MONSTERA[k % MONSTERA.length]);
  }
}

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

function cone(r: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r * 0.35, r, h, 12, 1, true);
  g.translate(x, y, z);
  return g;
}

function sphere(r: number, squash: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 16, 12);
  g.scale(1, squash, 1);
  g.translate(x, y, z);
  return g;
}
