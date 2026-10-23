import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geoBuilder';
import { patchWorldMaterial } from './patchMaterial';
import { createRng, type Rng } from '../core/rng';
import { clamp, damp, smoothstep } from '../core/math';
import { RUN_GAIT_MIN, RUN_STEP, WALK_STEP } from '../core/gait';
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
  // Jaw angle: the lower sides stay a little fuller toward the back, under the ears.
  const jaw = smoothstep(-0.25, -0.6, y) * smoothstep(-0.95, -0.7, y) * smoothstep(-0.7, -0.1, z) * smoothstep(0.5, 0.1, z);
  x *= 1 - 0.18 * low + 0.07 * jaw;
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
  [0.36, 0.175, 0.104, 0.1],
  [0.39, 0.176, 0.094, 0.096],
  [0.41, 0.166, 0.084, 0.088],
  [0.428, 0.142, 0.07, 0.077],
  [0.442, 0.112, 0.056, 0.066],
  [0.452, 0.08, 0.046, 0.058],
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
        // Narrower at the top, where it runs up inside the wrist.
        const up = smoothstep(0.2, 1, v.y);
        v.set(sq(v.x) * 0.0125 * (1.15 - 0.3 * v.y), v.y * 0.05, sq(v.z) * 0.037 * (1 - 0.35 * up));
      }),
      0,
      -0.04,
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
    // A relaxed hand: fingers only a little curled (more looked like claws, swimming).
    const a1 = 0.16;
    const a2 = 0.45;
    const x1 = -s * Math.sin(a1) * L * 0.5;
    const y1 = -0.082 - Math.cos(a1) * L * 0.5;
    const x2 = x1 - s * Math.sin(a2) * L * 0.55;
    const y2 = y1 - Math.cos(a2) * L * 0.55;
    // One tapered tube per finger from inside the palm, bending at the knuckle, round tip.
    skin.add(sweep([[0, -0.07, z], [0, -0.08, z], [x1, y1, z], [x2, y2, z * 0.95]], [r * 1.05, r, r * 0.92, r * 0.78]), C.skin);
  }
  // Thumb: from the base of the palm at the front, forward and in.
  // (It starts well inside the palm, so its root never shows.)
  skin.add(sweep([[-s * 0.001, -0.024, -0.026], [-s * 0.006, -0.036, -0.034], [-s * 0.016, -0.062, -0.05], [-s * 0.022, -0.084, -0.046]], [0.0075, 0.0098, 0.009, 0.0078]), C.skin);
}

/**
 * A smooth tube along a path (fingers): circular sections of the given radii at each point,
 * densified with Catmull-Rom between them, a rounded tip at the end and a plain cap at the
 * start (hidden inside the palm).
 */
