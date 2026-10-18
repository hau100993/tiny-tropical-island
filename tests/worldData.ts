import { Heightmap, ISLAND_CONFIG } from '../src/world/heightmap';
import { createLayout } from '../src/world/layout';
import { createHouse } from '../src/world/house';
import { createNoise2D } from '../src/core/noise';
import { createRng } from '../src/core/rng';
import type { IslandColliderInputs } from '../src/controls/islandColliders';

/** The real island (same seeds as World.ts), without trees: enough for collision tests. */
export function createWorldData(): IslandColliderInputs {
  const seed = 20261017;
  const heightmap = new Heightmap(ISLAND_CONFIG, createNoise2D(createRng(seed)));
  const layout = createLayout(heightmap, createRng(seed + 1));
  const house = createHouse(heightmap, layout.house, seed + 3);
  return {
    heightmap,
    house,
    umbrella: layout.umbrella,
    trunks: [],
    rocks: layout.rocks.map((r) => ({ x: r.x, z: r.z, r: r.scale })),
  };
}
