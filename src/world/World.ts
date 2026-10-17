import * as THREE from 'three';
import { Heightmap, ISLAND_CONFIG } from './heightmap';
import { createLayout, type IslandLayout } from './layout';
import { createTerrainMesh, createHeightTexture } from './terrain';
import { createPalms, type PalmForest } from './palms';
import { createHouse, type HouseInfo } from './house';
import { createRocks, createBeachSet, createBoat, type Rocks } from './props';
import { createSky, type Sky } from './sky';
import { createLighting, type Lighting } from './lighting';
import { createWaterSurface, type WaterSurface } from '../water/WaterSurface';
import { FloatingObject } from '../water/floating';
import { createNoise2D } from '../core/noise';
import { createRng } from '../core/rng';
import type { SharedUniforms } from '../core/uniforms';

/** Fixed seed: the island looks the same every launch. */
export const WORLD_SEED = 20261017;

export interface World {
  heightmap: Heightmap;
  layout: IslandLayout;
  palms: PalmForest;
  house: HouseInfo;
  rocks: Rocks;
  sky: Sky;
  lighting: Lighting;
  water: WaterSurface;
  boat: FloatingObject;
  update(dt: number, time: number, camera: THREE.Camera, waveStrength: number): void;
}

export function createWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer, shared: SharedUniforms): World {
  const noise = createNoise2D(createRng(WORLD_SEED));
  const heightmap = new Heightmap(ISLAND_CONFIG, noise);
  const layout = createLayout(heightmap, createRng(WORLD_SEED + 1));

  const sky = createSky(shared);
  scene.add(sky.mesh);
  // Fog shares the horizon color object, so the far sea melts into the sky.
  scene.fog = new THREE.Fog(0xffffff, 260, 2800);
  scene.fog.color = shared.uSkyHorizon.value;

  const lighting = createLighting(scene, shared);

  scene.add(createTerrainMesh(heightmap, noise));

  const palms = createPalms(heightmap, layout.clearings, noise, WORLD_SEED + 2);
  scene.add(palms.group);

  const house = createHouse(heightmap, layout.house, WORLD_SEED + 3);
  scene.add(house.group);

  const rocks = createRocks(heightmap, layout, WORLD_SEED + 4);
  scene.add(rocks.group);

  scene.add(createBeachSet(heightmap, layout.umbrella, WORLD_SEED + 5));

  const boatMesh = createBoat(WORLD_SEED + 6);
  scene.add(boatMesh);
  const boat = new FloatingObject(boatMesh, heightmap, layout.boat.x, layout.boat.z, layout.boat.rotY);

  const heightTexture = createHeightTexture(heightmap);
  if (!renderer.extensions.has('OES_texture_float_linear')) {
    // Without linear filtering of float textures, fall back to nearest (slightly blockier foam).
    heightTexture.minFilter = THREE.NearestFilter;
    heightTexture.magFilter = THREE.NearestFilter;
  }
  const water = createWaterSurface(heightmap, heightTexture, shared);
  scene.add(water.mesh);

  return {
    heightmap,
    layout,
    palms,
    house,
    rocks,
    sky,
    lighting,
    water,
    boat,
    update(dt, time, camera, waveStrength) {
      sky.follow(camera);
      boat.update(time, waveStrength, camera, dt);
    },
  };
}