function sweep(path: readonly (readonly [number, number, number])[], radii: readonly number[], seg = 10): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const rs: number[] = [];
  const P = path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const at = (i: number): THREE.Vector3 => P[Math.max(0, Math.min(P.length - 1, i))];
  const sub = 4;
  for (let i = 0; i < P.length - 1; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      const t2 = t * t;
      const t3 = t2 * t;
      pts.push(
        new THREE.Vector3()
          .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
          .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
          .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
          .addScaledVector(p3, 0.5 * t3 - 0.5 * t2),
      );
      rs.push(radii[i] + (radii[i + 1] - radii[i]) * t);
    }
  }
  pts.push(P[P.length - 1].clone());
  rs.push(radii[radii.length - 1]);
  // Round tip: a few shrinking sections past the last point.
  const end = pts[pts.length - 1];
  const dir = end.clone().sub(pts[pts.length - 2]).normalize();
  const rEnd = rs[rs.length - 1];
  for (const k of [0.45, 0.75, 0.93]) {
    pts.push(end.clone().addScaledVector(dir, rEnd * k));
    rs.push(rEnd * Math.sqrt(1 - k * k));
  }
  const pos: number[] = [];
  const index: number[] = [];
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const b = new THREE.Vector3();
  const ref = new THREE.Vector3(0, 0, 1);
  for (let j = 0; j < pts.length; j++) {
    t.copy(pts[Math.min(pts.length - 1, j + 1)]).sub(pts[Math.max(0, j - 1)]).normalize();
    n.crossVectors(t, ref);
    if (n.lengthSq() < 1e-6) n.crossVectors(t, b.set(1, 0, 0));
    n.normalize();
    b.crossVectors(t, n).normalize();
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a) * rs[j];
      const sn = Math.sin(a) * rs[j];
      pos.push(pts[j].x + n.x * c + b.x * sn, pts[j].y + n.y * c + b.y * sn, pts[j].z + n.z * c + b.z * sn);
    }
  }
  for (let j = 0; j < pts.length - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const p = j * seg + i;
      const q = j * seg + ((i + 1) % seg);
      index.push(p, q, p + seg, q, q + seg, p + seg);
    }
  }
  const startC = pos.length / 3;
  pos.push(pts[0].x, pts[0].y, pts[0].z);
  const endC = startC + 1;
  pos.push(...end.clone().addScaledVector(dir, rEnd).toArray());
  const last = (pts.length - 1) * seg;
  for (let i = 0; i < seg; i++) {
    index.push(startC, (i + 1) % seg, i);
    index.push(endC, last + i, last + ((i + 1) % seg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** The leg's rings from mid thigh to the ankle: y, half-width, front, back (before the leg scale). */
const LEG: readonly Ring[] = [
  [-0.28, 0.068, 0.07, 0.068], [-0.36, 0.059, 0.061, 0.058], [-0.41, 0.052, 0.055, 0.047], [-0.45, 0.05, 0.049, 0.05],
  [-0.52, 0.05, 0.045, 0.062], [-0.58, 0.046, 0.041, 0.058], [-0.66, 0.037, 0.034, 0.04], [-0.74, 0.029, 0.029, 0.029],
  [-0.785, 0.028, 0.029, 0.03],
];
/** Ankle joint height and the sole, in the thigh's frame (before the leg scale). */
const ANKLE_Y = -0.785;
const SOLE = ANKLE_Y - 0.08;
/**
 * The shin turns into the foot round a bend of this radius, starting at the ankle, so the path
 * runs on along the foot 2 cm above the sole. The bend's inside (the instep) has radius
 * BEND_R minus the instep's reach: kept well above zero, or the instep folds into a crease.
 */
const BEND_R = 0.075;
const BEND_Y = SOLE + 0.02 + BEND_R;
/**
 * Sections round that bend, by its angle (0 = still the shin, 90° = along the foot): angle,
 * half-width, reach toward the front/top, reach toward the back/bottom. The back reach swells
 * at 15–45° and comes back in: that bulge is the heel, below and behind the Achilles.
 */
const BEND: readonly Ring[] = [
  [0, 0.029, 0.031, 0.032],
  [15, 0.031, 0.034, 0.05],
  [30, 0.033, 0.037, 0.068],
  [45, 0.035, 0.04, 0.05],
  [60, 0.037, 0.042, 0.03],
  [75, 0.039, 0.043, 0.022],
  [90, 0.04, 0.044, 0.02],
];
/** The foot ahead of the bend: z (−Z forward), half-width, top's height above the sole. */
const FOOT: readonly Ring[] = [
  [-BEND_R, 0.04, 0.064, 0],
  [-0.098, 0.046, 0.049, 0],
  [-0.124, 0.047, 0.034, 0],
  [-0.15, 0.045, 0.025, 0],
  [-0.166, 0.041, 0.02, 0],
  [-0.177, 0.031, 0.015, 0],
  [-0.184, 0.012, 0.009, 0],
];

/**
 * The whole bare leg (side `s`: −1 left, +1 right) as ONE surface, in the thigh's frame: a tube
 * swept down a path that runs straight down the thigh and shin, bends forward under the ankle
 * and runs along the foot to the toes. Each section is an oval across the path: round on the
 * leg, flat underneath along the foot (a sole). Round the bend the front of the shin becomes
 * the instep and the back swells into the heel, so there is no seam anywhere between leg and
 * foot (two separate shapes always showed one, like a shoe). Along the foot: the arch lifted on
 * the inside, the toe line slanting back from the big toe, grooves between the toes and rounded
 * tips.
 */
function legGeometry(s: number): THREE.BufferGeometry {
  const seg = 32;
  const pos: number[] = [];
  const index: number[] = [];
  let sections = 0;
  // One section: centre (y, z) on the path, the path's "front" direction v = (0, vy, vz) (the
  // front of the shin, the top of the foot), its half-width a and reaches f (front) and b
  // (back); `flat` 0..1 squares the lower half off into a sole; `shape` moves each point.
  const section = (
    cy: number,
    cz: number,
    vy: number,
    vz: number,
    a: number,
    f: number,
    b: number,
    flat: number,
    shape?: (x: number, y: number, z: number, top: boolean, sn: number) => [number, number, number],
  ): void => {
    for (let i = 0; i < seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const c = Math.cos(ang);
      const sn = Math.sin(ang);
      const top = sn > 0;
      // Round on the leg; along the foot a fuller dome on top and a flat sole underneath.
      const ex = top ? 1 - 0.2 * flat : 1 - 0.45 * flat;
      const x = a * Math.sign(c) * Math.abs(c) ** ex;
      const r = top ? f * sn : b * Math.sign(sn) * Math.abs(sn) ** (1 - 0.55 * flat);
      let y = cy + vy * r;
      let z = cz + vz * r;
      let px = x;
      if (shape) [px, y, z] = shape(x, y, z, top, sn);
      pos.push(px, y, z);
    }
    sections++;
  };

  // ---- Thigh and shin, straight down ----
  // (Only down to where the bend begins: a ring below it would fold back over it.)
  for (const [y, a, f, b] of rings(LEG)) if (y > BEND_Y + 0.004) section(y, 0, 0, -1, a, f, b, 0);
  // ---- The bend: centre of the turn at (BEND_Y, −BEND_R); the path turns from down to forward ----
  for (const [deg, a, f, b] of rings(BEND, 5)) {
    const phi = (deg * Math.PI) / 180;
    const cy = BEND_Y - BEND_R * Math.sin(phi);
    const cz = -BEND_R + BEND_R * Math.cos(phi);
    section(cy, cz, Math.sin(phi), -Math.cos(phi), a, f, b, smoothstep(30, 80, deg));
  }
  // ---- Along the foot ----
  const toeX = [-0.0215, -0.0045, 0.0065, 0.017, 0.0275].map((t) => s * t);
  const toeLen = [1, 0.8, 0.65, 0.5, 0.35];
  const gaps = toeX.slice(1).map((t, k) => (t + toeX[k]) / 2);
  for (const [z0, w, h] of rings(FOOT, 0.008).slice(1)) {
    // The path drops toward the toes so the sole stays on the ground as the foot thins.
    const d = Math.min(0.02, h * 0.45);
    const toes = smoothstep(-0.124, -0.146, z0);
    const front = smoothstep(-0.15, -0.176, z0);
    const arch = smoothstep(-0.04, -0.06, z0) * smoothstep(-0.115, -0.085, z0);
    const shift = -s * 0.004 * smoothstep(-0.05, -0.1, z0);
    section(SOLE + d, z0, 1, 0, w, h - d, d, 1, (x, y, _z, top, sn) => {
      const inner = smoothstep(-w, w, -s * x);
      // The arch: the inside of the sole lifts between the heel and the ball.
      if (!top) y += 0.012 * arch * inner * -sn;
      if (top && toes > 0) {
        let dip = 0;
        for (let k = 0; k < gaps.length; k++) dip += (k === 0 ? 0.45 : 0.3) * Math.exp(-(((x - gaps[k]) / 0.0032) ** 2));
        y -= (h - d) * sn * Math.min(0.6, dip) * toes;
      }
      // Toe line: the big toe reaches furthest, the little toe least; each tip rounds forward.
      let tip = 0;
      for (let k = 0; k < toeX.length; k++) tip = Math.max(tip, toeLen[k] * Math.exp(-(((x - toeX[k]) / (k === 0 ? 0.008 : 0.0045)) ** 2)));
      return [x + shift, y, z0 - 0.012 * toes * (inner - 0.5) - 0.007 * front * tip];
    });
  }

  for (let j = 0; j < sections - 1; j++) {
    for (let i = 0; i < seg; i++) {
      const p = j * seg + i;
      const q = j * seg + ((i + 1) % seg);
      // (p, next section, next around) faces outward for this section layout.
      index.push(p, p + seg, q, q, p + seg, q + seg);
    }
  }
  // Close both ends: the top inside the shorts, the toe tip (tiny there).
  for (const [ring, up] of [[0, true], [sections - 1, false]] as const) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < seg; i++) {
      cx += pos[(ring * seg + i) * 3];
      cy += pos[(ring * seg + i) * 3 + 1];
      cz += pos[(ring * seg + i) * 3 + 2];
    }
    const center = pos.length / 3;
    pos.push(cx / seg, cy / seg, cz / seg);
    for (let i = 0; i < seg; i++) {
      const p = ring * seg + i;
      const q = ring * seg + ((i + 1) % seg);
      if (up) index.push(center, p, q);
      else index.push(center, q, p);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
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
  /** Current step length (m) the phase counts in (the walker's `stride`). */
  stride: number;
  running: boolean;
  /**
   * Petting the dog (1) or not (0; eased in and out here): crouches facing `petYaw`, the right
   * hand on the fur at `petHand` (world), the left on the knee.
   */
  pet?: number;
  petYaw?: number;
  petHand?: THREE.Vector3;
}

/** Sitting in a boat and holding a paddle (the kayak). */
export interface SeatedPose {
  /** World transform of the seat: origin where the paddler sits, −Z forward. */
  seat: THREE.Matrix4;
  /** World positions of the left and right grips on the paddle shaft. */
  hands: readonly [THREE.Vector3, THREE.Vector3];
  /** Torso turn (rad, positive brings the right shoulder forward) and forward lean (rad). */
  twist: number;
  lean: number;
  /** Where the head looks, relative to the boat (rad). */
  lookYaw: number;
  lookPitch: number;
  /** Where the ankles go, in the seat's frame (x mirrored for the left foot). */
  feet: { x: number; y: number; z: number };
  /** Seen through the eyes: the head is folded away so the camera sees the arms, not the skull. */
  firstPerson: boolean;
}

/** Swimming (from the walker). */
export interface SwimPose {
  x: number;
  z: number;
  /** Sea surface at the swimmer. */
  surfaceY: number;
  vx: number;
  vz: number;
  speed: number;
  /** Arm cycles done (fraction = position in the cycle). */
  phase: number;
  /** 0 breaststroke … 1 front crawl; 0 treading water … 1 swimming. */
  crawl: number;
  move: number;
  firstPerson: boolean;
  /** Diving: where the chest is (NaN: just under the surface), and the body's elevation (rad, NaN: from the stroke). */
  chestY: number;
  lift: number;
}

/** On the surfboard (the surf activity). */
export interface SurfPose {
  /** World transform of the deck: origin on the deck in the middle, −Z the nose, +Y up. */
  board: THREE.Matrix4;
  /** 0 lying on it (paddling) … 1 standing (riding). */
  stand: number;
  /** Arm strokes done, and how hard it paddles (0..1). */
  stroke: number;
  paddling: number;
  /** Knees bent (0..1); the lean into the turn (rad, > 0 turning left). */
  crouch: number;
  lean: number;
  firstPerson: boolean;
}

/** Joint angles of one swimming pose (rad), per side where it matters [left, right]. */
interface SwimAngles {
  shX: [number, number];
  shZ: [number, number];
  el: [number, number];
  hipX: [number, number];
  hipZ: [number, number];
  knee: [number, number];
  ankle: [number, number];
  /** Body roll about its long axis, head nod (+ lifts the face) and turn. */
  roll: number;
  headX: number;
  headY: number;
}

const swimAngles = (): SwimAngles => ({
  shX: [0, 0], shZ: [0, 0], el: [0, 0], hipX: [0, 0], hipZ: [0, 0], knee: [0, 0], ankle: [0, 0], roll: 0, headX: 0, headY: 0,
});

const frac = (x: number): number => x - Math.floor(x);
const bump = (x: number, a: number, b: number): number => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));

/**
 * Front crawl at cycle position `s`: each arm turns a full circle (entry overhead, pull under
 * the chest to the hip, recovery over the water with a high elbow), half a cycle apart; the
 * body rolls toward the pulling arm, the head turns to breathe on the right; six flutter kicks
 * per cycle from the hips with loose knees and pointed toes.
 */
function crawlAngles(s: number, out: SwimAngles): void {
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const a = frac(s + i * 0.5);
    const pull = a < 0.5 ? Math.sin(2 * Math.PI * a) : 0;
    const rec = a >= 0.5 ? Math.sin(Math.PI * (2 * a - 1)) : 0;
    out.shX[i] = Math.PI - 2 * Math.PI * a;
    out.shZ[i] = side * (0.12 + 0.35 * rec);
    out.el[i] = 0.1 + 0.4 * pull + 1.5 * rec;
    const k = 6 * Math.PI * s + i * Math.PI;
    // A narrow kick from the hips: the feet stay just under the surface.
    out.hipX[i] = 0.13 * Math.sin(k);
    out.hipZ[i] = side * 0.05;
    out.knee[i] = 0.1 + 0.22 * Math.max(0, Math.sin(k + 1.2));
    out.ankle[i] = -1.25;
  }
  out.roll = 0.5 * Math.sin(2 * Math.PI * s);
  out.headX = 0.2;
  out.headY = -0.9 * bump(s, 0.08, 0.42);
}

