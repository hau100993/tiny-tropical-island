import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geoBuilder';
import { patchWorldMaterial } from './patchMaterial';
import { createRng, type Rng } from '../core/rng';
import { clamp, damp, smoothstep } from '../core/math';
import type { SharedUniforms } from '../core/uniforms';

/**
 * The walker's body for the third-person view: a young man dressed for the beach (Korean
 * "two-block" hair with a soft fringe, slim-fit pale linen shirt with an open collar, board
 * shorts, flip-flops, a bead bracelet), about 1.7 m tall, fair skin and a friendly face.
 * Original design built in code.
 *
 * Shapes, all procedural:
 * - Head: a sphere sculpted vertex by vertex (narrower jaw, fuller skull, brow ridge, eye
 *   sockets, nose, cheekbones, chin), with eyes set into the sockets and ears.
 * - Hair: a shell that grows out of the scalp along a hairline (no hard helmet rim), plus
 *   ~50 tapered locks lying on it, so it reads as strands rather than a cap.
 * - Body and limbs: "tubes" through cross-sections (superellipses with separate front/back
 *   depth), so chest, calves and forearms have muscle shape instead of being cylinders.
 * - Hands with fingers and a thumb, feet with toes on the flip-flops.
 *
 * It is a tiny "skeleton" of groups (hips → torso → head/arms → hands, hips → legs → feet)
 * animated in JS: ~20 joint rotations per frame, nothing per vertex. Each body part is a few
 * merged meshes, one per material (skin, cloth, hair/eyes), about 35 draw calls in total.
 *
 * The model faces −Z, the same convention as the camera, so `rotation.y = yaw` turns it to
 * face along the camera's forward direction for that yaw.
 */

const C = {
  skin: '#f1cdb2',
  lip: '#c27a6e',
  blush: '#efbfae',
  hair: '#1b1512',
  sclera: '#f4f1ec',
  iris: '#4a3222',
  pupil: '#0f0b09',
  shirt: '#d6eaee',
  shirtDark: '#b9d2d9',
  button: '#f7f6f2',
  shorts: '#2f5d8a',
  shortsDark: '#244a70',
  stripe: '#eeece4',
  bead: '#6b4a32',
  beadLight: '#a8835e',
  sole: '#2b2f36',
  strap: '#3f6f8f',
} as const;

/** Legs are scaled along their length; with it the soles (0.03 + (0.41 + 0.455) × scale below
 * the hips) reach just to the ground. */
const LEG_SCALE = 0.94;
const HIP_Y = 0.03 + (0.41 + 0.455) * LEG_SCALE;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Moves/rotates/scales a fresh geometry (normals follow, so smooth shading stays correct). */
function place(
  g: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  tmpE.set(rx, ry, rz);
  tmpQ.setFromEuler(tmpE);
  tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
  return g.applyMatrix4(tmpM);
}

const ball = (r: number, w = 12, h = 8): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);

/** A capsule of radius `r` from point a to point b (fingers, straps). */
function capsule(r: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, seg = 8): THREE.BufferGeometry {
  const d = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = d.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, seg);
  tmpQ.setFromUnitVectors(UP, d.normalize());
  tmpM.compose(tmpP.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), tmpQ, tmpS.set(1, 1, 1));
  return g.applyMatrix4(tmpM);
}

/** A cross-section of a tube: height, half-width, depth to the front (−Z) and to the back. */
type Ring = readonly [y: number, rx: number, front: number, back: number];

/**
 * A smooth closed tube along Y through `rings`. The cross-section is a superellipse
 * (exponent `n`: 2 = ellipse, larger = squarer, like a chest), with separate front and back
 * depths. Both ends are capped. Vertices are shared around the ring, so there is no seam.
 */
function tube(rings: readonly Ring[], seg = 20, n = 2): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  const e = 2 / n;
  for (const [y, rx, front, back] of rings) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const cx = Math.sign(c) * Math.abs(c) ** e;
      const sz = Math.sign(s) * Math.abs(s) ** e;
      // Angle grows from +X toward +Z (the back).
      pos.push(rx * cx, y, sz * (s > 0 ? back : front));
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i;
      const b = j * seg + ((i + 1) % seg);
      // (a, up, next) faces outward: Y × Z = +X at angle 0.
      index.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  const bottom = pos.length / 3;
  pos.push(0, rings[0][0], 0);
  const top = bottom + 1;
  pos.push(0, rings[rings.length - 1][0], 0);
  const last = (rings.length - 1) * seg;
  for (let i = 0; i < seg; i++) {
    index.push(bottom, i, (i + 1) % seg);
    index.push(top, last + ((i + 1) % seg), last + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A unit sphere reshaped by `fn` (which moves each vertex), with smooth normals recomputed. */
function sculpt(widthSeg: number, heightSeg: number, fn: (v: THREE.Vector3) => void): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, widthSeg, heightSeg);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  // Weld the seam and poles so recomputed normals have no crease.
  g = mergeVertices(g);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------
// Head

/** Head half-size (m): width, height (crown to chin / 2), depth. */
const HEAD = { w: 0.079, h: 0.113, d: 0.097 } as const;

const gauss = (x: number, y: number, cx: number, cy: number, sx: number, sy: number): number =>
  Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));

