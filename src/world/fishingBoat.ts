import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder';
import { createRng, type Rng } from '../core/rng';
import { sampleWaves, waveAttenuation, type WaveSample } from '../water/gerstner';
import type { Placement } from './layout';
import { BoatLights, type BoatLamp } from './boatLights';
import type { SharedUniforms } from '../core/uniforms';

/**
 * A Vietnamese wooden fishing boat (after the user's photo): blue hull with a red bottom and a
 * high, upswept bow, a white-and-blue two-deck cabin aft, white masts flying the red flag with
 * the yellow star, and a line of coloured pennants between them. About 20 m long; bow at +X,
 * origin at the waterline. Built from vertex-coloured parts: two draw calls (hull + parts) plus
 * the flags and the foam.
 */
const L = 20;
const BEAM = 2.6; // half width at the widest point
const C = {
  bottom: '#b3262a',
  hull: '#1f5fc4',
  rail: '#d9dad5',
  white: '#f4f4f0',
  cabinBlue: '#2f86d8',
  window: '#24323c',
  deck: '#9a8f80',
  mast: '#f2f2ee',
  flagRed: '#da251d',
  flagStar: '#ffde00',
} as const;
const PENNANTS = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#ffffff', '#ec407a', '#fb8c00'] as const;

/** Deck edge height above the waterline along the hull (t = 0 stern … 1 bow): sweeps up at the bow. */
const sheer = (t: number): number => 1.5 + 0.2 * t + 1.6 * Math.pow(Math.max(0, t - 0.55) / 0.45, 2.2);

function hullGeometry(): THREE.BufferGeometry {
  const sections = 60;
  const around = 24;
  const pos: number[] = [];
  const index: number[] = [];
  const red = new THREE.Color(C.bottom);
  const blue = new THREE.Color(C.hull);
  const rail = new THREE.Color(C.rail);
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const x = -L / 2 + t * L;
    // Half-width: a broad transom at the stern, fullest a little aft of the middle, a fine bow.
    const w = BEAM * (t < 0.45 ? 0.82 + 0.18 * Math.sin((t / 0.45) * Math.PI * 0.5) : Math.pow(Math.cos(((t - 0.45) / 0.55) * Math.PI * 0.5), 0.75));
    const top = sheer(t);
    const keel = -1.25 * (t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15 * 0.7);
    for (let j = 0; j <= around; j++) {
      // Port deck edge → keel → starboard deck edge, with rings packed near the deck edges so
      // the top row of quads is a thin rail band.
      const u = 0.5 - 0.5 * Math.cos((j / around) * Math.PI);
      const a = -Math.PI / 2 + u * Math.PI;
      const s = Math.sin(a);
      const c = Math.cos(a);
      // Rounded bilge: flatter sides near the top, a V toward the keel.
      const y = top - (top - keel) * Math.pow(c, 0.7);
      const z = w * s * (0.35 + 0.65 * Math.pow(Math.abs(s), 0.25));
      // The stem rakes forward toward its top.
      const rake = Math.pow(t, 6) * 2.2 * ((y - keel) / (top - keel));
      pos.push(x + rake, y, z);
    }
  }
  // One colour per quad (both its triangles), so the paint has clean bands: the top row of
  // quads on each side is the pale rail, then blue sides, red below the boot line.
  const triColor: THREE.Color[] = [];
  for (let i = 0; i < sections; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
      const y = (pos[a * 3 + 1] + pos[(a + 1) * 3 + 1] + pos[b * 3 + 1] + pos[(b + 1) * 3 + 1]) / 4;
      const k = j === 0 || j === around - 1 ? rail : y < 0.55 ? red : blue;
      triColor.push(k, k);
    }
  }
  // Transom: fan across the stern section.
  const center = pos.length / 3;
  pos.push(-L / 2, 0.6, 0);
  for (let j = 0; j < around; j++) {
    index.push(center, j + 1, j);
    triColor.push(j === 0 || j === around - 1 ? rail : blue);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  g.dispose();
  // toNonIndexed keeps the triangle order, so triangle n gets triColor[n].
  const col = new Float32Array(triColor.length * 9);
  triColor.forEach((k, n) => {
    for (let v = 0; v < 3; v++) col.set([k.r, k.g, k.b], (n * 3 + v) * 3);
  });
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.computeVertexNormals();
  return flat;
}