/**
 * Breaststroke at cycle position `s`: pull (arms sweep out and in under the chest, head up to
 * breathe), then the arms shoot forward while the heels come up and the frog kick snaps the
 * legs together (s ≈ 0.5), then a long glide.
 */
function breastAngles(s: number, out: SwimAngles): void {
  const pull = bump(s, 0, 0.38);
  const armIn = s < 0.45 ? smoothstep(0.12, 0.38, s) : 1 - smoothstep(0.45, 0.6, s);
  const legIn = smoothstep(0.28, 0.46, s) * (1 - smoothstep(0.5, 0.6, s));
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    out.shX[i] = Math.PI - 1.15 * armIn;
    out.shZ[i] = side * (0.08 + 0.8 * pull * (1 - armIn));
    out.el[i] = 1.7 * armIn;
    out.hipX[i] = 1.0 * legIn;
    out.hipZ[i] = side * (0.06 + 0.42 * legIn);
    out.knee[i] = 2.1 * legIn;
    out.ankle[i] = -1.25 + 1.1 * legIn;
  }
  out.roll = 0;
  out.headX = 0.25 + 0.55 * pull;
  out.headY = 0;
}

/** Treading water, upright: hands sculling out to the sides, legs cycling (eggbeater). */
function treadAngles(t: number, out: SwimAngles): void {
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    out.shX[i] = 0.35 + 0.3 * Math.sin(t * 3 + i * Math.PI);
    out.shZ[i] = side * (1.1 + 0.15 * Math.sin(t * 3));
    out.el[i] = 0.7;
    out.hipX[i] = 0.85 + 0.35 * Math.sin(t * 3.2 + i * Math.PI);
    out.hipZ[i] = side * 0.45;
    out.knee[i] = 1.3 + 0.4 * Math.sin(t * 3.2 + i * Math.PI + 1);
    out.ankle[i] = -0.4;
  }
  out.roll = 0;
  out.headX = 0;
  out.headY = 0;
}

/**
 * Hand paths for the strokes, in the torso's frame (+Y toward the head, −Z the chest, +X the
 * right; the right hand, mirrored in X for the left): keyframes [cycle position, x, y, z], and
 * where the palm faces [x, y, z]. A two-bone arm IK (elbow pole up and out, toward the back)
 * reaches them, so the elbows bend by themselves: a high elbow in the crawl's pull, elbows out
 * in the breaststroke, a relaxed recovery over the water.
 */
type HandKey = readonly [number, number, number, number, number, number, number];