/**
 * The head surface in the direction (x, y, z) from its center (front = −Z). Features are
 * bumps on the unit sphere, weighted toward the front so they never show on the back.
 */
function headPoint(dx: number, dy: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
  const l = Math.hypot(dx, dy, dz) || 1;
  let x = dx / l;
  let y = dy / l;
  let z = dz / l;
  const f = Math.max(0, -z) ** 2;
  let r = 1;
  r += f * 0.13 * gauss(x, y, 0, -0.12, 0.07, 0.17); // nose bridge
  r += f * 0.07 * gauss(x, y, 0, -0.27, 0.1, 0.07); // nose tip
  r += f * 0.03 * (gauss(x, y, 0.32, 0.2, 0.2, 0.07) + gauss(x, y, -0.32, 0.2, 0.2, 0.07)); // brow ridge
  r -= f * 0.05 * (gauss(x, y, 0.38, 0.05, 0.13, 0.09) + gauss(x, y, -0.38, 0.05, 0.13, 0.09)); // eye sockets
  r += f * 0.03 * (gauss(x, y, 0.5, -0.17, 0.14, 0.12) + gauss(x, y, -0.5, -0.17, 0.14, 0.12)); // cheekbones
  r += f * 0.035 * gauss(x, y, 0, -0.5, 0.26, 0.15); // mouth
  r += f * 0.05 * gauss(x, y, 0, -0.8, 0.2, 0.12); // chin
  x *= r;
  y *= r;
  z *= r;
  // Jaw narrower than the skull; fuller back of the head, flatter face.
  const low = smoothstep(0.15, -0.95, y);
  x *= 1 - 0.18 * low;
  z *= z > 0 ? 1.1 - 0.2 * low : 0.96 - 0.06 * low;
  return out.set(x * HEAD.w, y * HEAD.h, z * HEAD.d);
}

/** Hairline height (unit-sphere y) by angle around the head: forehead, temples, over the
 * ears, down to the nape. */
const HAIRLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.42], [0.7, 0.38], [1.2, 0.3], [1.5, 0.24], [1.8, 0.24], [2.3, -0.1], [2.8, -0.32], [Math.PI, -0.36],
];

