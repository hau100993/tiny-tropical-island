import { describe, expect, it } from 'vitest';
import { createForest } from '../src/world/vegetation/forest';
import { SPECIES } from '../src/world/vegetation/species';
import { Heightmap, ISLAND_CONFIG } from '../src/world/heightmap';
import { createLayout } from '../src/world/layout';
import { createNoise2D } from '../src/core/noise';
import { createRng } from '../src/core/rng';
import { sharedUniforms } from '../src/core/uniforms';

const SEED = 20261017;
const noise = createNoise2D(createRng(SEED));
const hm = new Heightmap(ISLAND_CONFIG, noise);
const layout = createLayout(hm, createRng(SEED + 1));
const forest = createForest(hm, noise, layout.house, layout.clearings, SEED + 2, sharedUniforms);

describe('forest', () => {
  it('every species finds room to grow', () => {
    for (const sp of SPECIES) expect(forest.counts[sp.id], sp.id).toBeGreaterThan(sp.count * 0.3);
  });

  it('palms no longer dominate: coconuts are a small share of the trees', () => {
    const trees = SPECIES.filter((s) => s.layer === 'tree').reduce((n, s) => n + forest.counts[s.id], 0);
    expect(forest.counts.coconut / trees).toBeLessThan(0.25);
  });

  it('has fruit trees, rainforest giants and flowering plants', () => {
    for (const id of ['banana', 'papaya', 'mango', 'emergent', 'canopy', 'frangipani', 'hibiscus', 'heliconia']) {
      expect(forest.counts[id], id).toBeGreaterThan(0);
    }
  });

  it('no tree grows on the house', () => {
    const { x, z } = layout.house;
    for (const t of forest.trunks) expect(Math.hypot(t.x - x, t.z - z)).toBeGreaterThan(6);
  });
});