/** Front crawl, one arm (0 = entering the water in front of the shoulder). */
const CRAWL_HAND: readonly HandKey[] = [
  // t, position, palm
  [0.0, 0.17, 0.86, -0.1, 0.2, -0.2, -1],
  [0.12, 0.2, 0.74, -0.3, 0.1, -0.6, -0.8],
  [0.26, 0.09, 0.36, -0.4, 0, -1, -0.3],
  [0.4, 0.17, -0.04, -0.27, 0, -1, 0.2],
  [0.5, 0.24, -0.26, -0.06, 0.4, -0.6, 0.6],
  [0.62, 0.36, -0.06, 0.12, 1, 0, 0.4],
  [0.76, 0.36, 0.34, 0.16, 0.7, 0.2, -0.6],
  [0.9, 0.26, 0.7, 0.06, 0.3, 0, -1],
];
/** Breaststroke, both hands (0 = the glide, arms out in front). */
const BREAST_HAND: readonly HandKey[] = [
  [0.0, 0.07, 0.9, -0.13, 0.2, 0, -1],
  [0.16, 0.4, 0.76, -0.15, 1, -0.3, -0.4],
  [0.28, 0.32, 0.46, -0.33, 0.6, -1, -0.2],
  [0.38, 0.08, 0.32, -0.24, -0.6, -0.5, -0.4],
  [0.46, 0.05, 0.42, -0.16, -0.7, 0, -0.6],
  [0.6, 0.06, 0.84, -0.12, 0, 0, -1],
];
/** Lying on the surfboard, one arm paddling (0 = reaching in ahead, past the rail). */
const BOARD_HAND: readonly HandKey[] = [
  [0.0, 0.36, 0.72, -0.22, 0.1, -0.4, -0.8],
  [0.15, 0.4, 0.52, -0.46, 0, -1, -0.3],
  [0.35, 0.38, 0.12, -0.42, 0, -1, 0.1],
  [0.5, 0.36, -0.16, -0.2, 0.4, -0.5, 0.6],
  [0.68, 0.42, 0.08, 0.04, 0.8, 0, 0.3],
  [0.85, 0.4, 0.5, 0.0, 0.4, 0, -0.8],
];

/** Point (and palm) on a looped hand path at cycle position `t` (Catmull-Rom between keys). */
function handOnPath(keys: readonly HandKey[], t: number, pos: THREE.Vector3, palm: THREE.Vector3): void {
  const n = keys.length;
  const f = frac(t);
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] <= f) i = k;
  const k1 = keys[i];
  const k2 = keys[(i + 1) % n];
  const t1 = k1[0];
  const t2 = i + 1 < n ? k2[0] : 1 + keys[0][0];
  const u = (f - t1) / Math.max(1e-6, t2 - t1);
  const k0 = keys[(i - 1 + n) % n];
  const k3 = keys[(i + 2) % n];
  const cr = (a: number, b: number, c: number, d: number): number =>
    0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  pos.set(cr(k0[1], k1[1], k2[1], k3[1]), cr(k0[2], k1[2], k2[2], k3[2]), cr(k0[3], k1[3], k2[3], k3[3]));
  palm.set(k1[4] + (k2[4] - k1[4]) * u, k1[5] + (k2[5] - k1[5]) * u, k1[6] + (k2[6] - k1[6]) * u).normalize();
}

