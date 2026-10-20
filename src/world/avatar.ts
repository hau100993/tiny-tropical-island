import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geoBuilder';
import { patchWorldMaterial } from './patchMaterial';
import { createRng, type Rng } from '../core/rng';
import { clamp, damp, smoothstep } from '../core/math';
import type { SharedUniforms } from '../core/uniforms';

/**
 * The walker's body for the third-person view: a young man dressed for the beach (Korean
 * curtain hair: a middle part with two swept bangs framing the forehead, slim-fit pale linen shirt with an open collar, board
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
 * It is a skinned mesh: a skeleton of 15 bones (hips → spine → head, shoulders → elbows →
 * wrists, hips → knees → ankles). Arms and legs are each ONE continuous skin whose vertices
 * near a joint are weighted between the two bones, so the GPU bends the knee and elbow smoothly
 * (no rigid, toy-like segments). JS only sets ~25 joint angles per frame from a gait cycle
 * (heel strike, knee give, push-off, knee fold in the swing). Three draw calls (skin, cloth,
 * hair/eyes, sharing one skeleton) plus the two eyelids.
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

/** Hairline height (unit-sphere y) by angle around the head: forehead (high in the middle,
 * where the curtain bangs part), temples, over the ears, down to the nape. */
const HAIRLINE: ReadonlyArray<readonly [number, number]> = [
  [0, 0.6], [0.3, 0.52], [0.6, 0.4], [0.85, 0.36], [1.2, 0.3], [1.5, 0.24], [1.8, 0.24], [2.3, -0.1], [2.8, -0.32], [Math.PI, -0.36],
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
 * (so the edge fades out instead of a rim); short at the sides and back, full and lifted on
 * top toward the front, with a shallow groove along the middle part (the curtain cut).
 */
function hairScale(x: number, y: number, z: number): number {
  const t = smoothstep(hairline(x, z) - 0.16, hairline(x, z) + 0.04, y);
  const top = smoothstep(0.15, 0.85, y);
  const front = Math.max(0, -z);
  // The part runs from the crown to the front hairline; the hair rises on both sides of it.
  const part = Math.exp(-((x / 0.07) ** 2)) * smoothstep(0.15, -0.25, z) * top;
  return 0.955 + t * (0.075 + 0.08 * top + 0.08 * front * top - 0.05 * part);
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
    // Just above the shell, so the strands are never buried in it.
    const s = Math.max(hairScale(dir.x, dir.y, dir.z) + 0.012, 1.04);
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

/**
 * All the locks. Curtain bangs: from a middle part the hair lifts and sweeps out to each side,
 * the front locks arching over the forehead down to the temples (forehead open in the middle,
 * tips at the outer ends of the brows); top locks comb from the part down over the sides.
 */
function hairLocks(hair: GeoBuilder, rng: Rng): void {
  const jit = (a: number): number => (rng() - 0.5) * 2 * a;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  for (const s of [-1, 1]) {
    // Curtain: roots along the front half of the part; the front ones arch over the forehead.
    for (let i = 0; i <= 9; i++) {
      const t = i / 9;
      const d0 = v3(s * (0.03 + jit(0.01)), lerp(0.97, 0.66, t), lerp(-0.15, -0.74, t));
      const d1 = v3(s * lerp(0.92, 0.66 + jit(0.03), t), lerp(0.48, 0.2, t) + jit(0.03), lerp(-0.2, -0.78, t));
      // Lifted at the root, bulging forward and out, so the bangs have body.
      const c = v3(s * lerp(0.55, 0.3, t), lerp(1.0, 0.72, t), lerp(-0.4, -1.05, t));
      hair.add(lock(d0, c, d1, 0.013 + rng() * 0.004, 0.007), C.hair);
    }
    // Top: from the back half of the part, combed down over the side of the head.
    for (let i = 0; i < 7; i++) {
      const z = 0.05 + i * 0.08 + jit(0.03);
      const d0 = v3(s * 0.03, 0.99, z);
      const d1 = v3(s * 0.95, 0.45 + jit(0.05), z * 0.9);
      const c = v3(s * 0.65, 1.0, z);
      hair.add(lock(d0, c, d1, 0.014 + rng() * 0.004, 0.006), C.hair);
    }
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
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // It must face forward (−Z) or it is culled; flip the winding if it came out backwards.
  if (g.getAttribute('normal').getZ(Math.floor(pos.length / 6)) > 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    g.setIndex(index);
    g.computeVertexNormals();
  }
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

/** Influences on one vertex: up to four (bone, weight) pairs. */
type Influence = ReadonlyArray<readonly [THREE.Bone, number]>;
/** Skin weights for a vertex at (x, y, z) in the coordinates of the bone it was built for. */
type Weigher = (x: number, y: number, z: number) => Influence;

/**
 * Collects parts of a skinned mesh. Each part is built around one bone (in that bone's
 * coordinates, as if the body stood in its rest pose), weighted to that bone or blended
 * between neighbours, then moved into the model's rest pose.
 */
class SkinBuilder {
  private parts: THREE.BufferGeometry[] = [];

  constructor(private readonly bones: readonly THREE.Bone[]) {}

  /** `color` null keeps the part's own vertex colors (parts merged by a GeoBuilder). */
  add(g: THREE.BufferGeometry, color: string | null, bone: THREE.Bone, weigh?: Weigher): void {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const pos = g.getAttribute('position');
    const n = pos.count;
    if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
    if (color !== null) {
      const c = new THREE.Color(color);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const index = new Uint16Array(n * 4);
    const weight = new Float32Array(n * 4);
    const self = this.bones.indexOf(bone);
    for (let i = 0; i < n; i++) {
      if (!weigh) {
        index[i * 4] = self;
        weight[i * 4] = 1;
        continue;
      }
      const inf = weigh(pos.getX(i), pos.getY(i), pos.getZ(i));
      let sum = 0;
      for (const [, w] of inf) sum += w;
      inf.slice(0, 4).forEach(([b, w], k) => {
        index[i * 4 + k] = this.bones.indexOf(b);
        weight[i * 4 + k] = w / sum;
      });
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    g.applyMatrix4(bone.matrixWorld);
    this.parts.push(g);
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) throw new Error('SkinBuilder: failed to merge geometries');
    return merged;
  }
}

/** Two bones blended along local y: all `a` above `y0`, all `b` below `y1`. */
function blendY(a: THREE.Bone, b: THREE.Bone, y0: number, y1: number): Weigher {
  return (_x, y) => {
    const t = smoothstep(y0, y1, y);
    return [[a, 1 - t], [b, t]];
  };
}

/**
 * Densifies tube cross-sections (a ring every `step` m), so a skinned limb has enough rings to
 * bend smoothly at a joint. The sizes follow a Catmull-Rom curve through the given rings: it
 * passes through each one with a continuous slope, so the outline has no kinks or flat bands.
 */
function rings(r: readonly Ring[], step = 0.012): Ring[] {
  const out: Ring[] = [];
  const at = (i: number): Ring => r[Math.max(0, Math.min(r.length - 1, i))];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
    0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
  for (let i = 0; i < r.length - 1; i++) {
    const a = at(i - 1);
    const b = at(i);
    const c = at(i + 1);
    const d = at(i + 2);
    const n = Math.max(1, Math.round(Math.abs(c[0] - b[0]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([
        b[0] + (c[0] - b[0]) * t,
        cr(a[1], b[1], c[1], d[1], t),
        cr(a[2], b[2], c[2], d[2], t),
        cr(a[3], b[3], c[3], d[3], t),
      ]);
    }
  }
  out.push(r[r.length - 1]);
  return out;
}

/** Copies a geometry built by a GeoBuilder (keeps its colors). */
function built(fill: (b: GeoBuilder) => void, rng: Rng): THREE.BufferGeometry {
  const b = new GeoBuilder(rng, 0);
  fill(b);
  return b.build();
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

/** One leg's joint angles (rad) at gait cycle position `s` (0 = heel strike). */
interface LegAngles {
  hip: number;
  knee: number;
  foot: number;
  /** 1 while the foot is on the ground, 0 in the swing. */
  stance: number;
}

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * Joint angles over one gait cycle, sampled every 10% (degrees), after measured human gait
 * (sagittal hip, knee and ankle curves). `hip` > 0 swings the thigh forward, `knee` is the
 * flexion, `foot` the sole's pitch against the ground (> 0 toes up). Walking: heel strike with
 * the toes up, the knee gives ~17° as the weight lands, ~37° at toe-off and ~58° in the swing.
 * Running: a shorter stance (40%), a bent-knee landing and a deep fold in the swing.
 */
const WALK = {
  hip: [20, 18, 12, 5, -3, -9, -13, -3, 11, 19],
  knee: [4, 14, 17, 11, 6, 15, 38, 58, 46, 16],
  foot: [14, 2, 0, 0, -8, -22, -30, -6, 4, 11],
  toeOff: 0.6,
} as const;
const RUN = {
  hip: [30, 22, 9, -6, -18, -10, 10, 30, 42, 38],
  knee: [22, 38, 33, 24, 26, 62, 95, 98, 70, 38],
  foot: [8, 0, -4, -16, -34, -15, 0, 8, 14, 12],
  toeOff: 0.4,
} as const;

/** Periodic Catmull-Rom through samples at s = 0, 0.1, … 0.9 (degrees in, radians out). */
function cyc(table: readonly number[], s: number): number {
  const n = table.length;
  const x = (((s % 1) + 1) % 1) * n;
  const i = Math.floor(x);
  const t = x - i;
  const p0 = table[(i - 1 + n) % n];
  const p1 = table[i % n];
  const p2 = table[(i + 1) % n];
  const p3 = table[(i + 2) % n];
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t) * DEG;
}

function legAngles(s: number, run: number, out: LegAngles): LegAngles {
  const mix = (w: number, r: number): number => w + (r - w) * run;
  out.hip = mix(cyc(WALK.hip, s), cyc(RUN.hip, s));
  out.knee = mix(cyc(WALK.knee, s), cyc(RUN.knee, s));
  out.foot = mix(cyc(WALK.foot, s), cyc(RUN.foot, s));
  const off = mix(WALK.toeOff, RUN.toeOff);
  out.stance = 1 - smoothstep(off - 0.03, off + 0.03, s) + smoothstep(0.97, 1.0, s);
  return out;
}

/**
 * A damped spring (follow-through): the value chases its target with a little lag and
 * overshoot, like a forearm or a head carried by the body's motion. Sub-stepped for stability.
 */
class Spring {
  x = 0;
  private v = 0;
  constructor(
    private readonly freq: number,
    private readonly zeta: number,
  ) {}

  step(target: number, dt: number): number {
    const w = TAU * this.freq;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      this.v += (w * w * (target - this.x) - 2 * this.zeta * w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }

  snap(value: number): void {
    this.x = value;
    this.v = 0;
  }
}

/** Ground height under (x, z) for feet near `nearY` (terrain, the house floor, the steps). */
export type GroundQuery = (x: number, z: number, nearY: number) => number;

const THIGH = 0.41 * LEG_SCALE;
const SHIN = 0.375 * LEG_SCALE;
/** Ankle joint height above the ground when standing. */
const ANKLE_H = HIP_Y - 0.03 - THIGH - SHIN;
/** From the ankle to the ball of the foot (where the heel lifts around at toe-off). */
const TOE = 0.12;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpInv = new THREE.Matrix4();

export class Avatar {
  readonly group = new THREE.Group();
  private readonly hips = new THREE.Bone();
  private readonly torso = new THREE.Bone();
  private readonly head = new THREE.Bone();
  private readonly lids: THREE.Object3D[] = [];
  private readonly shoulders: THREE.Bone[] = [];
  private readonly elbows: THREE.Bone[] = [];
  private readonly wrists: THREE.Bone[] = [];
  private readonly hipJoints: THREE.Bone[] = [];
  private readonly knees: THREE.Bone[] = [];
  private readonly ankles: THREE.Bone[] = [];
  private readonly leg: LegAngles = { hip: 0, knee: 0, foot: 0, stance: 1 };
  // Follow-through: forearms, hands, chest and head lag the motion a little.
  private readonly elbowS = [new Spring(3.2, 0.55), new Spring(3.2, 0.55)];
  private readonly wristS = [new Spring(2.4, 0.4), new Spring(2.4, 0.4)];
  private readonly chestS = new Spring(2.5, 0.7);
  // Foot planting (IK): where each foot is pinned while it carries weight, and how pinned it is.
  private readonly lock = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly locked = [false, false];
  private readonly plant = [0, 0];
  private readonly target = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly sole = [0, 0];
  private readonly stanceW = [1, 1];
  private rootY = Number.NaN;
  private drop = 0;
  private yaw = 0;
  private gait = 0;
  private run = 0;
  private time = 0;
  /** Seconds until the next blink; negative while the eyes are closing/opening. */
  private blink = 2;

  constructor(
    shared: SharedUniforms,
    /** Ground under each foot; without it the feet stay on the walker's ground height. */
    private readonly groundAt: GroundQuery | null = null,
  ) {
    // Three materials: matte cloth, soft skin, glossier hair and eyes. All get wet in the rain
    // and cloud shadows like the rest of the world.
    const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58 });
    const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38 });
    patchWorldMaterial(skinMat, { wet: true, porosity: 0.3 }, shared);
    patchWorldMaterial(clothMat, { wet: true, porosity: 0.7 }, shared);
    patchWorldMaterial(glossMat, { wet: true, porosity: 0.4 }, shared);
    const rng = createRng(77);

    // ---- Skeleton (rest pose: standing straight, arms down) ----
    const L = LEG_SCALE;
    this.hips.position.y = HIP_Y;
    this.torso.position.y = 0.06;
    this.head.position.set(0, 0.58, -0.004);
    this.group.add(this.hips);
    this.hips.add(this.torso);
    this.torso.add(this.head);
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Bone();
      shoulder.position.set(s * 0.19, 0.37, 0);
      const elbow = new THREE.Bone();
      elbow.position.y = -0.27;
      const wrist = new THREE.Bone();
      wrist.position.y = -0.225;
      this.torso.add(shoulder);
      shoulder.add(elbow);
      elbow.add(wrist);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
      this.wrists.push(wrist);
      const hip = new THREE.Bone();
      hip.position.set(s * 0.08, -0.03, 0);
      const knee = new THREE.Bone();
      knee.position.y = -0.41 * L;
      const ankle = new THREE.Bone();
      ankle.position.y = -0.375 * L;
      this.hips.add(hip);
      hip.add(knee);
      knee.add(ankle);
      this.hipJoints.push(hip);
      this.knees.push(knee);
      this.ankles.push(ankle);
    }
    const bones: THREE.Bone[] = [];
    this.hips.traverse((o) => {
      if (o instanceof THREE.Bone) bones.push(o);
    });
    this.group.updateMatrixWorld(true);
    const skin = new SkinBuilder(bones);
    const cloth = new SkinBuilder(bones);
    const gloss = new SkinBuilder(bones);
    const T = this.torso;
    const H = this.hips;

    // ---- Pelvis: board shorts seat (follows the hips) ----
    cloth.add(
      tube([[-0.16, 0.05, 0.04, 0.05], [-0.12, 0.125, 0.09, 0.105], [-0.06, 0.142, 0.095, 0.11], [0.0, 0.142, 0.094, 0.1], [0.06, 0.134, 0.09, 0.092]], 24, 2.2),
      C.shorts,
      H,
    );

    // ---- Torso: slim-fit linen shirt, untucked; the hem leans with the hips ----
    const hem = blendY(H, T, -0.07, 0.1);
    // (Not densified: the V neckline and placket sit on this exact outline, see torsoFront.)
    cloth.add(tube(TORSO, 32, TORSO_N), C.shirt, T, hem);
    cloth.add(tube([[-0.072, 0.148, 0.108, 0.112], [-0.055, 0.146, 0.106, 0.11]], 32, TORSO_N), C.shirtDark, T, hem);
    // Open collar: skin in the V, a collar band round the back of the neck, points laid open.
    skin.add(chestPatch(0.35, 0.462, 0.046, 0.0015), C.skin, T);
    cloth.add(
      place(new THREE.TorusGeometry(0.054, 0.009, 6, 24, Math.PI * 1.1), 0, 0.452, 0.006, -Math.PI / 2 + 0.25, 0, Math.PI * 0.95),
      C.shirt,
      T,
    );
    for (const s of [-1, 1]) {
      cloth.add(
        place(new THREE.ConeGeometry(0.022, 0.07, 3), s * 0.04, 0.41, torsoFront(0.41, s * 0.04) - 0.002, 0.15, Math.PI, -s * 0.55, 1, 1, 0.12),
        C.shirtDark,
        T,
      );
    }
    // Button placket following the chest curve, buttons, chest pocket.
    for (let y = 0.0; y < 0.34; y += 0.04) {
      cloth.add(place(new THREE.BoxGeometry(0.017, 0.042, 0.003), 0, y + 0.02, torsoFront(y + 0.02, 0) - 0.0008), C.shirtDark, T, hem);
    }
    for (const y of [0.06, 0.15, 0.24, 0.32]) {
      gloss.add(place(ball(0.0055, 8, 6), 0, y, torsoFront(y, 0) - 0.0025, 0, 0, 0, 1, 1, 0.5), C.button, T, hem);
    }
    cloth.add(place(new THREE.BoxGeometry(0.058, 0.064, 0.003), -0.068, 0.29, torsoFront(0.29, -0.068) - 0.0012, 0, 0.32, 0), C.shirtDark, T);
    cloth.add(place(new THREE.BoxGeometry(0.06, 0.012, 0.004), -0.068, 0.318, torsoFront(0.318, -0.068) - 0.002, 0, 0.32, 0), C.shirt, T);
    // Neck: bends between the shoulders and the head.
    skin.add(tube(rings([[0.4, 0.044, 0.043, 0.046], [0.48, 0.041, 0.04, 0.044], [0.57, 0.04, 0.038, 0.042]]), 18), C.skin, T, blendY(T, this.head, 0.47, 0.56));

    // ---- Head ----
    const headSkin = new GeoBuilder(rng, 0);
    const headGloss = new GeoBuilder(rng, 0);
    const eyes: THREE.Vector3[] = [];
    buildHead({ skin: headSkin, gloss: headGloss, eyes }, rng);
    skin.add(headSkin.build(), null, this.head);
    gloss.add(headGloss.build(), null, this.head);
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

    // ---- Arms: one continuous skin from shoulder to wrist (bends smoothly at the elbow) ----
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const sh = this.shoulders[i];
      const el = this.elbows[i];
      const wr = this.wrists[i];
      // Shoulder and sleeve in one piece: a deltoid dome whose top tucks into the shirt's
      // shoulder line, then the sleeve. The dome is weighted between the chest and the arm, so
      // it bends like a shoulder when the arm swings instead of pivoting as a separate can.
      const sleeve = blendY(T, sh, 0.035, -0.07);
      cloth.add(
        tube(
          rings([
            [-0.15, 0.056, 0.06, 0.058], [-0.08, 0.055, 0.059, 0.058], [-0.03, 0.056, 0.06, 0.058], [0.0, 0.052, 0.057, 0.055],
            [0.025, 0.038, 0.046, 0.044], [0.042, 0.012, 0.018, 0.018],
          ], 0.008),
          22,
        ),
        C.shirt,
        sh,
        sleeve,
      );
      cloth.add(tube([[-0.155, 0.057, 0.061, 0.059], [-0.14, 0.057, 0.061, 0.059]], 20), C.shirtDark, sh);
      const arm: Weigher = (_x, y) => {
        const e = smoothstep(-0.23, -0.31, y);
        const w = smoothstep(-0.47, -0.5, y);
        return [[sh, 1 - e], [el, e * (1 - w)], [wr, w]];
      };
      skin.add(
        tube(
          rings([
            [-0.08, 0.044, 0.044, 0.043], [-0.16, 0.044, 0.047, 0.041], [-0.22, 0.039, 0.04, 0.037], [-0.27, 0.034, 0.033, 0.037],
            [-0.31, 0.035, 0.037, 0.036], [-0.39, 0.03, 0.031, 0.03], [-0.47, 0.02, 0.025, 0.024], [-0.505, 0.019, 0.024, 0.023],
          ]),
          18,
        ),
        C.skin,
        sh,
        arm,
      );
      if (s > 0) {
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          gloss.add(place(ball(0.0058, 8, 6), Math.cos(a) * 0.025, -0.205, Math.sin(a) * 0.029), k % 4 ? C.bead : C.beadLight, el);
        }
      }
      skin.add(built((b) => buildHand(b, s), rng), C.skin, wr);
    }

    // ---- Legs: one continuous skin from mid thigh to ankle (a real knee), shorts, feet ----
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const hp = this.hipJoints[i];
      const kn = this.knees[i];
      const an = this.ankles[i];
      // Shorts leg: its top follows the pelvis a little, so the seat stretches over a raised leg.
      const shorts: Weigher = (_x, y) => {
        const t = smoothstep(-0.1 * L, 0.04 * L, y) * 0.6;
        return [[H, t], [hp, 1 - t]];
      };
      const scaleL = (g: THREE.BufferGeometry): THREE.BufferGeometry => g.scale(1, L, 1);
      cloth.add(scaleL(tube(rings([[-0.37, 0.09, 0.09, 0.09], [-0.2, 0.087, 0.086, 0.088], [-0.05, 0.085, 0.085, 0.09], [0.03, 0.068, 0.068, 0.072]], 0.02), 22)), C.shorts, hp, shorts);
      cloth.add(scaleL(tube([[-0.378, 0.092, 0.092, 0.092], [-0.35, 0.091, 0.091, 0.091]], 22)), C.shortsDark, hp);
      cloth.add(scaleL(place(new THREE.BoxGeometry(0.004, 0.33, 0.026), s * 0.088, -0.19, 0)), C.stripe, hp);
      const kneeY = -0.41 * L;
      const ankleY = kneeY - 0.375 * L;
      const legW: Weigher = (_x, y) => {
        const k = smoothstep(kneeY + 0.045, kneeY - 0.045, y);
        const a = smoothstep(ankleY + 0.04, ankleY - 0.005, y);
        return [[hp, 1 - k], [kn, k * (1 - a)], [an, a]];
      };
      // Thigh → knee (a slight bony narrowing, kneecap in front) → calf → ankle.
      skin.add(
        scaleL(
          tube(
            rings([
              [-0.28, 0.068, 0.07, 0.068], [-0.36, 0.06, 0.062, 0.06], [-0.41, 0.05, 0.054, 0.05], [-0.45, 0.047, 0.048, 0.052],
              [-0.5, 0.05, 0.046, 0.06], [-0.57, 0.047, 0.042, 0.06], [-0.65, 0.038, 0.034, 0.042], [-0.74, 0.029, 0.028, 0.03],
              [-0.79, 0.03, 0.03, 0.032],
            ]),
            20,
          ),
        ),
        C.skin,
        hp,
        legW,
      );
      const footSkin = new GeoBuilder(rng, 0);
      const footCloth = new GeoBuilder(rng, 0);
      buildFoot(footSkin, footCloth, s);
      skin.add(scaleL(footSkin.build()), null, an);
      cloth.add(scaleL(footCloth.build()), null, an);
    }

    // One skinned mesh per material, all sharing the skeleton: the GPU bends each vertex by
    // its (up to four) weighted bones, so elbows and knees fold smoothly instead of the parts
    // pivoting like toy blocks.
    const skeleton = new THREE.Skeleton(bones);
    for (const [b, m] of [[skin, skinMat], [cloth, clothMat], [gloss, glossMat]] as const) {
      const mesh = new THREE.SkinnedMesh(b.build(), m);
      mesh.bind(skeleton);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The bones move the vertices far from the rest-pose bounds; the body is small, never cull.
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.group.name = 'avatar';
    this.group.visible = false;
  }

  /**
   * Places and animates the body. Call once per frame while it is visible.
   *
   * 1. Forward kinematics from the gait tables (hip, knee, foot pitch per leg; pelvis, chest,
   *    arms), blended standing → walking → running.
   * 2. Foot planting: a foot that carries weight is pinned to the ground where it landed (no
   *    sliding); a swinging foot follows the gait but keeps its clearance above the actual
   *    ground under it (steps, slopes).
   * 3. Two-bone IK per leg (law of cosines) reaches those targets; when a target is out of
   *    reach the pelvis lowers, which also gives the natural dip of each step.
   */
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
    // The body rides a smoothed ground height (steps would make it jump); the legs reach the
    // real ground under each foot.
    const fresh = Number.isNaN(this.rootY) || Math.abs(p.feetY - this.rootY) > 1;
    this.rootY = fresh ? p.feetY : this.rootY + (p.feetY - this.rootY) * damp(10, dt);

    // ---- 1. Gait from the tables (two steps per cycle; left heel at even footfalls) ----
    const cycle = p.phase / 2;
    const breathe = Math.sin(this.time * 1.8);
    for (let i = 0; i < 2; i++) {
      const s = (((cycle + i * 0.5) % 1) + 1) % 1;
      const a = legAngles(s, r, this.leg);
      this.hipJoints[i].rotation.x = a.hip * g;
      this.knees[i].rotation.x = -(0.04 + (a.knee - 0.04) * g);
      // Legs slightly apart at rest, a touch less while walking (feet under the body).
      this.hipJoints[i].rotation.z = (i === 0 ? -1 : 1) * (0.03 - 0.01 * g);
      this.sole[i] = a.foot * g;
      // Standing still, both feet carry weight.
      this.stanceW[i] = Math.max(a.stance, 1 - g);
    }
    // Pelvis: drops on the side of the swinging leg and turns with the forward leg; the chest
    // turns against it. Leans into the stride (more when running). Its height comes from IK.
    const sL = (((cycle % 1) + 1) % 1) * TAU;
    this.hips.position.y = HIP_Y;
    this.hips.rotation.z = (0.05 - 0.02 * r) * g * Math.sin(sL);
    this.hips.rotation.y = (0.1 + 0.04 * r) * g * Math.cos(sL);
    if (fresh) this.chestS.snap(0);
    this.torso.rotation.y = this.chestS.step(-(0.14 + 0.06 * r) * g * Math.cos(sL), dt);
    this.torso.rotation.z = -0.03 * g * Math.sin(sL);
    this.torso.rotation.x = -(0.05 * g + 0.17 * r);
    this.torso.scale.y = 1 + 0.008 * breathe * (1 - g);

    // Arms swing against the leg on the same side (right arm back as the right leg comes
    // forward), a beat behind it. The elbow is always a little bent and folds more as the arm
    // comes forward; the forearm and the hand trail the upper arm (springs).
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const s = (((cycle + i * 0.5 - 0.04) % 1) + 1) % 1;
      const legSwing = cyc(WALK.hip, s) + (cyc(RUN.hip, s) - cyc(WALK.hip, s)) * r - (8 + 6 * r) * DEG;
      const shoulder = -legSwing * (0.75 + 0.35 * r) * g;
      this.shoulders[i].rotation.x = shoulder;
      this.shoulders[i].rotation.z = side * (0.08 + 0.02 * breathe * (1 - g) + 0.08 * r);
      const fwd = Math.max(0, shoulder) / (0.3 + 0.4 * r);
      const elbow = 0.2 + g * (0.12 + 0.35 * fwd) + r * (1.15 + 0.25 * fwd);
      if (fresh) this.elbowS[i].snap(elbow);
      this.elbows[i].rotation.x = this.elbowS[i].step(elbow, dt);
      // The hand flops a little behind the forearm's motion.
      this.wrists[i].rotation.x = this.wristS[i].step(0.1 * g * Math.sin(sL + i * Math.PI - 0.6) + 0.05, dt);
    }

    // ---- 2. Foot targets (world space) ----
    const root = this.group;
    root.position.set(p.x, this.rootY, p.z);
    root.rotation.y = this.yaw;
    root.updateMatrixWorld(true);
    let need = 0;
    for (let i = 0; i < 2; i++) {
      const nominal = this.ankles[i].getWorldPosition(tmpA);
      // Feet land close to the body's midline when walking (a step width of ~10 cm, feet almost
      // in line), a little wider when standing; not under the hip joints, which looked bow-legged.
      root.worldToLocal(nominal);
      nominal.x = (i === 0 ? -1 : 1) * (0.09 - 0.04 * g - 0.01 * r);
      root.localToWorld(nominal);
      const ground = this.groundAt ? this.groundAt(nominal.x, nominal.z, p.feetY) : p.feetY;
      // Heel up at toe-off: the foot pivots on its ball, lifting the ankle.
      const lift = this.sole[i] < 0 ? TOE * Math.sin(-this.sole[i]) : 0.03 * Math.sin(this.sole[i]);
      const onGround = ground + ANKLE_H + lift;
      const st = this.stanceW[i];
      if (st > 0.5) {
        // Pin where the foot lands; re-pin if the body got far from it (turning on the spot,
        // a teleport, the first frame).
        if (!this.locked[i] || fresh || this.lock[i].distanceTo(nominal) > 0.55) {
          this.lock[i].set(nominal.x, onGround, nominal.z);
          this.locked[i] = true;
        }
        this.lock[i].y = onGround;
      } else {
        this.locked[i] = false;
      }
      this.plant[i] = fresh ? (this.locked[i] ? 1 : 0) : this.plant[i] + ((this.locked[i] ? 1 : 0) - this.plant[i]) * damp(this.locked[i] ? 40 : 14, dt);
      // Swing: the gait's path, lifted by the same clearance above the real ground.
      const clearance = Math.max(0, nominal.y - (this.rootY + ANKLE_H));
      const t = this.target[i].set(nominal.x, onGround + clearance * (1 - st), nominal.z);
      t.lerp(this.lock[i], this.plant[i]);
      // How far the pelvis must come down for this leg to reach.
      const hipPos = this.hipJoints[i].getWorldPosition(tmpB);
      need = Math.max(need, hipPos.distanceTo(t) - (THIGH + SHIN - 0.004));
    }
    this.drop += (Math.max(0, need) - this.drop) * (fresh ? 1 : damp(16, dt));
    this.hips.position.y = HIP_Y - this.drop;
    root.updateMatrixWorld(true);

    // ---- 3. Two-bone IK per leg, in the pelvis's frame ----
    tmpInv.copy(this.hips.matrixWorld).invert();
    for (let i = 0; i < 2; i++) {
      const d = tmpA.copy(this.target[i]).applyMatrix4(tmpInv).sub(this.hipJoints[i].position);
      const len = Math.min(THIGH + SHIN - 1e-4, Math.max(Math.abs(THIGH - SHIN) + 1e-3, d.length()));
      d.normalize();
      // Leg direction after roll (z) then pitch (x): (sin z, −cos z·cos x, −cos z·sin x).
      const roll = Math.asin(clamp(d.x, -1, 1));
      const pitch = Math.atan2(-d.z, -d.y);
      const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - len * len) / (2 * THIGH * SHIN), -1, 1));
      // The thigh points ahead of the hip→ankle line by this much (the knee bends backward).
      const ahead = Math.acos(clamp((THIGH * THIGH + len * len - SHIN * SHIN) / (2 * THIGH * len), -1, 1));
      const hipX = pitch + ahead;
      this.hipJoints[i].rotation.set(hipX, 0, roll);
      this.knees[i].rotation.x = -knee;
      // Sole against the ground: the gait's pitch, minus what the leg already tilts it.
      this.ankles[i].rotation.x = this.sole[i] - (hipX - knee);
    }

    // Head stays level (counters the torso), looks around slowly when standing still.
    const idle = 1 - g;
    this.head.rotation.x = 0.16 * r + 0.04 * g + 0.05 * idle * Math.sin(this.time * 0.23);
    this.head.rotation.y = 0.12 * g * Math.cos(sL) + idle * 0.3 * Math.sin(this.time * 0.31) * Math.sin(this.time * 0.13 + 1);

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

  }

  /** Faces a direction immediately (when walking starts). */
  setYaw(yaw: number): void {
    this.yaw = yaw;
  }
}
