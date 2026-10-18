import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder';
import { patchWorldMaterial } from './patchMaterial';
import { createRng } from '../core/rng';
import { clamp, damp } from '../core/math';
import type { SharedUniforms } from '../core/uniforms';

/**
 * The walker's body for the third-person view: a young man dressed for the beach (Korean
 * "two-block" hair with a soft fringe, slim-fit pale linen shirt with an open collar, board
 * shorts, flip-flops, a bead bracelet), about 1.7 m tall, fair skin and a happy face.
 * Original design built in code from smooth, rounded shapes (capsule limbs, ball joints, a
 * lathe-turned torso).
 *
 * It is a tiny "skeleton" of groups (hips → torso → head/arms, hips → legs) animated in JS:
 * ~10 joint rotations per frame, nothing per vertex. Each body part is one merged,
 * vertex-colored mesh (10 draw calls).
 *
 * The model faces −Z, the same convention as the camera, so `rotation.y = yaw` turns it to
 * face along the camera's forward direction for that yaw.
 */

const C = {
  skin: '#f9dcc6',
  blush: '#f3b3a6',
  hair: '#1c1612',
  white: '#f4f4f0',
  shirt: '#d3ebef',
  shirtDark: '#b5d3db',
  shorts: '#2f5d8a',
  shortsDark: '#244a70',
  bracelet: '#6b4a32',
  sandal: '#2b2f36',
  strap: '#3f6f8f',
  eye: '#1a1614',
  mouth: '#c4655c',
} as const;

/** Legs are scaled along their length; with it the feet (0.03 + (0.41 + 0.455) × scale below
 * the hips) reach just to the ground. */
const LEG_SCALE = 0.94;
const HIP_Y = 0.03 + (0.41 + 0.455) * LEG_SCALE;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

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

const cyl = (rTop: number, rBottom: number, h: number, seg = 8): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1);
const ball = (r: number, w = 8, h = 6): THREE.BufferGeometry => new THREE.SphereGeometry(r, w, h);

/** Torso radius at height y (0 = waist … 0.455 = base of the neck), before flattening. */
function torsoRadius(y: number): number {
  const pts: Array<[number, number]> = [
    [0.0, 0.118], [0.06, 0.12], [0.15, 0.132], [0.26, 0.148], [0.33, 0.158], [0.385, 0.15], [0.425, 0.108], [0.455, 0.052],
  ];
  for (let i = 1; i < pts.length; i++) {
    const [y1, r1] = pts[i];
    const [y0, r0] = pts[i - 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * t * t * (3 - 2 * t);
    }
  }
  return pts[pts.length - 1][1];
}

/** Head ellipsoid semi-axes (sphere 0.12 scaled 0.93 × 1.06 × 1). */
const HEAD_AXES = [0.12 * 0.93, 0.12 * 1.06, 0.12] as const;

/** Z of the front of the head at (x, y): face details are placed on this surface. */
function faceZ(x: number, y: number): number {
  const [a, b, c] = HEAD_AXES;
  return -c * Math.sqrt(Math.max(0, 1 - (x / a) ** 2 - (y / b) ** 2));
}

/**
 * The fringe: the front slice of a sphere (over the forehead), whose lower edge is cut into
 * tapered strands of different lengths, so it reads as hair rather than a helmet rim.
 */
function fringeGeometry(r: number): THREE.BufferGeometry {
  const cols = 56;
  const rows = 8;
  const phi0 = Math.PI * 1.2;
  const phi1 = Math.PI * 1.8;
  const theta0 = 0.2;
  const strands = 7;
  const pos: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      // Strand tips: longest at each strand's middle, short in between; lengths vary.
      // Wide strands with narrow V-shaped gaps between them (1 in the middle, 0 at the gaps).
      const tip = 1 - Math.pow(Math.abs(Math.cos(Math.PI * strands * u)), 4);
      const len = 0.08 + 0.12 * Math.abs(Math.sin(u * 9.1 + 1.3));
      const theta1 = 1.0 + (u - 0.5) * 0.14 + tip * len;
      const theta = theta0 + (theta1 - theta0) * (j / rows);
      const phi = phi0 + (phi1 - phi0) * u;
      pos.push(-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta));
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      // Counter-clockwise seen from outside (phi grows toward the viewer's right, theta downward).
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** One horizontal slice of the torso (lathe between y0 and y1). */
function torsoBand(y0: number, y1: number): THREE.BufferGeometry {
  const steps = Math.max(2, Math.round((y1 - y0) / 0.015));
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps;
    profile.push(new THREE.Vector2(torsoRadius(y), y));
  }
  return new THREE.LatheGeometry(profile, 28);
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