function hairline(x: number, z: number): number {
  const phi = Math.atan2(Math.abs(x), -z);
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [p1, y1] = HAIRLINE[i];
    const [p0, y0] = HAIRLINE[i - 1];
    if (phi <= p1) return y0 + ((y1 - y0) * (phi - p0)) / (p1 - p0);
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

/**
 * Hair shell radius factor in a unit direction: below the hairline it sinks under the skin
 * (so the edge fades out instead of a rim); short at the sides and back, fuller on top and
 * lifted toward the front (the "two-block" cut).
 */
function hairScale(x: number, y: number, z: number): number {
  const t = smoothstep(hairline(x, z) - 0.16, hairline(x, z) + 0.04, y);
  const top = smoothstep(0.15, 0.85, y);
  return 0.955 + t * (0.075 + 0.05 * top + 0.03 * Math.max(0, -z) * top);
}

/**
 * One lock of hair: a flat, tapered strand from `d0` to `d1` (unit-sphere directions, bent
 * through `c`), lying on the hair shell. Zero width at both ends, so it grows out of the
 * shell without a visible root.
 */
function lock(
  d0: THREE.Vector3,
  c: THREE.Vector3,
  d1: THREE.Vector3,
  width: number,
  thick: number,
): THREE.BufferGeometry {
  const rows = 10;
  const seg = 6;
  const centers: THREE.Vector3[] = [];
  const dir = new THREE.Vector3();
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const d = t * t;
    dir.set(a * d0.x + b * c.x + d * d1.x, a * d0.y + b * c.y + d * d1.y, a * d0.z + b * c.z + d * d1.z).normalize();
    const s = Math.max(hairScale(dir.x, dir.y, dir.z), 1.04);
    centers.push(headPoint(dir.x, dir.y, dir.z, new THREE.Vector3()).multiplyScalar(s));
  }
  const pos: number[] = [];
  const index: number[] = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const p = centers[j];
    tangent.subVectors(centers[Math.min(rows, j + 1)], centers[Math.max(0, j - 1)]).normalize();
    normal.copy(p).normalize();
    side.crossVectors(tangent, normal).normalize();
    normal.crossVectors(side, tangent).normalize();
    const k = Math.sin(Math.PI * t ** 0.6);
    const w = width * k;
    const h = thick * k;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cs = Math.cos(a) * w;
      const sn = Math.sin(a) * h;
      // Centerline raised by part of the thickness: the strand sits on the shell.
      pos.push(
        p.x + side.x * cs + normal.x * (sn + h * 0.4),
        p.y + side.y * cs + normal.y * (sn + h * 0.4),
        p.z + side.z * cs + normal.z * (sn + h * 0.4),
      );
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * seg + i;
      const b = j * seg + ((i + 1) % seg);
      index.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // The winding depends on the side vector's handedness; make sure normals face outward.
  const n0 = g.getAttribute('normal');
  const mid = Math.floor(rows / 2) * seg + Math.floor(seg / 4);
  tmpP.fromBufferAttribute(n0, mid);
  normal.copy(centers[Math.floor(rows / 2)]).normalize();
  if (tmpP.dot(normal) < 0) {
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = tmp;
    }
    g.setIndex(index);
    g.computeVertexNormals();
  }
  return g;
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** All the locks: fringe swept a little to one side, top flowing forward, back and sides down. */
function hairLocks(hair: GeoBuilder, rng: Rng): void {
  const jit = (a: number): number => (rng() - 0.5) * 2 * a;
  // Fringe: from the front of the crown down over the forehead, tips just above the brows.
  for (let i = 0; i <= 11; i++) {
    const u = i / 11 - 0.5;
    const d0 = v3(u * 0.8, 0.86, -0.45);
    const c = v3(u * 0.9 + 0.08, 0.7, -1);
    const d1 = v3(u * 1.05 + 0.16 + jit(0.03), 0.27 + jit(0.05) + Math.abs(u) * 0.2, -1);
    hair.add(lock(d0, c, d1, 0.012 + rng() * 0.004, 0.006), C.hair);
  }
  // Top: from the crown, fanning forward and out to the sides.
  for (let i = 0; i < 18; i++) {
    const a = -1.9 + (3.8 * i) / 17 + jit(0.08);
    const d0 = v3(jit(0.12), 1, 0.3 + jit(0.1));
    const d1 = v3(Math.sin(a) * 0.9, 0.62 + jit(0.06), -Math.cos(a) * 0.9);
    const c = v3((d0.x + d1.x) / 2, 1.05, (d0.z + d1.z) / 2);
    hair.add(lock(d0, c, d1, 0.013 + rng() * 0.004, 0.007), C.hair);
  }
  // Back: from the crown down toward the nape.
  for (let i = 0; i < 10; i++) {
    const a = -1.2 + (2.4 * i) / 9 + jit(0.06);
    const d0 = v3(Math.sin(a) * 0.5, 0.85, Math.cos(a) * 0.5);
    const d1 = v3(Math.sin(a) * 0.95, 0.12 + jit(0.08), Math.cos(a) * 0.95);
    const c = v3((d0.x + d1.x) / 2, 0.6, (d0.z + d1.z) / 2 + 0.15);
    hair.add(lock(d0, c, d1, 0.014 + rng() * 0.004, 0.005), C.hair);
  }
  // Sides: short, combed back and down over the undercut.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = -0.35 + i * 0.2;
      const d0 = v3(s * 0.6, 0.78, z);
      const d1 = v3(s, 0.4 + jit(0.04), z + 0.2);
      const c = v3(s * 0.9, 0.68, z + 0.08);
      hair.add(lock(d0, c, d1, 0.012 + rng() * 0.003, 0.005), C.hair);
    }
  }
}

/** Where the eyes sit (head space): unit-sphere direction x, y. */
const EYE_X = 0.38;
const EYE_Y = 0.05;
const EYE = { rx: 0.0135, ry: 0.0095, rz: 0.006 } as const;

interface HeadParts {
  skin: GeoBuilder;
  gloss: GeoBuilder;
  /** Eye centers (head space), for the blinking lids. */
  eyes: THREE.Vector3[];
}