/** Five-pointed star in the XY plane, centred at the origin. */
function starShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.382;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return s;
}

/**
 * The national flag (2:3), hanging from a pole top at (x, y, z) and streaming toward −X (the
 * boat's wake side). Star on both faces.
 */
function flag(b: GeoBuilder, x: number, y: number, z: number, h: number): void {
  const w = h * 1.5;
  const cloth = new THREE.PlaneGeometry(w, h);
  cloth.translate(x - w / 2, y - h / 2, z);
  b.add(cloth, C.flagRed);
  for (const side of [-1, 1]) {
    const star = new THREE.ShapeGeometry(starShape(h * 0.3));
    if (side < 0) star.rotateY(Math.PI);
    star.translate(x - w / 2, y - h / 2, z + side * 0.012);
    b.add(star, C.flagStar);
  }
}

/** Cabin (lower deckhouse) and wheelhouse centres along the boat. */
const CABIN_X = -L / 2 + 4.6;
const WHEEL_X = CABIN_X + 0.8;
const BOW_MAST_X = L / 2 - 4.2;
/** Squid-fishing lamps: two lines of bulbs over the foredeck, hung under white pipe rails. */
const LAMP_RAIL = { x0: -1.2, x1: 6.2, z: 1.15, y: 4.25, bulbs: 8 } as const;
/** Lamp colours: metal-halide fishing lamps, navigation lights, warm cabin light. */
const LIGHT = { squid: '#eafff4', mast: '#fff1d6', port: '#ff2a1c', starboard: '#22ff66', cabin: '#ffbf6e' } as const;

/**
 * The boat's lamps (boat-local; bow at +X, starboard = +Z): two lines of squid-fishing bulbs, a
 * white masthead light, red (port) and green (starboard) sidelights on the wheelhouse, a white
 * stern light.
 */
function boatLamps(): BoatLamp[] {
  const lamps: BoatLamp[] = [];
  const r = LAMP_RAIL;
  for (const z of [-r.z, r.z]) {
    for (let i = 0; i < r.bulbs; i++) {
      const x = r.x0 + ((i + 0.5) / r.bulbs) * (r.x1 - r.x0);
      // Every other bulb throws a reflection (they overlap anyway): fewer, brighter streaks.
      // Halo smaller than the bulb spacing (~0.9 m), so each bulb still reads as its own light.
      lamps.push({ x, y: r.y - 0.28, z, color: LIGHT.squid, halo: 0.55, streak: i % 2 === 0 ? 0.6 : 0 });
    }
  }
  lamps.push({ x: BOW_MAST_X, y: 9.1, z: 0, color: LIGHT.mast, halo: 0.9, streak: 0.5 });
  lamps.push({ x: WHEEL_X + 0.6, y: 5.45, z: -1.68, color: LIGHT.port, halo: 0.75, streak: 0.6 });
  lamps.push({ x: WHEEL_X + 0.6, y: 5.45, z: 1.68, color: LIGHT.starboard, halo: 0.75, streak: 0.6 });
  lamps.push({ x: -L / 2 + 0.3, y: 2.9, z: 0, color: LIGHT.mast, halo: 0.6, streak: 0.35 });
  return lamps;
}

