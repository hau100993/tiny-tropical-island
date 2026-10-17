import { fbm2, type Noise2D } from '../core/noise';
import { smoothstep } from '../core/math';

export interface IslandConfig {
  /** Side length of the square terrain patch, in meters. */
  size: number;
  /** Grid cells per side. The render mesh and CPU sampling share this grid exactly. */
  segments: number;
  /** Nominal island radius (the waterline sits at roughly 0.85 × radius). */
  radius: number;
}

export const ISLAND_CONFIG: IslandConfig = { size: 240, segments: 160, radius: 85 };

/** Height used outside the terrain patch (open sea floor). */
export const OUTSIDE_HEIGHT = -12;

export type Surface = 'sand' | 'grass' | 'rock' | 'water';

/**
 * CPU copy of the terrain height grid. Water level is y = 0.
 * Data layout: data[j * res + i], i along +x, j along +z, vertex (i, j) at
 * x = -size/2 + i * cell, z = -size/2 + j * cell.
 */
export class Heightmap {
  readonly res: number;
  readonly cell: number;
  readonly half: number;
  readonly data: Float32Array;

  constructor(
    readonly config: IslandConfig,
    private readonly noise: Noise2D,
  ) {
    this.res = config.segments + 1;
    this.cell = config.size / config.segments;
    this.half = config.size / 2;
    this.data = new Float32Array(this.res * this.res);
    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        const x = -this.half + i * this.cell;
        const z = -this.half + j * this.cell;
        this.data[j * this.res + i] = this.generate(x, z);
      }
    }
  }

  /** The procedural shape: plateau + hill inland, a gentle beach band, then a drop to the sea floor. */
  private generate(x: number, z: number): number {
    const r = this.config.radius;
    const nx = x / r;
    const nz = z / r;
    // Warp the distance with low-frequency noise for an irregular coastline.
    const d = Math.hypot(nx, nz) + 0.13 * fbm2(this.noise, nx * 1.3 + 10, nz * 1.3 + 10, 3);
    const land = 1 - smoothstep(0.35, 0.8, d);
    const beach = 1 - smoothstep(0.72, 1.0, d);
    const sea = smoothstep(0.95, 1.45, d);
    const hx = (x + 0.24 * r) / (0.28 * r);
    const hz = (z + 0.26 * r) / (0.28 * r);
    const hill = 9 * Math.exp(-(hx * hx + hz * hz));
    const detail = 1.5 * fbm2(this.noise, x * 0.035, z * 0.035, 4);
    return -0.6 + 1.1 * beach + land * (2.2 + detail + hill) - 7.5 * sea;
  }

  private vertex(i: number, j: number): number {
    return this.data[j * this.res + i];
  }

  /**
   * Exact height of the rendered triangle mesh at (x, z). Each cell is split along the
   * (i, j+1)–(i+1, j) diagonal, matching `createTerrainMesh`.
   */
  heightAt(x: number, z: number): number {
    const gx = (x + this.half) / this.cell;
    const gz = (z + this.half) / this.cell;
    const seg = this.config.segments;
    if (gx < 0 || gz < 0 || gx > seg || gz > seg) return OUTSIDE_HEIGHT;
    const i = Math.min(Math.floor(gx), seg - 1);
    const j = Math.min(Math.floor(gz), seg - 1);
    const fx = gx - i;
    const fz = gz - j;
    const a = this.vertex(i, j);
    const b = this.vertex(i, j + 1);
    const c = this.vertex(i + 1, j);
    if (fx + fz <= 1) return a + (c - a) * fx + (b - a) * fz;
    const d = this.vertex(i + 1, j + 1);
    return d + (b - d) * (1 - fx) + (c - d) * (1 - fz);
  }

  /** Y component of the surface normal (1 = flat, 0 = vertical). */
  normalYAt(x: number, z: number): number {
    const e = this.cell;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return 1 / Math.sqrt(1 + dx * dx + dz * dz);
  }

  /** Height where dry sand turns into grass; shared by terrain colors and footstep sounds. */
  sandLineAt(x: number, z: number): number {
    return 1.15 + 0.35 * this.noise(x * 0.08, z * 0.08);
  }

  surfaceAt(x: number, z: number): Surface {
    const h = this.heightAt(x, z);
    if (h < 0) return 'water';
    if (h < this.sandLineAt(x, z)) return 'sand';
    return this.normalYAt(x, z) < 0.82 ? 'rock' : 'grass';
  }

  /**
   * Distance from the island center to the coast at `angle`, where the coast is the
   * outermost point whose height is still >= `targetHeight`.
   */
  shoreDistance(angle: number, targetHeight: number): number {
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    let last = 0;
    for (let r = 0; r < this.half; r += 0.25) {
      if (this.heightAt(cx * r, cz * r) >= targetHeight) last = r;
    }
    return last;
  }
}
