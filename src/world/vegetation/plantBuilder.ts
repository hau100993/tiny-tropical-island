import * as THREE from 'three';
import type { Rng } from '../../core/rng';

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpColor = new THREE.Color();

/** Bend amount (m of displacement per unit of gust) for a vertex at local position (x, y, z). */
export type SwayFn = (x: number, y: number, z: number) => number;

export interface LeafOptions {
  /** Initial upward component, as a fraction of length. */
  lift: number;
  /** Downward curvature, as a fraction of length (quadratic). */
  droop: number;
  segs: number;
  /** V-fold depth relative to width. */
  fold?: number;
  /** 0 = smooth edges; 0..1 = every other segment narrower (feathery fern look). */
  zigzag?: number;
  base: THREE.Color;
  tip: THREE.Color;
  /** Width profile along the leaf, t ∈ [0, 1]. Default: pointed at both ends. */
  shape?: (t: number) => number;
  /** Flutter weight multiplier (1 = flutters fully at the tip). */
  flutter?: number;
}

/**
 * Low-poly plant geometry builder. Every vertex carries:
 * - color (vertex colors; one shared material for all plants → 1 draw call per plant variant),
 * - aSway: how far it bends with the wind (stiff trunk base 0 … flexible crown),
 * - aTip: leaf-flutter weight (0 on wood, up to 1 at leaf tips).
 * The vertex shader (patchMaterial.ts, SWAY_PLANT) turns these into motion.
 */
