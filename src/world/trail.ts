import type { Heightmap } from './heightmap';
import type { Placement } from './layout';

/**
 * A footpath from the sea into the rainforest: it starts at the water's edge in front of the
 * house, runs up the beach along the house's left side (seen from the sea), passes behind it
 * into the forest, winds through the heart of the rainforest and comes out on the beach on the
 * far side. Only a centerline: the ground, the vegetation, the markers and the light shafts
 * read their distance to it (and how far along it they are: the entrance is the clearest).
 */
export class Trail {
  /** Centerline, ~2 m apart (x, z pairs), from the beach by the house. */
  readonly points: ReadonlyArray<{ x: number; z: number }>;
  /** Arc length (m) at each point. */
  readonly along: ReadonlyArray<number>;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;

  constructor(hm: Heightmap, house: Placement) {
    const c = Math.cos(house.rotY);
    const s = Math.sin(house.rotY);
    const local = (lx: number, lz: number): { x: number; z: number } => ({ x: house.x + lx * c + lz * s, z: house.z - lx * s + lz * c });
    // Where the beach in front of the house meets the water (local +Z is the sea side).
    let beachZ = 8;
    while (beachZ < 40 && hm.heightAt(local(-6.5, beachZ).x, local(-6.5, beachZ).z) > 0.45) beachZ += 0.5;
    // The entrance: up the beach and along the house's left side (local −X), then behind it.
    const pts: Array<{ x: number; z: number }> = [
      local(-6.2, beachZ),
      local(-6.6, beachZ * 0.6 + 2),
      local(-6.8, 4),
      local(-6.9, -1),
      local(-6.4, -6),
      local(-5, -11),
    ];
    // Then on into the forest and across the island to the far beach.
    const start = pts[pts.length - 1];
    const a0 = Math.atan2(start.z, start.x);
    const r0 = Math.hypot(start.x, start.z);
    const a1 = a0 + Math.PI * 0.95;
    const r1 = hm.shoreDistance(a1, 0.4);
    const n = 80;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Through the heart of the forest (close to the center midway), winding as it goes.
      const r = (r0 + (r1 - r0) * t) * (1 - 0.75 * Math.sin(Math.PI * t)) + 5 * Math.sin(t * Math.PI * 5);
      const a = a0 + (a1 - a0) * t + 0.3 * Math.sin(t * Math.PI * 3.3) + 0.06 * Math.sin(t * 37 + 1.3);
      pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    // Smooth the kinks (a light Chaikin-like average), keeping the ends.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i] = { x: (pts[i - 1].x + 2 * pts[i].x + pts[i + 1].x) / 4, z: (pts[i - 1].z + 2 * pts[i].z + pts[i + 1].z) / 4 };
      }
    }
    this.points = pts;
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.along = along;
    this.minX = Math.min(...pts.map((p) => p.x)) - 6;
    this.maxX = Math.max(...pts.map((p) => p.x)) + 6;
    this.minZ = Math.min(...pts.map((p) => p.z)) - 6;
    this.maxZ = Math.max(...pts.map((p) => p.z)) + 6;
  }

  /** Meters from (x, z) to the centerline (large when far away; exact within ~6 m). */
  distance(x: number, z: number): number {
    return this.nearest(x, z).d;
  }

  /** Distance to the centerline `d` and how far along the path the nearest point is `s` (m). */
  nearest(x: number, z: number): { d: number; s: number } {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return { d: 99, s: 0 };
    let best = 1e9;
    let bestS = 0;
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
      if (d2 < best) {
        best = d2;
        bestS = this.along[i] + t * (this.along[i + 1] - this.along[i]);
      }
    }
    return { d: Math.sqrt(best), s: bestS };
  }
}
