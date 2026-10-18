import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder';
import { patchWorldMaterial } from './patchMaterial';
import { createRng } from '../core/rng';
import { clamp, damp } from '../core/math';
import type { SharedUniforms } from '../core/uniforms';

/**
 * The walker's body for the third-person view: a low-poly young explorer (red cap, dark vest
 * with a yellow band over a white T-shirt, green backpack, fingerless gloves, baggy blue jeans,
 * red-and-black sneakers), about 1.6 m tall. Original design built from primitives in code.
 *
 * It is a tiny "skeleton" of groups (hips → torso → head/arms, hips → legs) animated in JS:
 * ~10 joint rotations per frame, nothing per vertex. Each body part is one merged,
 * vertex-colored mesh (10 draw calls, ~3k triangles).
 *
 * The model faces −Z, the same convention as the camera, so `rotation.y = yaw` turns it to
 * face along the camera's forward direction for that yaw.
 */

const C = {
  skin: '#f2c49b',
  hair: '#1d1f26',
  cap: '#d23a2e',
  capFront: '#26303f',
  badge: '#f2f2ea',
  vest: '#2f4153',
  band: '#f2b632',
  hem: '#a9d2ec',
  shirt: '#f4f4f0',
  pack: '#5cae3c',
  packDark: '#3f8a2a',
  glove: '#2b2b2e',
  wrist: '#b8e06a',
  jeans: '#5b9fd6',
  jeansDark: '#4a87bb',
  shoe: '#d93b30',
  shoeTop: '#2a3240',
  sole: '#f1f1ee',
  eye: '#15161a',
  mouth: '#9b3b3b',
} as const;

/** Hip height: the legs (0.03 + (0.41 + 0.47) × 0.92 scale) reach just to the ground. */
const HIP_Y = 0.84;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