export class PlantBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly sway: number[] = [];
  private readonly tips: number[] = [];
  private readonly idx: number[] = [];

  constructor(
    private readonly rng: Rng,
    private readonly swayFn: SwayFn,
  ) {}

  private get count(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, c: THREE.Color, tip = 0): number {
    this.pos.push(x, y, z);
    this.col.push(c.r, c.g, c.b);
    this.sway.push(this.swayFn(x, y, z));
    this.tips.push(tip);
    return this.count - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * Tapered tube through `points` (trunks, branches, stems). `radialScale(ring, angle)`
   * optionally reshapes each ring's cross-section (e.g. buttress ridges at a trunk's base).
   */
  tube(
    points: THREE.Vector3[],
    radii: number[],
    radial: number,
    colorAt: (t: number, ring: number) => THREE.Color,
    tip = 0,
    radialScale?: (ring: number, angle: number) => number,
  ): void {
    const n = points.length;
    const start = this.count;
    for (let i = 0; i < n; i++) {
      tmpA.subVectors(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]).normalize();
      const ref = Math.abs(tmpA.y) < 0.95 ? UP : X;
      tmpB.crossVectors(ref, tmpA).normalize();
      tmpC.crossVectors(tmpA, tmpB);
      const c = colorAt(i / (n - 1), i);
      const p = points[i];
      for (let a = 0; a < radial; a++) {
        const ang = (a / radial) * Math.PI * 2;
        const r = radii[i] * (radialScale ? radialScale(i, ang) : 1);
        const ca = Math.cos(ang) * r;
        const sa = Math.sin(ang) * r;
        this.vertex(p.x + tmpB.x * ca + tmpC.x * sa, p.y + tmpB.y * ca + tmpC.y * sa, p.z + tmpB.z * ca + tmpC.z * sa, c, tip);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let a = 0; a < radial; a++) {
        const a1 = (a + 1) % radial;
        const i0 = start + i * radial + a;
        const i1 = start + i * radial + a1;
        const i2 = start + (i + 1) * radial + a;
        const i3 = start + (i + 1) * radial + a1;
        this.tri(i0, i2, i1);
        this.tri(i1, i2, i3);
      }
    }
  }

  /**
   * Lumpy sphere (crowns, bushes, fruit). Shared corners get the same random offset so the
   * surface stays closed; vertices are welded so normals are smooth.
   */
  blob(center: THREE.Vector3, radius: number, scale: THREE.Vector3, color: THREE.Color, jitter = 0.22, detail = 1, tip = 0.25, colorJitter = 0.1): void {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.getAttribute('position');
    const welded = new Map<string, number>();
    const tri: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let index = welded.get(key);
      if (index === undefined) {
        const k = 1 + (this.rng() - 0.5) * 2 * jitter;
        const shade = 1 + (this.rng() - 0.5) * 2 * colorJitter;
        tmpColor.copy(color).multiplyScalar(shade);
        index = this.vertex(
          center.x + p.getX(i) * k * radius * scale.x,
          center.y + p.getY(i) * k * radius * scale.y,
          center.z + p.getZ(i) * k * radius * scale.z,
          tmpColor,
          tip,
        );
        welded.set(key, index);
      }
      tri.push(index);
    }
    for (let i = 0; i < tri.length; i += 3) this.tri(tri[i], tri[i + 1], tri[i + 2]);
    g.dispose();
  }

  /** A leaf/frond strip with a center rib: left edge, rib, right edge per segment. */
  leaf(base: THREE.Vector3, dir: THREE.Vector3, length: number, width: number, o: LeafOptions): void {
    const side = new THREE.Vector3().crossVectors(Math.abs(dir.y) > 0.98 ? X : UP, dir).normalize();
    const shape = o.shape ?? ((t: number) => Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)), 0.8));
    const fold = o.fold ?? 0.3;
    const flutter = o.flutter ?? 1;
    const start = this.count;
    const center = new THREE.Vector3();
    for (let s = 0; s <= o.segs; s++) {
      const t = s / o.segs;
      center.copy(base).addScaledVector(dir, length * t).addScaledVector(UP, length * (o.lift * t - o.droop * t * t));
      let w = width * shape(t);
      if (o.zigzag && s % 2 === 1) w *= 1 - o.zigzag;
      tmpColor.copy(o.base).lerp(o.tip, t);
      const edge = tmpColor.clone().multiplyScalar(0.9);
      const rib = tmpColor.clone().multiplyScalar(1.12);
      const tip = t * flutter;
      const f = fold * w;
      this.vertex(center.x + side.x * w, center.y - f, center.z + side.z * w, edge, tip);
      this.vertex(center.x, center.y, center.z, rib, tip);
      this.vertex(center.x - side.x * w, center.y - f, center.z - side.z * w, edge, tip);
    }
    for (let s = 0; s < o.segs; s++) {
      const r0 = start + s * 3;
      const r1 = r0 + 3;
      this.tri(r0, r1, r0 + 1);
      this.tri(r0 + 1, r1, r1 + 1);
      this.tri(r0 + 1, r1 + 1, r0 + 2);
      this.tri(r0 + 2, r1 + 1, r1 + 2);
    }
  }

  /** Star-shaped flower facing `normal`, slightly cupped. */
  flower(center: THREE.Vector3, normal: THREE.Vector3, size: number, petals: number, petal: THREE.Color, heart: THREE.Color, tip = 0.4): void {
    tmpN.copy(normal).normalize();
    const u = new THREE.Vector3().crossVectors(Math.abs(tmpN.y) > 0.9 ? X : UP, tmpN).normalize();
    const v = new THREE.Vector3().crossVectors(tmpN, u);
    const c = this.vertex(center.x + tmpN.x * size * 0.1, center.y + tmpN.y * size * 0.1, center.z + tmpN.z * size * 0.1, heart, tip);
    const rim: number[] = [];
    const steps = petals * 2;
    const rot = this.rng() * Math.PI;
    for (let k = 0; k < steps; k++) {
      const ang = rot + (k / steps) * Math.PI * 2;
      const out = k % 2 === 0;
      const r = out ? size : size * 0.35;
      const lift = out ? size * 0.3 : 0;
      rim.push(
        this.vertex(
          center.x + (u.x * Math.cos(ang) + v.x * Math.sin(ang)) * r + tmpN.x * lift,
          center.y + (u.y * Math.cos(ang) + v.y * Math.sin(ang)) * r + tmpN.y * lift,
          center.z + (u.z * Math.cos(ang) + v.z * Math.sin(ang)) * r + tmpN.z * lift,
          petal,
          tip,
        ),
      );
    }
    for (let k = 0; k < steps; k++) this.tri(c, rim[k], rim[(k + 1) % steps]);
  }

  /** Cone from `base` along `dir` (buds, bracts). */
  cone(base: THREE.Vector3, dir: THREE.Vector3, height: number, radius: number, segs: number, color: THREE.Color, tip = 0.3): void {
    const d = dir.clone().normalize();
    const u = new THREE.Vector3().crossVectors(Math.abs(d.y) > 0.9 ? X : UP, d).normalize();
    const v = new THREE.Vector3().crossVectors(d, u);
    const apex = this.vertex(base.x + d.x * height, base.y + d.y * height, base.z + d.z * height, color, tip);
    const ring: number[] = [];
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      ring.push(
        this.vertex(
          base.x + (u.x * Math.cos(a) + v.x * Math.sin(a)) * radius,
          base.y + (u.y * Math.cos(a) + v.y * Math.sin(a)) * radius,
          base.z + (u.z * Math.cos(a) + v.z * Math.sin(a)) * radius,
          color,
          tip,
        ),
      );
    }
    for (let k = 0; k < segs; k++) this.tri(apex, ring[k], ring[(k + 1) % segs]);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('aTip', new THREE.Float32BufferAttribute(this.tips, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Quadratic bend with height, like a cantilever: 0 at the ground, `flex` m at `height`. */
export function bendWithHeight(height: number, flex: number): SwayFn {
  return (_x, y) => {
    const h = Math.max(0, y) / height;
    return flex * h * h;
  };
}