function buildHead(p: HeadParts, rng: Rng): void {
  const q = new THREE.Vector3();
  p.skin.add(sculpt(48, 36, (v) => headPoint(v.x, v.y, v.z, v)), C.skin);
  for (const s of [-1, 1]) {
    // Eye in its socket: white, iris, pupil, a catch light, a lash line along the top.
    headPoint(s * EYE_X, EYE_Y, -1, q);
    const ex = q.x;
    const ey = q.y;
    const ez = q.z + 0.0035;
    p.eyes.push(new THREE.Vector3(ex, ey, ez));
    p.gloss.add(place(ball(1, 16, 12), ex, ey, ez, 0, 0, 0, EYE.rx, EYE.ry, EYE.rz), C.sclera);
    const front = ez - EYE.rz;
    p.gloss.add(place(ball(1, 14, 8), ex - s * 0.0008, ey - 0.0004, front + 0.0006, 0, 0, 0, 0.0074, 0.0078, 0.0016), C.iris);
    p.gloss.add(place(ball(1, 10, 6), ex - s * 0.0008, ey - 0.0004, front + 0.0001, 0, 0, 0, 0.0036, 0.0038, 0.0012), C.pupil);
    p.gloss.add(place(ball(0.0017, 6, 4), ex - s * 0.0008 + 0.0025, ey + 0.0026, front - 0.0006), C.sclera);
    p.gloss.add(
      place(new THREE.TorusGeometry(EYE.rx * 0.98, 0.0011, 4, 16, Math.PI), ex, ey + 0.0008, front + 0.0022, 0, 0, 0, 1, 0.95, 1),
      C.hair,
    );
    // Brows: slightly arched, following the brow ridge back toward the temples.
    headPoint(s * 0.38, 0.27, -1, q);
    p.gloss.add(place(new THREE.CapsuleGeometry(0.0027, 0.022, 3, 8), q.x, q.y, q.z - 0.0015, 0, s * 0.35, Math.PI / 2 - s * 0.12), C.hair);
    // Soft blush on the cheeks.
    headPoint(s * 0.5, -0.25, -1, q);
    p.skin.add(place(ball(1, 10, 8), q.x, q.y, q.z + 0.003, 0, s * 0.5, 0, 0.012, 0.007, 0.002), C.blush);
    // Ear: a flat shell with a rolled rim, angled back.
    headPoint(s, -0.04, 0.12, q);
    const ax = q.x + s * 0.002;
    p.skin.add(place(ball(1, 12, 10), ax, q.y, q.z, 0, s * 0.3, 0, 0.007, 0.029, 0.018), C.skin);
    p.skin.add(place(new THREE.TorusGeometry(0.016, 0.0038, 6, 18, Math.PI * 1.45), ax + s * 0.002, q.y + 0.001, q.z, 0, Math.PI / 2 + s * 0.3, 0.2, 1, 1.55, 1), C.skin);
  }
  // A small, warm smile and a hint of the lower lip.
  headPoint(0, -0.5, -1, q);
  p.skin.add(place(new THREE.TorusGeometry(0.014, 0.0019, 5, 16, Math.PI), q.x, q.y + 0.003, q.z - 0.0008, 0, 0, Math.PI, 1, 0.45, 1), C.lip);
  p.skin.add(place(ball(1, 12, 8), q.x, q.y - 0.006, q.z + 0.0012, 0, 0, 0, 0.009, 0.0032, 0.0035), C.lip);
  // Nostrils.
  for (const s of [-1, 1]) {
    headPoint(s * 0.08, -0.31, -1, q);
    p.skin.add(place(ball(1, 8, 6), q.x, q.y, q.z + 0.004, 0.4, 0, 0, 0.0035, 0.002, 0.003), '#b48a76');
  }
  // Hair: shell grown from the scalp, then the locks on top.
  p.gloss.add(
    sculpt(72, 56, (v) => {
      const k = hairScale(v.x, v.y, v.z);
      headPoint(v.x, v.y, v.z, v).multiplyScalar(k);
    }),
    C.hair,
  );
  hairLocks(p.gloss, rng);
}

// ---------------------------------------------------------------------------------------
// Body

/** Shirt cross-sections (torso space: 0 = 6 cm above the hips; 0.455 = base of the neck). */
const TORSO: readonly Ring[] = [
  [-0.07, 0.146, 0.106, 0.11],
  [-0.04, 0.142, 0.102, 0.105],
  [0.0, 0.135, 0.096, 0.096],
  [0.05, 0.13, 0.092, 0.09],
  [0.15, 0.136, 0.098, 0.09],
  [0.24, 0.15, 0.107, 0.095],
  [0.31, 0.161, 0.11, 0.1],
  [0.36, 0.176, 0.104, 0.1],
  [0.4, 0.178, 0.09, 0.094],
  [0.425, 0.152, 0.074, 0.08],
  [0.448, 0.095, 0.049, 0.062],
  [0.46, 0.05, 0.039, 0.05],
];
const TORSO_N = 2.4;