/** Glowing panes laid just outside the cabin and wheelhouse windows (lit colour). */
function windowGlow(rng: Rng): THREE.BufferGeometry {
  const b = new GeoBuilder(rng, 0.12);
  const cx = CABIN_X;
  for (const z of [-2.03, 2.03]) {
    for (const wx of [-0.3, 1.0, 2.3]) b.box(0.86, 0.5, 0.01, cx + wx, 2.9, z, LIGHT.cabin);
  }
  b.box(0.01, 0.56, 2.56, WHEEL_X + 1.83, 5.15, 0, LIGHT.cabin);
  for (const z of [-1.63, 1.63]) b.box(2.56, 0.5, 0.01, WHEEL_X, 5.15, z, LIGHT.cabin);
  return b.build();
}

function buildParts(rng: Rng): { solid: THREE.BufferGeometry; cloth: THREE.BufferGeometry } {
  const b = new GeoBuilder(rng, 0.03);
  const cloth = new GeoBuilder(rng, 0.02);
  // Deck (mostly hidden behind the bulwarks).
  b.box(L * 0.82, 0.1, BEAM * 1.7, -0.6, 1.45, 0, C.deck);
  // Cabin, aft: lower deckhouse, an upper deck with railings, the wheelhouse on top.
  const cx = CABIN_X;
  b.box(6.4, 2.2, 4.0, cx, 2.6, 0, C.white);
  b.box(6.5, 0.35, 4.1, cx, 1.65, 0, C.cabinBlue);
  for (const z of [-2.01, 2.01]) {
    for (const wx of [-0.3, 1.0, 2.3]) b.box(0.9, 0.55, 0.03, cx + wx, 2.9, z, C.window);
    b.box(0.7, 1.5, 0.03, cx - 2.0, 2.45, z * 1.001, C.window); // door
  }
  // Lamp rails over the foredeck: a white pipe on three posts each side, bulbs hang under it.
  const r = LAMP_RAIL;
  for (const z of [-r.z, r.z]) {
    b.box(r.x1 - r.x0 + 0.3, 0.07, 0.07, (r.x0 + r.x1) / 2, r.y, z, C.mast);
    for (const px of [r.x0, (r.x0 + r.x1) / 2, r.x1]) {
      const base = sheer((px + L / 2) / L) - 0.15;
      b.box(0.07, r.y - base, 0.07, px, (r.y + base) / 2, z, C.mast);
    }
    for (let i = 0; i < r.bulbs; i++) {
      // Short drop from the rail to each bulb's socket.
      const x = r.x0 + ((i + 0.5) / r.bulbs) * (r.x1 - r.x0);
      b.box(0.03, 0.18, 0.03, x, r.y - 0.12, z, '#3a3a3a');
    }
  }
  // Side and stern light housings.
  for (const z of [-1.66, 1.66]) b.box(0.25, 0.25, 0.08, WHEEL_X + 0.6, 5.45, z, '#2a2a2a');
  b.box(7.0, 0.18, 4.4, cx, 3.78, 0, C.cabinBlue); // upper deck slab
  // Railings round the upper deck.
  for (const z of [-2.15, 2.15]) {
    b.box(6.9, 0.05, 0.05, cx, 4.65, z, C.white);
    b.box(6.9, 0.04, 0.04, cx, 4.25, z, C.white);
    for (let k = 0; k <= 8; k++) b.box(0.05, 0.85, 0.05, cx - 3.45 + (k * 6.9) / 8, 4.25, z, C.white);
  }
  // Wheelhouse with a band of windows and a blue roof.
  const wx = WHEEL_X;
  b.box(3.6, 1.9, 3.2, wx, 4.82, 0, C.white);
  b.box(0.03, 0.6, 2.6, wx + 1.81, 5.15, 0, C.window);
  for (const z of [-1.61, 1.61]) b.box(2.6, 0.55, 0.03, wx, 5.15, z, C.window);
  b.box(4.2, 0.15, 3.8, wx, 5.85, 0, C.cabinBlue);
  // Radar/antenna frame on the wheelhouse roof (also the aft flag mast).
  const aftMast = { x: wx - 0.6, top: 8.6 };
  for (const z of [-0.6, 0.6]) b.box(0.08, aftMast.top - 5.9, 0.08, aftMast.x, (aftMast.top + 5.9) / 2, z, C.mast, z * 0.18);
  b.box(0.08, 0.08, 1.6, aftMast.x, 7.4, 0, C.mast);
  // Bow mast: a tall white pole leaning slightly forward.
  const bowMast = { x: BOW_MAST_X, base: sheer(0.79) - 0.2, top: 10.5 };
  const mastH = bowMast.top - bowMast.base;
  b.add(cylinder(0.11, 0.07, mastH, bowMast.x, bowMast.base + mastH / 2, 0), C.mast);
  b.box(0.5, 0.12, 0.12, bowMast.x, bowMast.base + mastH * 0.62, 0, C.mast);
  // Gunwale rail on the cabin roof edge and a few deck fittings forward.
  b.box(1.0, 0.5, 1.2, L / 2 - 7.5, 1.8, 0, C.white);
  b.box(0.6, 0.4, 0.6, L / 2 - 2.2, sheer(0.89) - 0.1, 0, C.cabinBlue);
  // Flags (big enough to read from the desk, ~150 m away).
  flag(cloth, bowMast.x, bowMast.top, 0, 1.3);
  flag(cloth, aftMast.x, aftMast.top, 0, 1.1);
  // Pennant line from the bow mast top down to the aft mast top: a sagging string of triangles.
  const p0 = new THREE.Vector3(bowMast.x, bowMast.top - 0.15, 0);
  const p1 = new THREE.Vector3(aftMast.x, aftMast.top - 0.1, 0);
  const n = 30;
  const at = (t: number): THREE.Vector3 => new THREE.Vector3().lerpVectors(p0, p1, t).add(new THREE.Vector3(0, -1.2 * 4 * t * (1 - t), 0));
  for (let i = 0; i < n; i++) {
    const a = at(i / n);
    const c = at((i + 1) / n);
    const len = a.distanceTo(c);
    const mid = a.clone().add(c).multiplyScalar(0.5);
    b.box(len, 0.02, 0.02, mid.x, mid.y, 0, '#3a3a3a', 0, 0, Math.atan2(c.y - a.y, c.x - a.x));
    // Pennant: a small triangle hanging from the line.
    const tri = new THREE.BufferGeometry();
    const w = len * 0.42;
    tri.setAttribute('position', new THREE.Float32BufferAttribute([mid.x - w, mid.y, 0, mid.x + w, mid.y, 0, mid.x, mid.y - 0.42, 0], 3));
    tri.computeVertexNormals();
    cloth.add(tri, PENNANTS[i % PENNANTS.length]);
  }
  return { solid: b.build(), cloth: cloth.build() };
}

