import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rng } from '../core/rng';

const tmpMatrix = new THREE.Matrix4();
const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();

/**
 * Collects many small vertex-colored parts and merges them into ONE geometry,
 * so a whole house is a single draw call instead of hundreds.
 */
export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  /** @param jitter random ± brightness variation per part, for a hand-made look. */
  constructor(
    private readonly rng: Rng,
    private readonly jitter = 0.08,
  ) {}

  /** Axis-aligned box centered at (x, y, z), optionally rotated (radians, XYZ order). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, rx = 0, ry = 0, rz = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    tmpEuler.set(rx, ry, rz);
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(x, y, z);
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    g.applyMatrix4(tmpMatrix);
    this.add(g, color);
  }

  /** Adds an arbitrary geometry with a single (jittered) color. Takes ownership of `g`. */
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): void {
    tmpColor.set(color);
    const k = 1 + (this.rng() - 0.5) * 2 * this.jitter;
    this.addColored(g, tmpColor.r * k, tmpColor.g * k, tmpColor.b * k);
  }

  private addColored(g: THREE.BufferGeometry, r: number, gr: number, b: number): void {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = gr;
      colors[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g.index ? g : indexed(g));
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) throw new Error('GeoBuilder: failed to merge geometries');
    return merged;
  }
}

/** mergeGeometries needs all parts indexed (or none); give non-indexed parts a trivial index. */
function indexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const count = g.getAttribute('position').count;
  const index = new Array<number>(count);
  for (let i = 0; i < count; i++) index[i] = i;
  g.setIndex(index);
  return g;
}

/**
 * Builds a flat polygon (convex, listed in order) as a double-sided slab with no thickness:
 * front and back triangles with opposite winding, so it lights correctly from both sides.
 */
export function polygonGeometry(points: THREE.Vector3[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const p of points) pos.push(p.x, p.y, p.z);
  for (const p of points) pos.push(p.x, p.y, p.z);
  const n = points.length;
  const index: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    index.push(0, i, i + 1);
    index.push(n, n + i + 1, n + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