/** Front surface of the shirt (z) at height y and sideways offset x. */
function torsoFront(y: number, x: number): number {
  let i = 1;
  while (i < TORSO.length - 1 && TORSO[i][0] < y) i++;
  const [y0, rx0, f0] = TORSO[i - 1];
  const [y1, rx1, f1] = TORSO[i];
  const t = clamp((y - y0) / (y1 - y0), 0, 1);
  const rx = rx0 + (rx1 - rx0) * t;
  const f = f0 + (f1 - f0) * t;
  const u = Math.min(1, Math.abs(x) / rx);
  return -f * (1 - u ** TORSO_N) ** (1 / TORSO_N);
}

/** A V-shaped patch lying on the chest (apex at y0, `halfW` wide at y1), `lift` in front. */
function chestPatch(y0: number, y1: number, halfW: number, lift: number): THREE.BufferGeometry {
  const rows = 6;
  const cols = 6;
  const pos: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = y0 + (y1 - y0) * v;
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols - 0.5) * 2 * halfW * v;
      pos.push(x, y, torsoFront(y, x) - lift);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      // Counter-clockwise seen from the front (−Z): x grows to the viewer's left.
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Relaxed hand hanging from the wrist, palm toward the body (side `s`: −1 left, +1 right). */
function buildHand(skin: GeoBuilder, s: number): void {
  // Palm: a flattened, slightly squared ellipsoid (thicker at the heel of the hand).
  skin.add(
    place(
      sculpt(16, 12, (v) => {
        const sq = (a: number): number => Math.sign(a) * Math.abs(a) ** 0.7;
        v.set(sq(v.x) * 0.0125 * (1.15 - 0.3 * v.y), v.y * 0.044, sq(v.z) * 0.037);
      }),
      0,
      -0.044,
      0,
    ),
    C.skin,
  );
  // Fingers (index at the front, −Z), each in two segments, curling toward the palm (−s·X).
  const lengths = [0.044, 0.05, 0.047, 0.037];
  for (let k = 0; k < 4; k++) {
    const z = -0.027 + k * 0.018;
    const r = 0.0082 - k * 0.0006;
    const L = lengths[k];
    const a1 = 0.25;
    const a2 = 0.85;
    const x1 = -s * Math.sin(a1) * L * 0.5;
    const y1 = -0.082 - Math.cos(a1) * L * 0.5;
    const x2 = x1 - s * Math.sin(a2) * L * 0.55;
    const y2 = y1 - Math.cos(a2) * L * 0.55;
    skin.add(capsule(r, 0, -0.08, z, x1, y1, z), C.skin);
    skin.add(capsule(r * 0.92, x1, y1, z, x2, y2, z * 0.95), C.skin);
  }
  // Thumb: from the base of the palm at the front, forward and in.
  skin.add(capsule(0.0095, -s * 0.006, -0.03, -0.034, -s * 0.016, -0.062, -0.05), C.skin);
  skin.add(capsule(0.0088, -s * 0.016, -0.062, -0.05, -s * 0.022, -0.084, -0.046), C.skin);
}

/** Bare foot on a flip-flop, pointing forward (−Z), hanging from the ankle; sole at −0.08. */
function buildFoot(skin: GeoBuilder, cloth: GeoBuilder, s: number): void {
  skin.add(
    place(
      sculpt(20, 14, (v) => {
        const front = smoothstep(0.3, -1, v.z);
        v.x *= 0.033 + 0.013 * front;
        v.y *= v.y < 0 ? 0.022 : 0.04 * (1 - 0.6 * front);
        v.z *= 0.11;
      }),
      -s * 0.004,
      -0.045,
      -0.052,
    ),
    C.skin,
  );
  // Toes, big toe on the inside (−s).
  for (let k = 0; k < 5; k++) {
    const r = 0.0095 - k * 0.0011;
    skin.add(place(ball(r, 8, 6), -s * 0.02 + s * k * 0.0105, -0.058, -0.155 + k * 0.008, 0, 0, 0, 1, 0.75, 1.3), C.skin);
  }
  // Sole, wider at the toes, and the Y strap from between the first toes to both sides.
  cloth.add(
    place(
      sculpt(24, 6, (v) => {
        const front = smoothstep(0.4, -1, v.z);
        v.x *= 0.04 + 0.012 * front;
        v.y *= 0.008;
        v.z *= 0.128;
      }),
      -s * 0.004,
      -0.072,
      -0.06,
    ),
    C.sole,
  );
  const tx = -s * 0.012;
  cloth.add(capsule(0.0045, tx, -0.068, -0.14, tx, -0.05, -0.12), C.strap);
  for (const k of [-1, 1]) cloth.add(capsule(0.0045, tx, -0.05, -0.12, k * 0.037 - s * 0.004, -0.064, -0.055), C.strap);
}