function cylinder(rTop: number, rBottom: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, 8);
  g.translate(x, y, z);
  return g;
}

/** Bow wave and a short white wake, lying on the water around the hull. */
function foamGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number): void => {
    pos.push(ax, 0, az, cx, 0, cz, bx, 0, bz);
  };
  for (const s of [-1, 1]) {
    // Bow wave: a white sliver curling off each side of the stem.
    tri(L / 2 - 0.4, 0, L / 2 - 6, s * 2.9, L / 2 - 4.5, s * 1.6);
    tri(L / 2 - 6, s * 2.9, L / 2 - 9, s * 3.4, L / 2 - 4.5, s * 1.6);
    // Wake: a widening V trailing behind the transom.
    tri(-L / 2 + 0.5, s * 1.8, -L / 2 - 9, s * 4.5, -L / 2 - 2, 0);
  }
  tri(-L / 2 + 0.5, -1.8, -L / 2 + 0.5, 1.8, -L / 2 - 6, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The boat, and its night lights (a child of the boat; see BoatLights). */
export function createFishingBoat(seed: number, shared: SharedUniforms): { group: THREE.Group; lights: BoatLights } {
  const rng = createRng(seed);
  const group = new THREE.Group();
  group.name = 'fishing-boat';
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, roughness: 0.6 });
  const parts = buildParts(rng);
  const hull = new THREE.Mesh(hullGeometry(), solidMat);
  const body = new THREE.Mesh(parts.solid, solidMat);
  const flags = new THREE.Mesh(parts.cloth, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
  const foam = new THREE.Mesh(
    foamGeometry(),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
  );
  foam.position.y = 0.06;
  foam.renderOrder = 2;
  for (const m of [hull, body, flags]) m.castShadow = true;
  group.add(hull, body, flags, foam);
  // Own RNG stream, so adding the lights doesn't change the boat's other parts.
  const lights = new BoatLights(
    boatLamps(),
    windowGlow(createRng(seed + 101)),
    // The pool under the fishing lamps, toward the bow.
    { x: (LAMP_RAIL.x0 + LAMP_RAIL.x1) / 2, z: 0, radius: 13, color: '#bff5e6' },
    shared,
  );
  group.add(lights.group);
  return { group, lights };
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The boat's trip: a slow loop out at sea in front of the house (house-local ellipse), heading
 * along the path, riding the same waves as the sea shader (CPU twin), pitching and rolling.
 */
export class FishingTrip {
  private angle = Math.PI * 0.35;
  private readonly sample: WaveSample = { height: 0, dhdx: 0, dhdz: 0 };
  private readonly normal = new THREE.Vector3();
  private readonly tilt = new THREE.Quaternion();
  private readonly yawQ = new THREE.Quaternion();
  private readonly target = new THREE.Quaternion();
  private readonly cos: number;
  private readonly sin: number;
  private first = true;

  constructor(
    readonly object: THREE.Object3D,
    private readonly house: Placement,
    /** Loop center and radii, house-local (+Z = out to sea from the glass wall). */
    private readonly center: { x: number; z: number },
    private readonly radii: { x: number; z: number },
    /** Cruising speed, m/s. */
    private readonly speed = 2.2,
  ) {
    this.cos = Math.cos(house.rotY);
    this.sin = Math.sin(house.rotY);
  }

  private toWorld(lx: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.house.x + lx * this.cos + lz * this.sin, out.y, this.house.z - lx * this.sin + lz * this.cos);
  }

  update(time: number, waveStrength: number, camera: THREE.Camera, dt: number): void {
    const { x: ax, z: az } = this.radii;
    // Advance by arc length so the speed stays even around the ellipse.
    const dl = Math.hypot(ax * Math.sin(this.angle), az * Math.cos(this.angle)) || 1;
    this.angle = (this.angle + (this.speed * Math.min(dt, 0.1)) / dl) % (Math.PI * 2);
    const o = this.object;
    const lx = this.center.x + ax * Math.cos(this.angle);
    const lz = this.center.z + az * Math.sin(this.angle);
    this.toWorld(lx, lz, o.position);
    // Heading: the ellipse tangent, from house-local to world.
    const tlx = -ax * Math.sin(this.angle);
    const tlz = az * Math.cos(this.angle);
    const tx = tlx * this.cos + tlz * this.sin;
    const tz = -tlx * this.sin + tlz * this.cos;
    this.yawQ.setFromAxisAngle(UP, Math.atan2(-tz, tx));
    const dist = Math.hypot(o.position.x - camera.position.x, o.position.z - camera.position.z);
    const s = sampleWaves(o.position.x, o.position.z, time, waveAttenuation(waveStrength, 30, dist), dist, this.sample);
    // A big boat: it follows the waves loosely and tilts only a little.
    this.normal.set(-s.dhdx * 0.5, 1, -s.dhdz * 0.5).normalize();
    this.tilt.setFromUnitVectors(UP, this.normal);
    this.target.multiplyQuaternions(this.tilt, this.yawQ);
    if (this.first) {
      o.position.y = s.height;
      o.quaternion.copy(this.target);
      this.first = false;
      return;
    }
    o.position.y += (s.height - o.position.y) * (1 - Math.exp(-2 * dt));
    o.quaternion.slerp(this.target, 1 - Math.exp(-2 * dt));
  }
}