export class Avatar {
  readonly group = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly hipJoints: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private yaw = 0;
  private gait = 0;
  private run = 0;
  private time = 0;

  constructor(shared: SharedUniforms) {
    // Smooth shading: the body parts are rounded shapes, not facets.
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    // Gets wet in the rain and cloud shadows like the rest of the world.
    patchWorldMaterial(material, { wet: true, porosity: 0.4 }, shared);
    const rng = createRng(77);
    const mesh = (b: GeoBuilder, parent: THREE.Object3D): void => {
      const m = new THREE.Mesh(b.build(), material);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
    };
    const builder = (): GeoBuilder => new GeoBuilder(rng, 0);

    // Hips at HIP_Y; everything above hangs off the torso, legs off the hips.
    this.hips.position.y = HIP_Y;
    this.group.add(this.hips);
    const pelvis = builder();
    // Board shorts: seat and waistband with a white drawstring.
    pelvis.add(place(ball(0.135, 18, 12), 0, -0.01, 0, 0, 0, 0, 1, 0.62, 0.72), C.shorts);
    pelvis.add(place(cyl(0.128, 0.13, 0.04, 20), 0, 0.04, 0, 0, 0, 0, 1, 1, 0.7), C.shortsDark);
    for (const s of [-1, 1]) {
      pelvis.add(place(new THREE.CapsuleGeometry(0.004, 0.05, 2, 6), s * 0.012, 0.0, -0.093, 0, 0, s * 0.2), C.white);
    }
    mesh(pelvis, this.hips);

    this.torso.position.y = 0.06;
    this.hips.add(this.torso);
    const body = builder();
    // Slim-fit linen shirt: torso turned on a lathe (broad shoulders, narrow waist), worn
    // untucked (a slightly wider hem), open collar showing the neck and collarbone.
    body.add(place(torsoBand(0.0, 0.455), 0, 0, 0, 0, 0, 0, 1, 1, 0.66), C.shirt);
    body.add(place(cyl(0.124, 0.13, 0.04, 24), 0, 0.005, 0, 0, 0, 0, 1, 1, 0.7), C.shirt);
    const front = (y: number): number => -torsoRadius(y) * 0.66;
    body.add(place(new THREE.ConeGeometry(0.05, 0.12, 3), 0, 0.38, front(0.38) + 0.004, Math.PI, Math.PI, 0, 1, 1, 0.12), C.skin);
    for (const s of [-1, 1]) {
      // Collar points laid open on the chest.
      body.add(place(new THREE.ConeGeometry(0.02, 0.065, 3), s * 0.042, 0.405, front(0.405) - 0.001, 0.1, Math.PI, -s * 0.55, 1, 1, 0.1), C.shirtDark);
    }
    // Button placket and buttons.
    body.add(place(new THREE.BoxGeometry(0.018, 0.27, 0.004), 0, 0.17, front(0.17) - 0.001), C.shirtDark);
    for (const y of [0.08, 0.17, 0.26]) body.add(place(ball(0.006, 8, 6), 0, y, front(y) - 0.004), C.white);
    // Chest pocket.
    body.add(place(new THREE.BoxGeometry(0.06, 0.06, 0.004), -0.07, 0.3, front(0.3) + 0.012, 0, 0.35, 0), C.shirtDark);
    body.add(place(cyl(0.043, 0.048, 0.1, 16), 0, 0.47, 0), C.skin);
    mesh(body, this.torso);

    this.head.position.y = 0.57;
    // A slightly large head keeps the friendly cartoon look at game-camera distance.
    this.head.scale.setScalar(1.1);
    this.torso.add(this.head);
    const head = builder();
    head.add(place(ball(0.12, 24, 18), 0, 0, 0, 0, 0, 0, 0.93, 1.06, 1), C.skin);
    for (const s of [-1, 1]) {
      head.add(place(ball(0.028, 10, 8), s * 0.112, -0.01, 0.01, 0, 0, 0, 0.5, 1, 1), C.skin);
      // Bright eyes with a highlight and a soft upper lid line (a smiling look).
      head.add(place(ball(0.018, 14, 10), s * 0.042, 0.002, -0.108, 0, 0, 0, 0.9, 1.1, 0.35), C.eye);
      head.add(place(ball(0.0055, 8, 6), s * 0.042 - 0.006, 0.01, -0.116), C.white);
      head.add(place(new THREE.TorusGeometry(0.02, 0.003, 4, 12, Math.PI), s * 0.042, 0.004, -0.109, 0, 0, 0, 1, 0.8, 1), C.eye);
      // Straight, neat brows (mostly hidden by the fringe).
      head.add(place(new THREE.CapsuleGeometry(0.0055, 0.034, 3, 8), s * 0.044, 0.04, -0.11, 0, 0, Math.PI / 2 + s * 0.06), C.hair);
      // Rosy cheeks.
      head.add(place(ball(0.02, 10, 8), s * 0.06, -0.035, faceZ(s * 0.06, -0.035) + 0.004, 0, s * 0.5, 0, 1, 0.6, 0.3), C.blush);
    }
    head.add(place(ball(0.013, 10, 8), 0, -0.024, faceZ(0, -0.024) + 0.006, 0, 0, 0, 0.8, 1.15, 0.8), C.skin);
    // Wide, happy smile: the lower half of a thin ring.
    head.add(place(new THREE.TorusGeometry(0.023, 0.0045, 6, 16, Math.PI), 0, -0.048, faceZ(0, -0.06) + 0.003, 0, 0, Math.PI, 1, 0.7, 1), C.mouth);

    // Korean-style "two-block" hair: short and close at the sides and back, a smooth full dome
    // on top lifted toward the front, and a soft fringe whose strands end in tapered tips just
    // above the brows, swept a little to one side.
    // Tilted back a lot: its front edge sits high (the fringe covers the forehead), the back
    // reaches down to the nape.
    const hairCap = new THREE.SphereGeometry(0.127, 28, 16, 0, Math.PI * 2, 0, 1.4);
    head.add(place(hairCap, 0, 0.008, 0.004, 0.65, 0, 0, 0.96, 1.02, 1.02), C.hair);
    head.add(place(ball(0.11, 24, 14), 0, 0.1, -0.02, 0.25, 0, 0.05, 0.98, 0.42, 1.0), C.hair);
    head.add(place(fringeGeometry(0.131), 0, 0.006, -0.002, 0, 0, 0.1, 0.97, 1.02, 1.03), C.hair);
    mesh(head, this.head);

    // Arms: slim and toned; short shirt sleeves, a bead bracelet on the right wrist.
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.19, 0.37, 0);
      this.torso.add(shoulder);
      const upper = builder();
      upper.add(place(ball(0.051, 16, 12), 0, 0, 0), C.shirt);
      upper.add(place(cyl(0.051, 0.047, 0.13, 16), 0, -0.065, 0), C.shirt);
      upper.add(place(cyl(0.049, 0.049, 0.014, 16), 0, -0.128, 0), C.shirtDark);
      upper.add(place(new THREE.CapsuleGeometry(0.037, 0.15, 6, 14), 0, -0.175, 0), C.skin);
      mesh(upper, shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -0.27;
      shoulder.add(elbow);
      const fore = builder();
      fore.add(place(new THREE.CapsuleGeometry(0.034, 0.16, 6, 14), 0, -0.09, 0), C.skin);
      fore.add(place(ball(0.04, 14, 10), 0, -0.235, -0.005, 0, 0, 0, 0.75, 1.2, 0.95), C.skin);
      fore.add(place(new THREE.CapsuleGeometry(0.012, 0.03, 4, 8), -s * 0.025, -0.225, -0.02, 0.3, 0, s * 0.5), C.skin);
      if (s > 0) fore.add(place(new THREE.TorusGeometry(0.036, 0.007, 6, 16), 0, -0.19, 0, Math.PI / 2, 0, 0), C.bracelet);
      mesh(fore, elbow);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
    }