/** State the avatar animates from (the walker). */
export interface AvatarPose {
  x: number;
  z: number;
  feetY: number;
  /** Horizontal velocity (m/s), to face the walking direction. */
  vx: number;
  vz: number;
  speed: number;
  /** Footfall counter: +1 per step (the gait phase). */
  phase: number;
  running: boolean;
}

interface Part {
  skin: GeoBuilder;
  cloth: GeoBuilder;
  gloss: GeoBuilder;
}

export class Avatar {
  readonly group = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly lids: THREE.Object3D[] = [];
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly hipJoints: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly ankles: THREE.Group[] = [];
  private yaw = 0;
  private gait = 0;
  private run = 0;
  private time = 0;
  /** Seconds until the next blink; negative while the eyes are closing/opening. */
  private blink = 2;

  constructor(shared: SharedUniforms) {
    // Three materials: matte cloth, soft skin, glossier hair and eyes. All get wet in the rain
    // and cloud shadows like the rest of the world.
    const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58 });
    const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38 });
    patchWorldMaterial(skinMat, { wet: true, porosity: 0.3 }, shared);
    patchWorldMaterial(clothMat, { wet: true, porosity: 0.7 }, shared);
    patchWorldMaterial(glossMat, { wet: true, porosity: 0.4 }, shared);
    const rng = createRng(77);
    const part = (): Part => ({ skin: new GeoBuilder(rng, 0), cloth: new GeoBuilder(rng, 0), gloss: new GeoBuilder(rng, 0) });
    const attach = (p: Part, parent: THREE.Object3D): void => {
      for (const [b, m] of [[p.skin, skinMat], [p.cloth, clothMat], [p.gloss, glossMat]] as const) {
        if (b.isEmpty) continue;
        const mesh = new THREE.Mesh(b.build(), m);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
      }
    };

    // Hips at HIP_Y; everything above hangs off the torso, legs off the hips.
    this.hips.position.y = HIP_Y;
    this.group.add(this.hips);
    const pelvis = part();
    // Board shorts: seat and waistband (mostly under the untucked shirt).
    pelvis.cloth.add(
      tube([[-0.16, 0.05, 0.04, 0.05], [-0.12, 0.125, 0.09, 0.105], [-0.06, 0.142, 0.095, 0.11], [0.0, 0.142, 0.094, 0.1], [0.06, 0.134, 0.09, 0.092]], 24, 2.2),
      C.shorts,
    );
    attach(pelvis, this.hips);

    this.torso.position.y = 0.06;
    this.hips.add(this.torso);
    const body = part();
    // Slim-fit linen shirt: broad shoulders, narrow waist, worn untucked (wider hem).
    body.cloth.add(place(tube(TORSO, 32, TORSO_N), 0, 0, 0), C.shirt);
    body.cloth.add(tube([[-0.072, 0.148, 0.108, 0.112], [-0.055, 0.146, 0.106, 0.11]], 32, TORSO_N), C.shirtDark);
    // Open collar: skin in the V, a collar band round the back of the neck, points laid open.
    body.skin.add(chestPatch(0.35, 0.462, 0.046, 0.0015), C.skin);
    body.cloth.add(
      place(new THREE.TorusGeometry(0.054, 0.009, 6, 24, Math.PI * 1.1), 0, 0.452, 0.006, -Math.PI / 2 + 0.25, 0, Math.PI * 0.95),
      C.shirt,
    );
    for (const s of [-1, 1]) {
      body.cloth.add(
        place(new THREE.ConeGeometry(0.022, 0.07, 3), s * 0.04, 0.41, torsoFront(0.41, s * 0.04) - 0.002, 0.15, Math.PI, -s * 0.55, 1, 1, 0.12),
        C.shirtDark,
      );
    }
    // Button placket following the chest curve, buttons, chest pocket.
    for (let y = 0.0; y < 0.34; y += 0.04) {
      body.cloth.add(place(new THREE.BoxGeometry(0.017, 0.042, 0.003), 0, y + 0.02, torsoFront(y + 0.02, 0) - 0.0008), C.shirtDark);
    }
    for (const y of [0.06, 0.15, 0.24, 0.32]) body.gloss.add(place(ball(0.0055, 8, 6), 0, y, torsoFront(y, 0) - 0.0025, 0, 0, 0, 1, 1, 0.5), C.button);
    body.cloth.add(place(new THREE.BoxGeometry(0.058, 0.064, 0.003), -0.068, 0.29, torsoFront(0.29, -0.068) - 0.0012, 0, 0.32, 0), C.shirtDark);
    body.cloth.add(place(new THREE.BoxGeometry(0.06, 0.012, 0.004), -0.068, 0.318, torsoFront(0.318, -0.068) - 0.002, 0, 0.32, 0), C.shirt);
    // Neck.
    body.skin.add(tube([[0.4, 0.044, 0.043, 0.046], [0.48, 0.041, 0.04, 0.044], [0.56, 0.04, 0.038, 0.042]], 18), C.skin);
    attach(body, this.torso);

    this.head.position.set(0, 0.58, -0.004);
    // Slightly large head: keeps the face readable at game-camera distance.
    this.head.scale.setScalar(1.0);
    this.torso.add(this.head);
    const head = part();
    const eyes: THREE.Vector3[] = [];
    buildHead({ skin: head.skin, gloss: head.gloss, eyes }, rng);
    attach(head, this.head);
    // Eyelids: skin caps hinged at the top of each eye, squashed up while open; they blink.
    const lidGeo = new THREE.SphereGeometry(1, 14, 10);
    for (const e of eyes) {
      const hinge = new THREE.Group();
      hinge.position.set(e.x, e.y + EYE.ry, e.z - 0.0006);
      const lid = new THREE.Mesh(lidGeo, skinMat);
      lid.scale.set(EYE.rx * 1.06, EYE.ry * 1.08, EYE.rz * 1.25);
      lid.position.y = -EYE.ry;
      hinge.add(lid);
      hinge.scale.y = 0.12;
      this.head.add(hinge);
      this.lids.push(hinge);
    }

    // Arms: short shirt sleeves, toned upper arms and forearms, hands, a bead bracelet.
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.19, 0.37, 0);
      this.torso.add(shoulder);
      const upper = part();
      upper.cloth.add(place(ball(1, 18, 12), 0, -0.03, 0, 0, 0, 0, 0.054, 0.04, 0.057), C.shirt);
      upper.cloth.add(tube([[-0.15, 0.056, 0.06, 0.058], [-0.08, 0.055, 0.059, 0.058], [-0.01, 0.054, 0.058, 0.057]], 20), C.shirt);
      upper.cloth.add(tube([[-0.155, 0.057, 0.061, 0.059], [-0.14, 0.057, 0.061, 0.059]], 20), C.shirtDark);
      upper.skin.add(
        tube([[-0.1, 0.044, 0.044, 0.043], [-0.16, 0.044, 0.047, 0.041], [-0.21, 0.04, 0.042, 0.038], [-0.27, 0.034, 0.034, 0.034], [-0.295, 0.028, 0.028, 0.03]], 16),
        C.skin,
      );
      attach(upper, shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -0.27;
      shoulder.add(elbow);
      const fore = part();
      fore.skin.add(
        tube([[0.02, 0.031, 0.032, 0.032], [-0.04, 0.035, 0.037, 0.037], [-0.12, 0.03, 0.031, 0.03], [-0.2, 0.02, 0.025, 0.024], [-0.235, 0.019, 0.024, 0.023]], 16),
        C.skin,
      );
      if (s > 0) {
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          fore.gloss.add(place(ball(0.0058, 8, 6), Math.cos(a) * 0.025, -0.205, Math.sin(a) * 0.029), k % 4 ? C.bead : C.beadLight);
        }
      }
      // The hand is built around the wrist, then moved down to it.
      const hand = new GeoBuilder(rng, 0);
      buildHand(hand, s);
      fore.skin.add(place(hand.build(), 0, -0.225, 0), C.skin);
      attach(fore, elbow);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
    }

    // Legs: board shorts to the knee (white side stripe), bare calves, flip-flops.
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.08, -0.03, 0);
      hip.scale.set(1, LEG_SCALE, 1);
      this.hips.add(hip);
      const thigh = part();
      thigh.cloth.add(
        tube([[-0.37, 0.09, 0.09, 0.09], [-0.2, 0.087, 0.086, 0.088], [-0.05, 0.085, 0.085, 0.09], [0.03, 0.068, 0.068, 0.072]], 22),
        C.shorts,
      );
      thigh.cloth.add(tube([[-0.378, 0.092, 0.092, 0.092], [-0.35, 0.091, 0.091, 0.091]], 22), C.shortsDark);
      thigh.cloth.add(place(new THREE.BoxGeometry(0.004, 0.33, 0.026), s * 0.088, -0.19, 0), C.stripe);
      thigh.skin.add(tube([[-0.43, 0.05, 0.05, 0.05], [-0.39, 0.056, 0.058, 0.055], [-0.3, 0.066, 0.068, 0.066]], 18), C.skin);
      attach(thigh, hip);
      const knee = new THREE.Group();
      knee.position.y = -0.41;
      hip.add(knee);
      const shin = part();
      shin.skin.add(
        tube([[-0.385, 0.03, 0.03, 0.032], [-0.33, 0.029, 0.028, 0.03], [-0.24, 0.038, 0.034, 0.042], [-0.15, 0.047, 0.042, 0.06], [-0.08, 0.05, 0.046, 0.06], [-0.02, 0.049, 0.05, 0.05], [0.03, 0.046, 0.05, 0.046]], 18),
        C.skin,
      );
      attach(shin, knee);
      const ankle = new THREE.Group();
      ankle.position.y = -0.375;
      knee.add(ankle);
      const foot = part();
      buildFoot(foot.skin, foot.cloth, s);
      attach(foot, ankle);
      this.hipJoints.push(hip);
      this.knees.push(knee);
      this.ankles.push(ankle);
    }
    this.group.name = 'avatar';
    this.group.visible = false;
  }

  /** Places and animates the body. Call once per frame while it is visible. */
  update(dt: number, p: Readonly<AvatarPose>): void {
    this.time += dt;
    // Face the walking direction (shortest way round); keep the last facing when standing.
    if (p.speed > 0.2) {
      const target = Math.atan2(-p.vx, -p.vz);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * damp(10, dt);
    }
    // Blend between standing, walking and running so stopping never snaps.
    this.gait += (clamp(p.speed / 1.6, 0, 1) - this.gait) * damp(8, dt);
    this.run += ((p.running && p.speed > 2 ? 1 : 0) - this.run) * damp(6, dt);
    const g = this.gait;
    const r = this.run;

    // Footfall at integer phase = legs at full stride (heel strike).
    const ph = Math.PI * p.phase;
    const swing = Math.cos(ph) * g * (0.45 + 0.35 * r);
    const lift = Math.sin(ph);
    const [hl, hr] = this.hipJoints;
    const [kl, kr] = this.knees;
    const [al, ar] = this.ankles;
    hl.rotation.x = swing;
    hr.rotation.x = -swing;
    // The knee bends while that leg swings forward.
    kl.rotation.x = -(0.05 + g * (0.5 + 0.6 * r) * Math.max(0, -lift));
    kr.rotation.x = -(0.05 + g * (0.5 + 0.6 * r) * Math.max(0, lift));
    // Feet stay roughly level with the ground; toes lift a little as a leg swings through.
    al.rotation.x = -0.65 * (hl.rotation.x + kl.rotation.x);
    ar.rotation.x = -0.65 * (hr.rotation.x + kr.rotation.x);

    // Arms swing opposite to the legs; elbows bend more when running.
    const breathe = Math.sin(this.time * 1.8);
    const [sl, sr] = this.shoulders;
    const [el, er] = this.elbows;
    sl.rotation.x = -swing * 0.8;
    sr.rotation.x = swing * 0.8;
    sl.rotation.z = -0.08 - 0.02 * breathe * (1 - g);
    sr.rotation.z = 0.08 + 0.02 * breathe * (1 - g);
    el.rotation.x = er.rotation.x = 0.25 + 0.9 * r;

    // Body: bob (lowest at each footfall), hips turn with the stride and the chest turns back
    // against them, lean forward when running, breathing at rest.
    this.hips.position.y = HIP_Y + 0.035 * g * Math.abs(lift) - 0.03 * r;
    this.hips.rotation.y = 0.12 * swing;
    this.torso.rotation.y = -0.2 * swing;
    this.torso.rotation.x = -0.18 * r - 0.03 * g;
    this.torso.scale.y = 1 + 0.008 * breathe * (1 - g);
    // Standing still, the head looks around slowly.
    const idle = 1 - g;
    this.head.rotation.x = 0.12 * r + 0.05 * idle * Math.sin(this.time * 0.23);
    this.head.rotation.y = 0.08 * swing + idle * 0.3 * Math.sin(this.time * 0.31) * Math.sin(this.time * 0.13 + 1);

    // Blink every few seconds (a quick close and open).
    this.blink -= dt;
    let closed = 0;
    if (this.blink < 0) {
      closed = Math.sin((-this.blink / 0.16) * Math.PI);
      if (this.blink < -0.16) {
        this.blink = 2 + 3 * Math.abs(Math.sin(this.time * 12.9898) % 1);
        closed = 0;
      }
    }
    const lid = 0.12 + 0.88 * Math.max(0, closed);
    for (const h of this.lids) h.scale.y = lid;

    this.group.position.set(p.x, p.feetY, p.z);
    this.group.rotation.y = this.yaw;
  }

  /** Faces a direction immediately (when walking starts). */
  setYaw(yaw: number): void {
    this.yaw = yaw;
  }
}
