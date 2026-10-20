import * as THREE from 'three';
import type { Heightmap } from './heightmap';
import type { HammockLayout, Placement } from './layout';

/** Rope height on the trunks above the ground (m). */
const TIE_HEIGHT = 1.75;
/** Rope from the trunk down to where the cloth is gathered (along the span, and down). */
const ROPE_RUN = 0.7;
const ROPE_DROP = 0.32;
/** Cloth: widest across the middle, how far its middle sags, how deep it cradles across. */
const CLOTH_WIDTH = 1.25;
const CLOTH_SAG = 0.62;
const CLOTH_CRADLE = 0.2;
/** Natural swing period (s) and amplitudes (rad): calm, per unit of wind, with someone in it. */
const SWING_PERIOD = 2.7;
const SWING_CALM = 0.025;
const SWING_WIND = 0.06;
const SWING_OCCUPIED = 0.05;

/** Woven stripes along the cloth (cream with bands of colour), like a Yucatán hammock. */
const STRIPES = ['#efe3c8', '#c8432f', '#efe3c8', '#e8a33a', '#2f7f8f', '#efe3c8', '#7a4f9a', '#e8a33a', '#efe3c8'].map(
  (h) => new THREE.Color(h),
);

/**
 * A striped cotton hammock slung between the two palms of `layout.hammock`. The cloth and the
 * ropes to the trunks swing as one piece around the line between the two ties (a pendulum),
 * gently in calm air, more in wind and with someone lying in it. The knots on the trunks stay.
 */
export class Hammock {
  readonly group = new THREE.Group();
  /** The swinging part (cloth, ropes); its local +X runs from palm A to palm B. */
  private readonly swing = new THREE.Group();
  private amp = SWING_CALM;
  private phase = 0;
  /** Eyes of someone lying in it, in the swinging frame. */
  private readonly eyeLocal = new THREE.Vector3();
  /** Horizontal direction from palm A to palm B (head → feet of someone lying in it). */
  readonly dir: { x: number; z: number };
  /** Center between the palms on the ground; the cloth's lowest point (world y). */
  readonly center: { x: number; z: number };
  readonly lowestY: number;
  /** Collision circles along the cloth (so you walk round it, not through it). */
  readonly circles: Array<{ x: number; z: number; r: number }>;

  /**
   * `trunkAt(palm, y)`: the trunk's center and radius `y` m above the palm's foot (trunks curve,
   * see fixedPalmTrunkAt), so the ropes go round them.
   */
  constructor(
    hm: Heightmap,
    layout: HammockLayout,
    trunkAt: (palm: Placement, y: number) => { x: number; z: number; r: number },
    material: THREE.Material,
  ) {
    this.group.name = 'hammock';
    const [pa, pb] = layout.palms;
    const ta = trunkAt(pa, TIE_HEIGHT);
    const tb = trunkAt(pb, TIE_HEIGHT);
    const a = new THREE.Vector3(ta.x, hm.heightAt(pa.x, pa.z) + TIE_HEIGHT, ta.z);
    const b = new THREE.Vector3(tb.x, hm.heightAt(pb.x, pb.z) + TIE_HEIGHT, tb.z);
    const trunkR = (ta.r + tb.r) / 2;
    const ab = new THREE.Vector3().subVectors(b, a);
    const span = ab.length();
    const half = span / 2;
    // Swing frame: origin between the ties, +X toward B (tilted if the ground slopes).
    this.swing.position.copy(a).add(b).multiplyScalar(0.5);
    this.swing.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), ab.clone().normalize());
    const hl = Math.hypot(ab.x, ab.z) || 1;
    this.dir = { x: ab.x / hl, z: ab.z / hl };
    this.group.add(this.swing);
    this.center = { x: layout.x, z: layout.z };

    const geos: THREE.BufferGeometry[] = [];
    const gather = half - ROPE_RUN;
    geos.push(cloth(gather), fringe(gather));
    // Ropes: tie → gather point, a few strands fanning slightly apart.
    for (const side of [-1, 1]) {
      const tie = new THREE.Vector3(side * (half - trunkR), 0, 0);
      const knot = new THREE.Vector3(side * gather, -ROPE_DROP, 0);
      for (let k = -1; k <= 1; k++) {
        geos.push(rope(tie, knot.clone().add(new THREE.Vector3(0, 0, k * 0.05)), 0.012, '#d9c9a3'));
      }
    }
    const swingMesh = new THREE.Mesh(merge(geos), material);
    swingMesh.castShadow = true;
    swingMesh.receiveShadow = true;
    this.swing.add(swingMesh);

    // The rope wound round each trunk (doesn't swing).
    for (const [p, t] of [[a, ta], [b, tb]] as const) {
      const ring = new THREE.TorusGeometry(t.r + 0.025, 0.03, 6, 18).rotateX(Math.PI / 2);
      const ring2 = ring.clone().translate(0, 0.07, 0);
      const m = new THREE.Mesh(merge([colorize(ring, '#cbb88f'), colorize(ring2, '#cbb88f')]), material);
      m.position.copy(p);
      m.castShadow = true;
      this.group.add(m);
    }

    // Lying with the head toward palm A: eyes a little above the cloth, a third of the way in.
    const u = 0.3;
    // Head propped up on the gathered cloth, so the view clears your own hammock.
    this.eyeLocal.set(-gather + 2 * gather * u, clothY(u, 0) - ROPE_DROP + 0.45, 0);
    this.lowestY = this.swing.position.y - ROPE_DROP - CLOTH_SAG;

    const dir = ab.clone().setY(0).normalize();
    this.circles = [-0.35, 0, 0.35].map((t) => ({
      x: layout.x + dir.x * t * gather * 2,
      z: layout.z + dir.z * t * gather * 2,
      r: 0.55,
    }));
  }

  /** `wind` 0..1; `occupied` while someone lies in it. */
  update(dt: number, wind: number, occupied: boolean, reducedMotion: boolean): void {
    const target = reducedMotion ? 0.3 * SWING_CALM : SWING_CALM + SWING_WIND * wind + (occupied ? SWING_OCCUPIED : 0);
    this.amp += (target - this.amp) * (1 - Math.exp(-dt / 3));
    this.phase += (dt / SWING_PERIOD) * Math.PI * 2;
    if (this.phase > Math.PI * 2) this.phase -= Math.PI * 2;
    // Swing around the tie line, a slight lag at the second harmonic so it isn't a metronome.
    this.swing.rotation.set(0, 0, 0);
    this.swing.rotateX(this.amp * (Math.sin(this.phase) + 0.15 * Math.sin(2 * this.phase + 0.7)));
    this.swing.updateMatrixWorld();
  }

  /** Current roll of the swing (rad), for the camera of someone lying in it. */
  get roll(): number {
    return this.amp * (Math.sin(this.phase) + 0.15 * Math.sin(2 * this.phase + 0.7));
  }

  /** World position of the eyes of someone lying in it (moves with the swing). */
  eyeWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.eyeLocal).applyMatrix4(this.swing.matrixWorld);
  }

  /** Resting eye position (no swing), for the seat pose. */
  restingEye(out: THREE.Vector3): THREE.Vector3 {
    this.swing.rotation.set(0, 0, 0);
    this.swing.updateMatrixWorld();
    return out.copy(this.eyeLocal).applyMatrix4(this.swing.matrixWorld);
  }
}

