import type { Heightmap } from './heightmap';
import type { Placement } from './layout';

/**
 * A faint footpath from the beach beside the house, winding inland through the rainforest
 * and out to the beach on the far side. Only a centerline: the ground, the vegetation and the
 * light shafts read their distance to it.
 */
export class Trail {
  /** Centerline, ~2.5 m apart (x, z pairs). */
  readonly points: ReadonlyArray<{ x: number; z: number }>;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;

  constructor(hm: Heightmap, house: Placement) {
    // Ends: the beach a little left of the house (seen from the sea) and the opposite shore.
    const houseAngle = Math.atan2(house.z, house.x);
    const a0 = houseAngle + 0.75;
    const a1 = a0 + Math.PI * 0.95;
    const r0 = hm.shoreDistance(a0, 0.4);
    const r1 = hm.shoreDistance(a1, 0.4);
    const pts: Array<{ x: number; z: number }> = [];
    const n = 90;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // Through the heart of the forest (close to the center midway), winding as it goes.
      const r = (r0 + (r1 - r0) * t) * (1 - 0.82 * Math.sin(Math.PI * t)) + 5 * Math.sin(t * Math.PI * 5);
      const a = a0 + (a1 - a0) * t + 0.3 * Math.sin(t * Math.PI * 3.3) + 0.06 * Math.sin(t * 37 + 1.3);
      pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    // Smooth the kinks twice (a light Chaikin-like average), keeping the ends.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i] = { x: (pts[i - 1].x + 2 * pts[i].x + pts[i + 1].x) / 4, z: (pts[i - 1].z + 2 * pts[i].z + pts[i + 1].z) / 4 };
      }
    }
    this.points = pts;
    this.minX = Math.min(...pts.map((p) => p.x)) - 6;
    this.maxX = Math.max(...pts.map((p) => p.x)) + 6;
    this.minZ = Math.min(...pts.map((p) => p.z)) - 6;
    this.maxZ = Math.max(...pts.map((p) => p.z)) + 6;
  }

  /** Meters from (x, z) to the centerline (large when far away; exact within ~6 m). */
  distance(x: number, z: number): number {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return 99;
    let best = 1e9;
    const p = this.points;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i].x;
      const az = p[i].z;
      const dx = p[i + 1].x - ax;
      const dz = p[i + 1].z - az;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const ex = ax + dx * t - x;
      const ez = az + dz * t - z;
      const d2 = ex * ex + ez * ez;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }
}