/** Treading water: hands sculling out to the sides at chest height, palms down. */
function treadHand(time: number, i: number, pos: THREE.Vector3, palm: THREE.Vector3): void {
  const w = Math.sin(time * 3 + i * Math.PI);
  pos.set(0.42 + 0.1 * w, 0.18, -0.2 + 0.04 * w);
  palm.set(0.3 * w, -0.2, -1).normalize();
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

/**
 * The procedural skeleton, read by a loaded character that copies its pose (world/character.ts).
 * In the rest pose every bone has an identity rotation: arms hanging straight down, legs
 * straight, facing −Z.
 */
export interface AvatarRig {
  readonly group: THREE.Object3D;
  readonly hips: THREE.Bone;
  readonly torso: THREE.Bone;
  readonly head: THREE.Bone;
  readonly shoulders: readonly THREE.Bone[];
  readonly elbows: readonly THREE.Bone[];
  readonly wrists: readonly THREE.Bone[];
  readonly hipJoints: readonly THREE.Bone[];
  readonly knees: readonly THREE.Bone[];
  readonly ankles: readonly THREE.Bone[];
}

const THIGH = 0.41 * LEG_SCALE;
const SHIN = 0.375 * LEG_SCALE;
/** Ankle joint height above the ground when standing. */
const ANKLE_H = HIP_Y - 0.03 - THIGH - SHIN;
/** Built-in body, at scale 1: hip joint to ankle, and the pelvis bone's rest height. */
export const AVATAR_LEG = THIGH + SHIN;
export const AVATAR_HIP_Y = HIP_Y;
/** From the ankle to the ball of the foot (where the heel lifts around at toe-off). */
const TOE = 0.12;
const UPPER_ARM = 0.27;
/** Elbow to the middle of the palm. */
const FOREARM = 0.225 + 0.045;
/** Seated: hip joint height above the seat. */
const SIT_H = 0.13;
/**
 * The pelvis lowers until the longer leg is this much (m) short of straight. Near full extension
 * the knee angle is very sensitive: 4 mm short is already a 12° bend (a crouch when standing);
 * 1 mm is ~6°, a relaxed stance.
 */
const REACH_SLACK = 0.001;
/** Stopped with the feet apart: a foot further than this (m) from its standing spot steps back. */
const SETTLE_MIN = 0.06;
/** Duration (s) and foot lift (m) of that small step. */
const SETTLE_TIME = 0.3;
const SETTLE_LIFT = 0.05;
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpD = new THREE.Vector3();
const tmpInv = new THREE.Matrix4();
const tmpBasis = new THREE.Matrix4();
const swimA = swimAngles();
const swimB = swimAngles();
const swimC = swimAngles();
const handA = new THREE.Vector3();
const handB = new THREE.Vector3();
const palmA = new THREE.Vector3();
const palmB = new THREE.Vector3();
/** Elbow pole for swimming (torso frame, right arm): out to the side and up toward the back. */
const SWIM_POLE = new THREE.Vector3(0.75, 0.05, 0.65).normalize();
const poleTmp = new THREE.Vector3();
/** Petting: how far (m) the pelvis comes down and back, and the forward lean (rad). */
const PET_CROUCH = 0.36;
const PET_BACK = 0.09;
const PET_HIP_TILT = 0.22;
const PET_LEAN = 0.45;
/**
 * Petting is a half kneel: the left foot steps forward (m) so its knee comes up and the left
 * hand can rest on it; the right foot goes back, heel up and toes tucked under (sole pitch,
 * rad), so the right knee comes down near the ground.
 */
const PET_STEP = 0.3;
const PET_KNEEL_BACK = 0.12;
const PET_HEEL_UP = 0.07;
const PET_TOES = -0.9;
/** Palm down on the fur. */
const PALM_DOWN = new THREE.Vector3(0, -1, 0);
const armQ = [new THREE.Quaternion(), new THREE.Quaternion()];
const elbowQ = [new THREE.Quaternion(), new THREE.Quaternion()];
const wristQ = [new THREE.Quaternion(), new THREE.Quaternion()];

export class Avatar {
  readonly group = new THREE.Group();
  /**
   * How wet the character looks (0..1): darker cloth and hair, glossy skin. Set by the owner
   * from swimming and the rain (the world's wetness doesn't reach under the roof).
   */
  readonly wetness = { value: 0 };
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
  /** Stopping: progress (0..1) of a foot stepping back under the body; −1 when not. */
  private readonly settle = [-1, -1];
  private readonly settleFrom = [new THREE.Vector3(), new THREE.Vector3()];
  private rootY = Number.NaN;
  private drop = 0;
  private yaw = 0;
  /** The last update was seated (bones then need a reset before walking again). */
  private seated = false;
  private swimLift = 1.35;
  private gait = 0;
  private run = 0;
  private time = 0;
  /** Petting the dog, eased (0..1). */
  private petW = 0;
  /**
   * Body scale: 1 for the built-in body. A loaded character scales the skeleton so its legs are
   * as long as the character's (the feet then land right); every length in metres used against
   * the world below is multiplied by it.
   */
  private k = 1;
  /** The built-in body's meshes (hidden while a loaded character wears the skeleton). */
  private readonly ownMeshes: THREE.Object3D[] = [];
  /** Seconds until the next blink; negative while the eyes are closing/opening. */
  private blink = 2;

  constructor(
    shared: SharedUniforms,
    /** Ground under each foot; without it the feet stay on the walker's ground height. */
    private readonly groundAt: GroundQuery | null = null,
  ) {
    // Three materials: matte cloth, soft skin, glossier hair and eyes. All get wet (own wetness,
    // see `wetness`) and cloud shadows like the rest of the world.
    const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58 });
    const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    const glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38 });
    const own: SharedUniforms = { ...shared, uWetness: this.wetness };
    // Wet cotton and hair darken a lot (porosity > 1: about half as bright soaked); skin mostly
    // just turns glossy.
    patchWorldMaterial(skinMat, { wet: true, porosity: 0.3 }, own);
    patchWorldMaterial(clothMat, { wet: true, porosity: 1.5 }, own);
    patchWorldMaterial(glossMat, { wet: true, porosity: 1.2 }, own);
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
    skin.add(
      tube(rings([[0.4, 0.05, 0.046, 0.053], [0.45, 0.044, 0.042, 0.048], [0.5, 0.041, 0.04, 0.044], [0.57, 0.043, 0.042, 0.045]]), 20),
      C.skin,
      T,
      blendY(T, this.head, 0.47, 0.56),
    );

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
      this.ownMeshes.push(hinge);
    }

    // ---- Arms: one continuous skin from shoulder to wrist (bends smoothly at the elbow) ----
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const sh = this.shoulders[i];
      const el = this.elbows[i];
      const wr = this.wrists[i];
      // Shoulder and sleeve in one piece: a rounded cap whose top tucks into the shirt's
      // sloping shoulder line, then the sleeve, a little wider toward the hem (it hangs, it
      // isn't padded). The dome is weighted between the chest and the arm, so
      // it bends like a shoulder when the arm swings instead of pivoting as a separate can.
      const sleeve = blendY(T, sh, 0.035, -0.07);
      cloth.add(
        tube(
          rings([
            [-0.15, 0.057, 0.061, 0.059], [-0.08, 0.053, 0.057, 0.055], [-0.03, 0.05, 0.054, 0.052], [-0.005, 0.047, 0.051, 0.049],
            [0.015, 0.041, 0.045, 0.043], [0.03, 0.031, 0.035, 0.034], [0.04, 0.018, 0.022, 0.021], [0.045, 0.006, 0.008, 0.008],
          ], 0.008),
          22,
        ),
        C.shirt,
        sh,
        sleeve,
      );
      cloth.add(tube([[-0.155, 0.059, 0.063, 0.061], [-0.14, 0.059, 0.063, 0.061]], 20), C.shirtDark, sh);
      const arm: Weigher = (_x, y) => {
        const e = smoothstep(-0.23, -0.31, y);
        const w = smoothstep(-0.47, -0.5, y);
        return [[sh, 1 - e], [el, e * (1 - w)], [wr, w]];
      };
      skin.add(
        tube(
          rings([
            [-0.08, 0.044, 0.044, 0.043], [-0.16, 0.044, 0.047, 0.041], [-0.22, 0.039, 0.04, 0.037], [-0.27, 0.034, 0.033, 0.037],
            [-0.31, 0.035, 0.037, 0.036], [-0.39, 0.03, 0.031, 0.03], [-0.47, 0.02, 0.025, 0.024], [-0.505, 0.018, 0.024, 0.023],
            [-0.53, 0.014, 0.02, 0.019], [-0.545, 0.008, 0.012, 0.012],
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
      // Same wrist blend as the forearm's (here in the wrist's frame), where the two overlap.
      skin.add(built((b) => buildHand(b, s), rng), C.skin, wr, (_x, y) => {
        const w = smoothstep(0.025, -0.005, y);
        return [[el, 1 - w], [wr, w]];
      });
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
        // A wide blend over the knee: it folds in a smooth curve, not a crease. The foot (all
        // below the ankle) follows the ankle; the blend into it sits just above the joint.
        const k = smoothstep(kneeY + 0.07, kneeY - 0.07, y);
        const a = smoothstep(ankleY + 0.04, ankleY - 0.005, y);
        return [[hp, 1 - k], [kn, k * (1 - a)], [an, a]];
      };
      // Thigh → knee (kneecap in front, a hollow behind; no narrowing all round, which read as
      // a joint ring) → calf belly high at the back → Achilles → ankle → heel and instep → toes,
      // one surface.
      skin.add(scaleL(legGeometry(s)), C.skin, hp, legW);
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
      this.ownMeshes.push(mesh);
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
    if (this.seated) this.stand();
    // Face the walking direction (shortest way round); keep the last facing when standing.
    // Petting: turn to the dog.
    this.petW += ((p.pet ?? 0) - this.petW) * damp(3.5, dt);
    const pw = smoothstep(0, 1, this.petW);
    if (p.speed > 0.2 || (pw > 0.01 && p.petYaw !== undefined)) {
      const target = p.speed > 0.2 ? Math.atan2(-p.vx, -p.vz) : (p.petYaw ?? 0);
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * damp(p.speed > 0.2 ? 10 : 5, dt);
    }
    // Blend between standing, walking and running so stopping never snaps. The stride's size
    // follows the walker's step length (short steps when slow), so planted feet never drag:
    // a full-size cycle covers WALK_STEP (RUN_STEP running) per step.
    this.run += ((p.running && p.speed > RUN_GAIT_MIN ? 1 : 0) - this.run) * damp(6, dt);
    const r = this.run;
    const size = clamp(p.stride / (WALK_STEP + (RUN_STEP - WALK_STEP) * r), 0, 1.15);
    this.gait += (size - this.gait) * damp(8, dt);
    const g = this.gait;
    // Standing still: feet left apart by the last stride step back together (below).
    const idle = g < 0.1 && p.speed < 0.1;
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
    this.torso.rotation.x = -(0.05 * g + 0.17 * r) - PET_LEAN * pw;
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
      const lift = (this.sole[i] < 0 ? TOE * Math.sin(-this.sole[i]) : 0.03 * Math.sin(this.sole[i])) * this.k;
      const onGround = ground + ANKLE_H * this.k + lift;
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
      this.settleFoot(i, idle, dt, tmpC.set(nominal.x, onGround, nominal.z));
      this.plant[i] = fresh ? (this.locked[i] ? 1 : 0) : this.plant[i] + ((this.locked[i] ? 1 : 0) - this.plant[i]) * damp(this.locked[i] ? 40 : 14, dt);
      // Swing: the gait's path, lifted by the same clearance above the real ground.
      const clearance = Math.max(0, nominal.y - (this.rootY + ANKLE_H * this.k));
      const t = this.target[i].set(nominal.x, onGround + clearance * (1 - st), nominal.z);
      t.lerp(this.lock[i], this.plant[i]);
      if (pw > 0.001) {
        tmpD.set(0, i === 0 ? 0 : PET_HEEL_UP, i === 0 ? -PET_STEP : PET_KNEEL_BACK).applyQuaternion(root.quaternion);
        t.addScaledVector(tmpD, pw * this.k);
      }
      // How far the pelvis must come down for this leg to reach.
      const hipPos = this.hipJoints[i].getWorldPosition(tmpB);
      need = Math.max(need, hipPos.distanceTo(t) - (THIGH + SHIN - REACH_SLACK) * this.k);
    }
    this.drop += (Math.max(0, need) - this.drop) * (fresh ? 1 : damp(16, dt));
    // (`drop` is in metres; the pelvis moves in the scaled body's units.) Petting: a crouch,
    // the pelvis down and back, tipped forward; the planted feet make the knees bend (IK below).
    this.hips.position.y = HIP_Y - this.drop / this.k - PET_CROUCH * pw;
    this.hips.position.z = PET_BACK * pw;
    this.hips.rotation.x = -PET_HIP_TILT * pw;
    root.updateMatrixWorld(true);

    // ---- 3. Two-bone IK per leg, in the pelvis's frame ----
    for (let i = 0; i < 2; i++) this.reachLeg(i, this.target[i], i === 1 ? this.sole[i] + (PET_TOES - this.sole[i]) * pw : this.sole[i]);
    if (pw > 0.001 && p.petHand) this.petArms(pw, p.petHand);

    // Head stays level (counters the torso), looks around slowly when standing still. Petting:
    // looks down at the dog.
    const still = (1 - g) * (1 - pw);
    this.head.rotation.x = 0.16 * r + 0.04 * g + 0.05 * still * Math.sin(this.time * 0.23) + 0.12 * pw;
    this.head.rotation.y = 0.12 * g * Math.cos(sL) + still * 0.3 * Math.sin(this.time * 0.31) * Math.sin(this.time * 0.13 + 1);

    this.blinkEyes(dt);
  }

  /**
   * Petting: the right hand reaches the fur at `hand` (world, two-bone IK, palm down), the left
   * rests on the raised left knee (see PET_STEP); blended by `w` from the walking arms.
   */
  private petArms(w: number, hand: THREE.Vector3): void {
    for (let i = 0; i < 2; i++) {
      armQ[i].copy(this.shoulders[i].quaternion);
      elbowQ[i].copy(this.elbows[i].quaternion);
      wristQ[i].copy(this.wrists[i].quaternion);
    }
    this.group.updateMatrixWorld(true);
    // Left knee: a little above the kneecap and toward the outside.
    const knee = this.knees[0].getWorldPosition(handA);
    tmpD.set(-0.03, 0.07, -0.05).applyQuaternion(this.group.quaternion).multiplyScalar(this.k);
    knee.add(tmpD);
    this.reachArm(0, knee, null, PALM_DOWN);
    this.reachArm(1, hand, null, PALM_DOWN);
    for (let i = 0; i < 2; i++) {
      this.shoulders[i].quaternion.copy(armQ[i].slerp(this.shoulders[i].quaternion, w));
      this.elbows[i].quaternion.copy(elbowQ[i].slerp(this.elbows[i].quaternion, w));
      this.wrists[i].quaternion.copy(wristQ[i].slerp(this.wrists[i].quaternion, w));
    }
  }

  /**
   * Stopping mid-stride leaves one foot ahead and one behind, the knees bent to reach them. Like
   * a person settling, step each foot back under the body, one at a time: a short lift and
   * place over SETTLE_TIME. Also how the feet follow when turning on the spot.
   */
  private settleFoot(i: number, idle: boolean, dt: number, spot: THREE.Vector3): void {
    const lock = this.lock[i];
    if (this.settle[i] < 0) {
      if (!idle || !this.locked[i] || this.settle[1 - i] >= 0) return;
      if (Math.hypot(lock.x - spot.x, lock.z - spot.z) < SETTLE_MIN) return;
      this.settle[i] = 0;
      this.settleFrom[i].copy(lock);
    }
    if (!idle) {
      // Walking again: the foot stays where it got to, the gait takes it from there.
      this.settle[i] = -1;
      return;
    }
    const t = Math.min(1, this.settle[i] + dt / SETTLE_TIME);
    lock.lerpVectors(this.settleFrom[i], spot, smoothstep(0, 1, t));
    lock.y += SETTLE_LIFT * Math.sin(Math.PI * t);
    this.settle[i] = t < 1 ? t : -1;
  }

  /** Blink every few seconds (a quick close and open). */
  private blinkEyes(dt: number): void {
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

  /**
   * Sitting in the kayak: legs stretched forward with the knees a little up, the torso turning
   * with each stroke, both hands on the paddle (two-bone IK per arm: shoulder → elbow → palm).
   */
  updateSeated(dt: number, p: Readonly<SeatedPose>): void {
    this.time += dt;
    this.seated = true;
    this.rootY = Number.NaN;
    const root = this.group;
    p.seat.decompose(root.position, root.quaternion, tmpC);
    root.scale.setScalar(this.k);
    this.hips.position.set(0, SIT_H, 0.02);
    this.hips.rotation.set(0.04, p.twist * 0.3, 0);
    this.torso.rotation.set(-p.lean, p.twist * 0.7, 0);
    this.torso.scale.y = 1;
    root.updateMatrixWorld(true);
    // Feet braced in the footwells (seat frame: −Z forward), knees a little bent.
    for (let i = 0; i < 2; i++) {
      const foot = tmpD.set((i === 0 ? -1 : 1) * p.feet.x, p.feet.y, p.feet.z).applyMatrix4(p.seat);
      this.reachLeg(i, foot, 0.45);
    }
    root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) this.reachArm(i, p.hands[i]);
    // The head keeps looking where the camera looks (within what a neck allows).
    this.head.rotation.set(
      clamp(p.lookPitch * 0.6, -0.5, 0.4) + p.lean * 0.8,
      clamp(p.lookYaw, -1.2, 1.2) - p.twist,
      0,
    );
    // Skinned vertices follow their bone's scale: a near-zero head collapses the head and hair
    // into one point inside the neck.
    this.head.scale.setScalar(p.firstPerson ? 0.001 : 1);
    this.blinkEyes(dt);
  }

  /**
   * Two-bone arm IK in the torso's frame: the palm reaches `target` (world), the elbow bends
   * out, down and back. The shoulder gets a full orientation (basis matrix), the elbow a hinge
   * angle (law of cosines); the forearm twists so the palm wraps over the shaft.
   */
  private reachArm(i: number, target: THREE.Vector3, poleTorso: THREE.Vector3 | null = null, palmWorld: THREE.Vector3 | null = null): void {
    const side = i === 0 ? -1 : 1;
    const sh = this.shoulders[i];
    tmpInv.copy(this.torso.matrixWorld).invert();
    const t = tmpA.copy(target).applyMatrix4(tmpInv);
    const d = tmpB.subVectors(t, sh.position);
    const a = UPPER_ARM;
    const b = FOREARM;
    const len = clamp(d.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    d.normalize();
    // Where the elbow points (torso frame): given, or out, down and back (holding a paddle).
    const pole = poleTorso ? tmpC.copy(poleTorso) : tmpC.set(side * 0.55, -0.55, 0.5).normalize();
    const perp = tmpD.copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
    const cosA = clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
    // Upper arm direction, rotated from the shoulder→palm line toward the pole.
    const u = d.multiplyScalar(cosA).addScaledVector(perp, Math.sqrt(1 - cosA * cosA));
    // Bone frame: −Y along the upper arm, −Z where the forearm folds (away from the pole).
    const zb = perp.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
    const yb = tmpA.copy(u).negate();
    const xb = tmpC.crossVectors(yb, zb);
    tmpBasis.makeBasis(xb, yb, zb);
    sh.quaternion.setFromRotationMatrix(tmpBasis);
    const bend = Math.PI - Math.acos(clamp((a * a + b * b - len * len) / (2 * a * b), -1, 1));
    this.elbows[i].rotation.set(bend, 0, 0);
    // Palm over the shaft: its normal (rest: facing the body, −side·X) turns toward the
    // paddler and down, about the forearm's axis. From the shoulder: its world matrix still
    // held the pose from before the IK, which put the forearm's frame (and the palm) wrong.
    sh.updateMatrixWorld(true);
    tmpInv.copy(this.elbows[i].matrixWorld).invert();
    const dir = palmWorld ? tmpA.copy(palmWorld) : tmpA.set(0, -0.8, 0.6).applyQuaternion(this.group.quaternion);
    const want = dir.add(this.elbows[i].getWorldPosition(tmpB)).applyMatrix4(tmpInv);
    this.wrists[i].rotation.set(0, Math.atan2(side * want.z, -side * want.x), 0);
  }

  /**
   * Two-bone leg IK in the pelvis's frame: the ankle reaches `target` (world), the knee bends
   * forward; `sole` is the foot's pitch against the ground (> 0 toes up).
   */
  private reachLeg(i: number, target: THREE.Vector3, sole: number): void {
    tmpInv.copy(this.hips.matrixWorld).invert();
    const d = tmpA.copy(target).applyMatrix4(tmpInv).sub(this.hipJoints[i].position);
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
    // Sole against the ground: the wanted pitch, minus what the leg already tilts it.
    this.ankles[i].rotation.x = sole - (hipX - knee);
  }

  /**
   * Swimming: the body lies along the water (front crawl flat, breaststroke a little more
   * upright, treading water upright with the head out) and the limbs follow the stroke
   * curves, blended by how fast you swim and which stroke you use.
   */
  updateSwimming(dt: number, p: Readonly<SwimPose>): void {
    this.time += dt;
    this.seated = true;
    this.rootY = Number.NaN;
    if (p.speed > 0.15) {
      const target = Math.atan2(-p.vx, -p.vz);
      const d = target - this.yaw;
      this.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * damp(4, dt);
    }
    const s = frac(p.phase);
    const cr = p.crawl;
    const mv = p.move;
    crawlAngles(s, swimA);
    breastAngles(s, swimB);
    treadAngles(this.time, swimC);
    // Stroke = breaststroke → crawl; then treading → stroke.
    const mix = (b: number, c: number, t: number): number => {
      const stroke = b + (c - b) * cr;
      return t + (stroke - t) * mv;
    };
    for (let i = 0; i < 2; i++) {
      this.hipJoints[i].rotation.set(mix(swimB.hipX[i], swimA.hipX[i], swimC.hipX[i]), 0, mix(swimB.hipZ[i], swimA.hipZ[i], swimC.hipZ[i]));
      this.knees[i].rotation.set(-mix(swimB.knee[i], swimA.knee[i], swimC.knee[i]), 0, 0);
      this.ankles[i].rotation.set(mix(swimB.ankle[i], swimA.ankle[i], swimC.ankle[i]), 0, 0);
    }
    const roll = mix(swimB.roll, swimA.roll, swimC.roll);
    this.hips.position.set(0, HIP_Y, 0);
    this.hips.rotation.set(0, roll * 0.6, 0);
    this.torso.rotation.set(0, roll * 0.4, 0);
    this.torso.scale.y = 1;
    this.head.rotation.set(mix(swimB.headX, swimA.headX, swimC.headX), mix(swimB.headY, swimA.headY, swimC.headY), 0);
    this.head.scale.setScalar(p.firstPerson ? 0.001 : 1);
    // Lying along the water: tilted up from flat by `lift` (crawl flattest, treading upright),
    // the breaststroke rising a little on each pull (to breathe).
    const strokeLift = 0.06 + 0.08 * (1 - cr) + 0.14 * (1 - cr) * bump(s, 0.15, 0.45);
    let lift = 1.35 + (strokeLift - 1.35) * mv;
    if (!Number.isNaN(p.lift)) lift = p.lift;
    // Turning to dive or rise takes a moment.
    this.swimLift += (lift - this.swimLift) * damp(4, dt);
    lift = this.swimLift;
    const pitch = -(Math.PI / 2 - lift);
    const root = this.group;
    root.rotation.set(pitch, this.yaw, 0, 'YXZ');
    // The chest sits just under the surface (deeper when treading: only the head is out).
    const chest = 1.25 * this.k;
    const depth = 0.24 + (0.12 + 0.06 * (1 - cr) - 0.24) * mv;
    const sp = Math.sin(pitch);
    const chestY = Number.isNaN(p.chestY) ? p.surfaceY - depth : p.chestY;
    root.position.set(
      p.x - chest * sp * Math.sin(this.yaw),
      chestY - chest * Math.cos(pitch),
      p.z - chest * sp * Math.cos(this.yaw),
    );
    root.updateMatrixWorld(true);
    // Arms: the hands follow the stroke's path (blended: breaststroke → crawl, treading → stroke).
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      handOnPath(CRAWL_HAND, s + i * 0.5, handA, palmA);
      handOnPath(BREAST_HAND, s, handB, palmB);
      handB.lerp(handA, cr);
      palmB.lerp(palmA, cr);
      treadHand(this.time, i, handA, palmA);
      handA.lerp(handB, mv);
      palmA.lerp(palmB, mv);
      this.armTo(i, side, handA, palmA, SWIM_POLE);
    }
    this.blinkEyes(dt);
  }

  /**
   * Arm IK to a hand position given in the torso's frame for the right arm (mirrored for the
   * left), with the palm facing `palm` (same frame) and the elbow toward `pole`.
   */
  private armTo(i: number, side: number, hand: THREE.Vector3, palm: THREE.Vector3, pole: THREE.Vector3): void {
    hand.x *= side;
    palm.x *= side;
    hand.applyMatrix4(this.torso.matrixWorld);
    palm.transformDirection(this.torso.matrixWorld);
    poleTmp.set(pole.x * side, pole.y, pole.z);
    this.reachArm(i, hand, poleTmp, palm);
  }

  /**
   * On the surfboard. Lying: face down along the board, head to the nose, chest arched, legs
   * together over the tail, the arms paddling (the crawl's arm circle, out past the rails).
   * Standing: sideways across the board (regular stance: left foot forward toward the nose),
   * knees bent, arms out along the board for balance, looking down the line toward the nose; the
   * board already rolls with the lean, the hips add a little more.
   */
  updateSurfing(dt: number, p: Readonly<SurfPose>): void {
    this.time += dt;
    this.seated = true;
    this.rootY = Number.NaN;
    const root = this.group;
    p.board.decompose(root.position, root.quaternion, tmpS);
    root.scale.setScalar(this.k);
    this.torso.scale.y = 1;
    this.head.scale.setScalar(p.firstPerson ? 0.001 : 1);
    if (p.stand < 0.5) {
      crawlAngles(frac(p.stroke), swimA);
      const k = p.paddling;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        this.hipJoints[i].rotation.set(0.02, 0, side * 0.05);
        this.knees[i].rotation.set(-0.06 - 0.12 * Math.max(0, Math.sin(this.time * 1.3 + i * 2)), 0, 0);
        this.ankles[i].rotation.set(-1.2, 0, 0);
      }
      this.hips.position.set(0, HIP_Y, 0);
      this.hips.rotation.set(0, swimA.roll * 0.15 * k, 0);
      // Chest up off the board, face looking ahead.
      this.torso.rotation.set(0.3, swimA.roll * 0.15 * k, 0);
      this.head.rotation.set(0.75, 0, 0);
      // Face down, head toward the nose: body +Y → board −Z. The spine lies ~0.11 m above the
      // deck, the feet just past the tail.
      root.quaternion.multiply(tmpQ.setFromAxisAngle(tmpP.set(1, 0, 0), -Math.PI / 2));
      tmpP.set(0, 0.11 * this.k, 1.12 * this.k).applyMatrix4(p.board);
      root.position.copy(tmpP);
      root.updateMatrixWorld(true);
      // Arms: paddling, each hand reaching in past the rail ahead and pulling back to the hip,
      // half a stroke apart; resting, hands on the rails beside the chest.
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        handOnPath(BOARD_HAND, p.stroke + i * 0.5, handA, palmA);
        handB.set(0.3, 0.3, -0.16);
        palmB.set(0.6, 0, -1).normalize();
        handB.lerp(handA, k);
        palmB.lerp(palmA, k);
        this.armTo(i, side, handB, palmB, SWIM_POLE);
      }
      this.blinkEyes(dt);
      return;
    }
    const drop = 0.12 + 0.18 * p.crouch;
    this.hips.position.set(0, HIP_Y - drop, 0);
    // Leaning into a left turn is leaning back (the heels), into a right turn forward (the toes).
    this.hips.rotation.set(p.lean * 0.45, 0.25, 0);
    this.torso.rotation.set(-0.3 - 0.15 * p.crouch, 0.45, 0);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.shoulders[i].rotation.set(-0.25 + 0.1 * Math.sin(this.time * 1.7 + i), 0, side * (1.15 + 0.08 * Math.sin(this.time * 1.3 + i * 2)));
      this.elbows[i].rotation.set(0.35, 0, 0);
      this.wrists[i].rotation.set(0, 0, 0);
    }
    this.head.rotation.set(0.12, 0.75, 0);
    // Sideways across the board: body −Z (its front) → board +X.
    root.quaternion.multiply(tmpQ.setFromAxisAngle(UP, -Math.PI / 2));
    root.updateMatrixWorld(true);
    // Feet on the deck, about shoulder width and a half apart: left (front) foot toward the
    // nose, right foot over the fins.
    for (let i = 0; i < 2; i++) {
      tmpD.set(0, ANKLE_H * this.k, i === 0 ? -0.33 : 0.37).applyMatrix4(p.board);
      this.reachLeg(i, tmpD, 0);
    }
    this.blinkEyes(dt);
  }

  /** Back on the feet after sitting: rest orientation for every bone (walking sets the rest). */
  private stand(): void {
    this.seated = false;
    this.group.rotation.set(0, 0, 0);
    this.hips.traverse((o) => {
      if (o instanceof THREE.Bone) o.quaternion.identity();
    });
    this.hips.position.set(0, HIP_Y, 0);
    this.head.scale.setScalar(1);
  }

  /** Faces a direction immediately (when walking starts). */
  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  /** The skeleton, for a loaded character that copies its pose. */
  get rig(): AvatarRig {
    return {
      group: this.group,
      hips: this.hips,
      torso: this.torso,
      head: this.head,
      shoulders: this.shoulders,
      elbows: this.elbows,
      wrists: this.wrists,
      hipJoints: this.hipJoints,
      knees: this.knees,
      ankles: this.ankles,
    };
  }

  /** Body scale (see `k`); 1 is the built-in body. */
  get bodyScale(): number {
    return this.k;
  }

  setBodyScale(k: number): void {
    this.k = k;
    this.group.scale.setScalar(k);
    // Re-plant the feet from scratch at the new size.
    this.rootY = Number.NaN;
    this.drop = 0;
  }

  /** Shows or hides the built-in body (its skeleton keeps moving either way). */
  setOwnBodyVisible(on: boolean): void {
    for (const m of this.ownMeshes) m.visible = on;
  }
}
