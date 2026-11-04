import * as THREE from 'three';

/**
 * The cross-section of a ribbon: vertices as (s, h) (sideways along the point's side vector,
 * up), and which pairs of them are joined into bands along the ribbon. Units are up to the
 * material (it scales them; see the uScale uniform of the ice and the aurora).
 */
export interface RibbonProfile {
  readonly verts: readonly (readonly [number, number])[];
  readonly bands: readonly (readonly [number, number])[];
}

/**
 * A strip laid along a path point by point (the ice road, the aurora's curtains): every point
 * gets the profile's vertices, consecutive points of a strand are joined by quads. A ring buffer
 * of `max` points (the oldest are overwritten); `cut()` starts a new strand.
 *
 * The vertices only carry the centre, the side vector, the profile (s, h), the birth time and
 * the distance along the strand: the shader places them (unfurling, waving, melting), so the
 * CPU writes one point per push and nothing per frame. The index list is rebuilt per push
 * (a few hundred quads at most).
 */
export class TrailRibbon {
  readonly geometry = new THREE.BufferGeometry();
  /** Per point: centre, birth time, whether it continues the previous point's strand. */
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly cz: Float32Array;
  readonly born: Float32Array;
  readonly linked: Uint8Array;
  readonly max: number;
  /** Points pushed so far (capped at `max`). */
  count = 0;
  private head = -1;
  private broken = true;
  private along = 0;
  private readonly nv: number;
  private readonly pos: THREE.BufferAttribute;
  private readonly side: THREE.BufferAttribute;
  private readonly birth: THREE.BufferAttribute;
  private readonly dist: THREE.BufferAttribute;
  private readonly index: THREE.BufferAttribute;

  constructor(
    max: number,
    private readonly profile: RibbonProfile,
  ) {
    this.max = max;
    this.cx = new Float32Array(max);
    this.cy = new Float32Array(max);
    this.cz = new Float32Array(max);
    this.born = new Float32Array(max).fill(-1e9);
    this.linked = new Uint8Array(max);
    const nv = (this.nv = profile.verts.length);
    const g = this.geometry;
    this.pos = new THREE.BufferAttribute(new Float32Array(max * nv * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.side = new THREE.BufferAttribute(new Float32Array(max * nv * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.birth = new THREE.BufferAttribute(new Float32Array(max * nv).fill(-1e9), 1).setUsage(THREE.DynamicDrawUsage);
    this.dist = new THREE.BufferAttribute(new Float32Array(max * nv), 1).setUsage(THREE.DynamicDrawUsage);
    // The profile coordinates never change: (s, h) per vertex, the same for every point.
    const prof = new Float32Array(max * nv * 2);
    for (let i = 0; i < max; i++) {
      for (let k = 0; k < nv; k++) {
        prof[(i * nv + k) * 2] = profile.verts[k][0];
        prof[(i * nv + k) * 2 + 1] = profile.verts[k][1];
      }
    }
    g.setAttribute('position', this.pos);
    g.setAttribute('aSide', this.side);
    g.setAttribute('aProf', new THREE.BufferAttribute(prof, 2));
    g.setAttribute('aBirth', this.birth);
    g.setAttribute('aAlong', this.dist);
    const indices = max * profile.bands.length * 6;
    this.index = new THREE.BufferAttribute(max * nv > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1).setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
  }

  /** Index of the point before `i` in the ring. */
  prev(i: number): number {
    return (i - 1 + this.max) % this.max;
  }

  /** Adds a point at (x, y, z), its side vector (sx, sz) (unit, horizontal), born at `time`. */
  push(x: number, y: number, z: number, sx: number, sz: number, time: number): void {
    const i = (this.head = (this.head + 1) % this.max);
    if (this.count < this.max) this.count++;
    const link = !this.broken && this.count > 1;
    if (link) {
      const p = this.prev(i);
      this.along += Math.hypot(x - this.cx[p], y - this.cy[p], z - this.cz[p]);
    } else {
      this.along = 0;
    }
    this.broken = false;
    this.cx[i] = x;
    this.cy[i] = y;
    this.cz[i] = z;
    this.born[i] = time;
    this.linked[i] = link ? 1 : 0;
    // The point after this one (the oldest) was joined to what used to be here: not any more.
    this.linked[(i + 1) % this.max] = 0;
    const nv = this.nv;
    const pos = this.pos.array as Float32Array;
    const side = this.side.array as Float32Array;
    const birth = this.birth.array as Float32Array;
    const dist = this.dist.array as Float32Array;
    for (let k = 0; k < nv; k++) {
      const v = i * nv + k;
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      side[v * 2] = sx;
      side[v * 2 + 1] = sz;
      birth[v] = time;
      dist[v] = this.along;
    }
    this.pos.needsUpdate = true;
    this.side.needsUpdate = true;
    this.birth.needsUpdate = true;
    this.dist.needsUpdate = true;
    this.rebuild();
  }

  /** The next point starts a new strand (not joined to the last one). */
  cut(): void {
    this.broken = true;
  }

  /** Forgets every point. */
  clear(): void {
    this.born.fill(-1e9);
    this.linked.fill(0);
    this.count = 0;
    this.head = -1;
    this.broken = true;
    this.geometry.setDrawRange(0, 0);
  }

  private rebuild(): void {
    const idx = this.index.array as Uint16Array | Uint32Array;
    const nv = this.nv;
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (!this.linked[i]) continue;
      const a = this.prev(i) * nv;
      const b = i * nv;
      // Counter-clockwise seen from the side the profile's s → h turn faces (a flat strip: from
      // above, with the side vector pointing right of the way it was laid).
      for (const [k0, k1] of this.profile.bands) {
        idx[n++] = a + k0;
        idx[n++] = a + k1;
        idx[n++] = b + k0;
        idx[n++] = a + k1;
        idx[n++] = b + k1;
        idx[n++] = b + k0;
      }
    }
    this.index.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