    // Legs: board shorts to the knee (white side stripe), bare slim calves, flip-flops.
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.08, -0.03, 0);
      hip.scale.set(1, LEG_SCALE, 1);
      this.hips.add(hip);
      const thigh = builder();
      thigh.add(place(ball(0.08, 16, 12), 0, 0, 0), C.shorts);
      thigh.add(place(cyl(0.08, 0.077, 0.4, 18), 0, -0.2, 0), C.shorts);
      thigh.add(place(cyl(0.079, 0.079, 0.025, 18), 0, -0.395, 0), C.shortsDark);
      thigh.add(place(new THREE.BoxGeometry(0.004, 0.36, 0.03), s * 0.079, -0.2, 0), C.white);
      mesh(thigh, hip);
      const knee = new THREE.Group();
      knee.position.y = -0.41;
      hip.add(knee);
      const shin = builder();
      shin.add(place(ball(0.047, 14, 10), 0, 0.005, 0), C.skin);
      shin.add(place(cyl(0.047, 0.034, 0.37, 16), 0, -0.185, 0), C.skin);
      shin.add(place(ball(0.036, 12, 10), 0, -0.375, 0), C.skin);
      // Bare foot on a flip-flop, pointing forward (−Z); sole bottom at about −0.455.
      shin.add(place(ball(0.04, 14, 10), 0, -0.42, -0.04, 0, 0, 0, 1.0, 0.65, 2.3), C.skin);
      shin.add(place(cyl(1, 1, 1, 20), 0, -0.448, -0.04, 0, 0, 0, 0.05, 0.014, 0.125), C.sandal);
      for (const k of [-1, 1]) {
        shin.add(place(new THREE.CapsuleGeometry(0.005, 0.06, 3, 6), k * 0.022, -0.418, -0.075, 0.9, 0, -k * 0.6), C.strap);
      }
      mesh(shin, knee);
      this.hipJoints.push(hip);
      this.knees.push(knee);
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
    hl.rotation.x = swing;
    hr.rotation.x = -swing;
    // The knee bends while that leg swings forward.
    kl.rotation.x = -(0.05 + g * (0.5 + 0.6 * r) * Math.max(0, -lift));
    kr.rotation.x = -(0.05 + g * (0.5 + 0.6 * r) * Math.max(0, lift));

    // Arms swing opposite to the legs; elbows bend more when running.
    const breathe = Math.sin(this.time * 1.8);
    const [sl, sr] = this.shoulders;
    const [el, er] = this.elbows;
    sl.rotation.x = -swing * 0.8;
    sr.rotation.x = swing * 0.8;
    sl.rotation.z = -0.08 - 0.02 * breathe * (1 - g);
    sr.rotation.z = 0.08 + 0.02 * breathe * (1 - g);
    el.rotation.x = er.rotation.x = 0.3 + 0.9 * r;

    // Body: bob (lowest at each footfall), lean forward when running, breathing at rest.
    this.hips.position.y = HIP_Y + 0.035 * g * Math.abs(lift) - 0.03 * r;
    this.torso.rotation.x = -0.18 * r - 0.03 * g;
    this.torso.scale.y = 1 + 0.008 * breathe * (1 - g);
    this.head.rotation.x = 0.12 * r;

    this.group.position.set(p.x, p.feetY, p.z);
    this.group.rotation.y = this.yaw;
  }

  /** Faces a direction immediately (when walking starts). */
  setYaw(yaw: number): void {
    this.yaw = yaw;
  }
}
