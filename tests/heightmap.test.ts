import { describe, expect, it } from 'vitest';
import { Heightmap, ISLAND_CONFIG, OUTSIDE_HEIGHT } from '../src/world/heightmap';
import { createNoise2D } from '../src/core/noise';
import { createRng } from '../src/core/rng';

const hm = new Heightmap(ISLAND_CONFIG, createNoise2D(createRng(20261017)));

describe('Heightmap', () => {
  it('is deterministic for a given seed', () => {
    const other = new Heightmap(ISLAND_CONFIG, createNoise2D(createRng(20261017)));
    expect(other.data).toEqual(hm.data);
  });

  it('has land in the middle and sea at the edges', () => {
    expect(hm.heightAt(0, 0)).toBeGreaterThan(1);
    expect(hm.heightAt(ISLAND_CONFIG.size / 2 - 1, 0)).toBeLessThan(-4);
    expect(hm.heightAt(10000, 0)).toBe(OUTSIDE_HEIGHT);
  });

  it('matches the grid exactly at vertices', () => {
    const i = 37;
    const j = 91;
    const x = -hm.half + i * hm.cell;
    const z = -hm.half + j * hm.cell;
    expect(hm.heightAt(x, z)).toBeCloseTo(hm.data[j * hm.res + i], 5);
  });

  it('is continuous across the cell diagonal', () => {
    const x = -hm.half + 50.5 * hm.cell;
    const z = -hm.half + 60.5 * hm.cell;
    const eps = 1e-4;
    expect(Math.abs(hm.heightAt(x - eps, z - eps) - hm.heightAt(x + eps, z + eps))).toBeLessThan(0.01);
  });

  it('island diameter is roughly 150 m', () => {
    const angles = 16;
    let sum = 0;
    for (let k = 0; k < angles; k++) sum += hm.shoreDistance((k / angles) * Math.PI * 2, 0);
    const diameter = (2 * sum) / angles;
    expect(diameter).toBeGreaterThan(110);
    expect(diameter).toBeLessThan(190);
  });
});