/** Cloth height at u (0..1 along) and v (−1..1 across), relative to the gather points. */
function clothY(u: number, v: number): number {
  const s = Math.sin(Math.PI * u);
  return -CLOTH_SAG * Math.pow(s, 0.85) - CLOTH_CRADLE * (1 - v * v) * s;
}

/** Width at u: gathered to a point at both ends, widest in the middle. */
function clothWidth(u: number): number {
  return CLOTH_WIDTH * Math.pow(Math.sin(Math.PI * u), 0.55);
}

function cloth(gather: number): THREE.BufferGeometry {
  const nu = 28;
  // Many rows across, so the woven stripes stay crisp (vertex colours blend between rows).
  const nv = 36;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const w = clothWidth(u);
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      pos.push(-gather + 2 * gather * u, clothY(u, v) - ROPE_DROP, (v * w) / 2);
      // Stripes run lengthwise; slightly darker where the cloth bunches toward the ends.
      const c = STRIPES[Math.min(STRIPES.length - 1, Math.floor(((v + 1) / 2) * STRIPES.length))];
      const k = 0.75 + 0.25 * Math.sin(Math.PI * u);
      col.push(c.r * k, c.g * k, c.b * k);
    }
  }
  const row = nv + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const p = i * row + j;
      idx.push(p, p + row, p + 1, p + 1, p + row, p + row + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Short tassels hanging from both long edges of the cloth. */
function fringe(gather: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const n = 22;
  for (const side of [-1, 1]) {
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const x = -gather + 2 * gather * u;
      const y = clothY(u, side) - ROPE_DROP;
      const z = (side * clothWidth(u)) / 2;
      const len = 0.16 * Math.sin(Math.PI * u) + 0.04;
      const c = STRIPES[(i * 3) % STRIPES.length];
      const b = pos.length / 3;
      pos.push(x - 0.035, y, z, x + 0.035, y, z, x + 0.025, y - len, z + side * 0.04, x - 0.025, y - len, z + side * 0.04);
      for (let k = 0; k < 4; k++) col.push(c.r, c.g, c.b);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rope(from: THREE.Vector3, to: THREE.Vector3, radius: number, color: string): THREE.BufferGeometry {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(radius, radius, len, 5, 1, true);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  return colorize(g, color);
}

function colorize(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Position + normal + color merge (all inputs indexed or not, converted to non-indexed). */
function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    col.set(g.getAttribute('color').array as Float32Array, o * 3);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const g of geos) g.dispose();
  return out;
}

/** The hammock's material: vertex-coloured cotton, both sides. */
export function createHammockMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
}