/** Moves/rotates/scales a fresh geometry (low segment counts keep the faceted look). */
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
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 });
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
    pelvis.add(place(cyl(0.15, 0.14, 0.14), 0, 0, 0, 0, 0, 0, 1, 1, 0.72), C.jeans);
    mesh(pelvis, this.hips);

    this.torso.position.y = 0.06;
    this.hips.add(this.torso);
    const body = builder();
    // Vest over the T-shirt: a slightly flattened cylinder, light-blue hem, yellow band.
    body.add(place(cyl(0.165, 0.155, 0.4), 0, 0.2, 0, 0, 0, 0, 1, 1, 0.68), C.vest);
    body.add(place(cyl(0.162, 0.158, 0.05), 0, 0.02, 0, 0, 0, 0, 1.03, 1, 0.72), C.hem);
    body.add(place(cyl(0.169, 0.166, 0.07), 0, 0.25, 0, 0, 0, 0, 1.01, 1, 0.7), C.band);
    // Open collar: white shirt V and light-blue collar points.
    body.add(place(new THREE.ConeGeometry(0.06, 0.12, 4), 0, 0.34, -0.1, Math.PI, 0, 0, 1, 1, 0.3), C.shirt);
    for (const s of [-1, 1]) {
      body.add(place(new THREE.ConeGeometry(0.035, 0.09, 4), s * 0.06, 0.4, -0.085, 0.3, 0, -s * 0.5, 1, 1, 0.4), C.hem);
      // Backpack straps over the shoulders.
      body.add(place(new THREE.BoxGeometry(0.035, 0.3, 0.02), s * 0.1, 0.25, -0.11, 0.05, 0, 0), C.pack);
    }
    // Backpack.
    body.add(place(new THREE.BoxGeometry(0.28, 0.32, 0.13), 0, 0.22, 0.17), C.pack);
    body.add(place(new THREE.BoxGeometry(0.22, 0.12, 0.05), 0, 0.12, 0.25), C.packDark);
    body.add(place(new THREE.BoxGeometry(0.29, 0.04, 0.14), 0, 0.38, 0.17), C.packDark);
    // Neck.
    body.add(place(cyl(0.045, 0.05, 0.08, 6), 0, 0.43, 0), C.skin);
    mesh(body, this.torso);

    this.head.position.y = 0.57;
    // A slightly oversized head reads as a cartoon character at game-camera distance.
    this.head.scale.setScalar(1.2);
    this.torso.add(this.head);
    const head = builder();
    head.add(place(ball(0.12, 10, 8), 0, 0, 0, 0, 0, 0, 0.95, 1.05, 1), C.skin);
    for (const s of [-1, 1]) {
      head.add(place(ball(0.03, 6, 4), s * 0.115, -0.01, 0.01, 0, 0, 0, 0.5, 1, 1), C.skin);
      // Big anime eyes with a white highlight.
      head.add(place(ball(0.026, 8, 6), s * 0.045, 0.005, -0.108, 0, 0, 0, 0.8, 1.35, 0.35), C.eye);
      head.add(place(ball(0.008, 6, 4), s * 0.045 - 0.008, 0.02, -0.118), C.badge);
      // Eyebrows.
      head.add(place(new THREE.BoxGeometry(0.045, 0.01, 0.01), s * 0.047, 0.055, -0.108, 0, 0, s * 0.25), C.hair);
    }
    head.add(place(ball(0.02, 6, 4), 0, -0.065, -0.105, 0, 0, 0, 1.3, 0.7, 0.4), C.mouth);
    // Spiky hair poking out under the cap, mostly at the sides and back.
    for (let i = 0; i < 9; i++) {
      // Around the back (+Z) from one side to the other; outward direction (sin a, cos a).
      const a = -Math.PI * 0.65 + (i / 8) * Math.PI * 1.3;
      const len = 0.1 + rng() * 0.05;
      const g = place(new THREE.ConeGeometry(0.035, len, 4), 0, len / 2, 0);
      tmpE.set(Math.PI / 2 - 0.35, 0, 0);
      g.applyMatrix4(tmpM.makeRotationFromEuler(tmpE));
      g.applyMatrix4(tmpM.makeRotationY(a));
      g.translate(Math.sin(a) * 0.1, 0.02 + rng() * 0.03, Math.cos(a) * 0.1);
      head.add(g, C.hair);
    }
    // Cap: red crown, dark front panel with a plain white badge (no logo), red brim.
    head.add(place(new THREE.SphereGeometry(0.128, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.035, 0, 0, 0, 0, 1, 0.85, 1.02), C.cap);
    head.add(
      place(new THREE.SphereGeometry(0.131, 6, 4, Math.PI * 1.25, Math.PI * 0.5, 0.15, Math.PI / 2 - 0.25), 0, 0.035, 0, 0, 0, 0, 1, 0.85, 1.02),
      C.capFront,
    );
    head.add(place(cyl(0.022, 0.022, 0.01, 8), 0, 0.105, -0.105, Math.PI / 2 - 0.55, 0, 0), C.badge);
    head.add(place(cyl(0.1, 0.1, 0.014, 10), 0, 0.045, -0.13, 0.12, 0, 0, 0.95, 1, 0.75), C.cap);
    mesh(head, this.head);

    // Arms: shoulder → upper arm (short white sleeve), elbow → forearm, wristband, glove.
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.205, 0.37, 0);
      this.torso.add(shoulder);
      const upper = builder();
      upper.add(place(cyl(0.062, 0.058, 0.12, 8), 0, -0.04, 0), C.shirt);
      upper.add(place(cyl(0.044, 0.041, 0.2), 0, -0.17, 0), C.skin);
      mesh(upper, shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -0.27;
      shoulder.add(elbow);
      const fore = builder();
      fore.add(place(cyl(0.041, 0.036, 0.2), 0, -0.1, 0), C.skin);
      fore.add(place(cyl(0.046, 0.046, 0.045), 0, -0.18, 0), C.wrist);
      fore.add(place(ball(0.05, 7, 5), 0, -0.25, -0.005, 0, 0, 0, 0.9, 1, 1), C.glove);
      fore.add(place(new THREE.BoxGeometry(0.07, 0.035, 0.03), 0, -0.27, -0.04), C.skin);
      mesh(fore, elbow);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
    }

    // Legs: hip → thigh (baggy jeans), knee → shin with cargo pocket, sneaker.
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.085, -0.03, 0);
      // Shorter, baggier legs (and slightly chunkier sneakers) for cartoon proportions.
      hip.scale.set(1.15, 0.92, 1.12);
      this.hips.add(hip);
      const thigh = builder();
      thigh.add(place(cyl(0.085, 0.078, 0.42), 0, -0.2, 0), C.jeans);
      thigh.add(place(new THREE.BoxGeometry(0.02, 0.1, 0.08), s * 0.085, -0.22, 0), C.jeansDark);
      mesh(thigh, hip);
      const knee = new THREE.Group();
      knee.position.y = -0.41;
      hip.add(knee);
      const shin = builder();
      shin.add(place(cyl(0.078, 0.082, 0.38), 0, -0.19, 0), C.jeans);
      shin.add(place(cyl(0.083, 0.083, 0.03), 0, -0.36, 0), C.jeansDark);
      // Sneaker: red body, dark top, white sole; points forward (−Z).
      shin.add(place(new THREE.BoxGeometry(0.11, 0.05, 0.25), 0, -0.43, -0.04), C.shoe);
      shin.add(place(new THREE.BoxGeometry(0.1, 0.045, 0.16), 0, -0.39, -0.0), C.shoeTop);
      shin.add(place(new THREE.BoxGeometry(0.115, 0.02, 0.26), 0, -0.46, -0.04), C.sole);
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
