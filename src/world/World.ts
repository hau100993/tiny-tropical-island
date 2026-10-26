import * as THREE from 'three';
import { Heightmap, ISLAND_CONFIG } from './heightmap';
import { createLayout, type IslandLayout } from './layout';
import { createTerrainMesh, createHeightTexture } from './terrain';
import { createForest, fixedPalmTrunkAt, type Forest } from './vegetation/forest';
import { GroundFlowers } from './vegetation/groundFlowers';
import { createHouse, type HouseInfo } from './house';
import { createRocks, createBeachSet, createBoat, type Rocks } from './props';
import { createFishingBoat, FishingTrip } from './fishingBoat';
import { createLightShafts } from './lightShafts';
import { createTrailMarkers } from './trailMarkers';
import { createSurfboard } from './surfboard';
import { Hammock, createHammockMaterial } from './hammock';
import { Footprints } from './footprints';
import { Animals } from './animals/Animals';
import { DESK } from './houseInterior';
import { createSky, type Sky } from './sky';
import { createLighting, type Lighting } from './lighting';
import { Grass } from './grass';
import { WaterSystem } from '../water/WaterSystem';
import { FloatingObject } from '../water/floating';
import { patchWorldMaterial, type WorldMaterialFeatures } from './patchMaterial';
import { Weather } from '../weather/Weather';
import { DayNight } from './dayNight';
import { Fireflies } from './fireflies';
import { createKayak, type KayakModel } from './kayak';
import { Spray } from '../water/Spray';
import { Underwater } from '../water/Underwater';
import { createReef, type Reef } from './reef';
import { createNoise2D } from '../core/noise';
import { createRng } from '../core/rng';
import type { SharedUniforms } from '../core/uniforms';

/** Fixed seed: the island looks the same every launch. */
export const WORLD_SEED = 20261017;
/** Haze range above water (m); clear air ("Trời trong") pushes it out to FOG_*_CLEAR. */
export const FOG_NEAR = 260;
export const FOG_FAR = 2800;
export const FOG_NEAR_CLEAR = 900;
export const FOG_FAR_CLEAR = 7000;

export interface World {
  heightmap: Heightmap;
  layout: IslandLayout;
  forest: Forest;
  flowers: GroundFlowers;
  house: HouseInfo;
  rocks: Rocks;
  sky: Sky;
  lighting: Lighting;
  water: WaterSystem;
  grass: Grass;
  weather: Weather;
  dayNight: DayNight;
  fireflies: Fireflies;
  boat: FloatingObject;
  fishingTrip: FishingTrip;
  kayak: KayakModel;
  /** The surfboard (moved by the surf activity). */
  surfboard: THREE.Group;
  /** Droplets from the paddle. */
  spray: Spray;
  /** Under-water look while the camera is below the surface. */
  underwater: Underwater;
  /** Corals, seaweed and fish around the island (diving). */
  reef: Reef;
  /** The hammock between two palms on the beach (a seat). */
  hammock: Hammock;
  /** Bare footprints on sand and snow. */
  footprints: Footprints;
  /** Seagulls, dolphins, crabs, sea turtles. */
  animals: Animals;
  /** `player`: where you are on foot (the crabs run from you), or null. */
  update(dt: number, time: number, camera: THREE.Camera, waveStrength: number, player: { x: number; z: number } | null): void;
}

/** Applies weather features to every MeshStandardMaterial under `root` (each material once). */
function patchTree(root: THREE.Object3D, features: WorldMaterialFeatures, shared: SharedUniforms, skip: THREE.Material[] = []): void {
  const done = new Set<THREE.Material>(skip);
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m instanceof THREE.MeshStandardMaterial && !done.has(m)) {
      done.add(m);
      patchWorldMaterial(m, features, shared);
    }
  });
}

/** Roof footprint (house-local rectangle) → shared shelter uniforms. */
function setShelter(shared: SharedUniforms, house: HouseInfo): void {
  const p = house.placement;
  const { x1, z0, z1 } = house.roof;
  const zc = (z0 + z1) / 2;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  // House-local (0, zc) in world space; the shaders rotate world → local with (cos, sin).
  shared.uShelter.value.set(p.x + zc * s, p.z + zc * c, c, s);
  // Dry below the eaves (roof surfaces above still get snow); particles hidden up to the ridge.
  shared.uShelterSize.value.set(x1, (z1 - z0) / 2, house.eaveY, house.ridgeY);
}

export function createWorld(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  shared: SharedUniforms,
): World {
  const noise = createNoise2D(createRng(WORLD_SEED));
  const heightmap = new Heightmap(ISLAND_CONFIG, noise);
  const layout = createLayout(heightmap, createRng(WORLD_SEED + 1));

  const sky = createSky(shared);
  scene.add(sky.mesh);
  // Fog shares the horizon color object, so the far sea melts into the sky.
  scene.fog = new THREE.Fog(0xffffff, FOG_NEAR, FOG_FAR);
  scene.fog.color = shared.uSkyHorizon.value;

  const lighting = createLighting(scene);

  const terrain = createTerrainMesh(heightmap, noise, layout.trail);
  scene.add(terrain);

  const forest = createForest(heightmap, noise, layout.house, layout.clearings, WORLD_SEED + 2, shared, layout.trail, layout.hammock.palms, [
    { ...layout.hammock.clearing, r: 3.4 },
  ]);
  const hammock = new Hammock(heightmap, layout.hammock, (p, y) => fixedPalmTrunkAt(WORLD_SEED + 2, p, y), createHammockMaterial());
  scene.add(hammock.group);
  patchTree(hammock.group, { wet: true, porosity: 0.9, snow: true }, shared);
  scene.add(forest.group);

  const grass = new Grass(heightmap, noise, layout.house, layout.trail, WORLD_SEED + 7, shared);
  scene.add(grass.mesh);
  const flowers = new GroundFlowers(heightmap, noise, layout.house, layout.trail, WORLD_SEED + 8, shared);
  scene.add(flowers.group);
  // Sunbeams through the canopy over the footpath.
  const shafts = createLightShafts(heightmap, layout.trail, WORLD_SEED + 11, shared);
  scene.add(shafts);
  const trailMarkers = createTrailMarkers(heightmap, layout.trail, layout.house, WORLD_SEED + 12);
  scene.add(trailMarkers);
  patchTree(trailMarkers, { wet: true, porosity: 0.5, snow: true }, shared);

  const house = createHouse(heightmap, layout.house, WORLD_SEED + 3);
  scene.add(house.group);
  const houseWeather = { wet: true, porosity: 0.7, snow: true, sheltered: true } as const;
  patchTree(house.group, houseWeather, shared, [house.windowMaterial, house.glassMaterial, house.woodMaterial]);
  patchWorldMaterial(house.woodMaterial, { ...houseWeather, wood: true }, shared);
  setShelter(shared, house);

  const rocks = createRocks(heightmap, layout, WORLD_SEED + 4);
  scene.add(rocks.group);

  const beachSet = createBeachSet(heightmap, layout.umbrella, WORLD_SEED + 5);
  scene.add(beachSet);
  patchTree(beachSet, { wet: true, porosity: 0.6, snow: true }, shared);

  const boatMesh = createBoat(WORLD_SEED + 6);
  scene.add(boatMesh);
  patchTree(boatMesh, { wet: true, porosity: 0.5 }, shared);
  const boat = new FloatingObject(boatMesh, heightmap, layout.boat.x, layout.boat.z, layout.boat.rotY);
  // A fishing boat out at sea, seen from the desk in the upper right of the view: it loops
  // slowly ~150 m out, 15–35° right of straight ahead (house-local −X is the desk view's right).
  const fishing = createFishingBoat(WORLD_SEED + 10, shared);
  const fishingMesh = fishing.group;
  scene.add(fishingMesh);
  patchTree(fishingMesh, { wet: true, porosity: 0.3 }, shared);
  const fishingTrip = new FishingTrip(fishingMesh, layout.house, { x: DESK.seatX - 62, z: 160 }, { x: 34, z: 16 });

  // The kayak (moved by the kayak activity, not here).
  const kayak = createKayak(WORLD_SEED + 13);
  scene.add(kayak.group);
  patchTree(kayak.group, { wet: true, porosity: 0.1 }, shared);
  const surfboard = createSurfboard();
  scene.add(surfboard);
  patchTree(surfboard, { wet: true, porosity: 0.1 }, shared);
  const footprints = new Footprints(heightmap, shared);
  scene.add(footprints.mesh);
  const spray = new Spray(shared);
  scene.add(spray.points);

  const heightTexture = createHeightTexture(heightmap);
  if (!renderer.extensions.has('OES_texture_float_linear')) {
    // Without linear filtering of float textures, fall back to nearest (slightly blockier foam).
    heightTexture.minFilter = THREE.NearestFilter;
    heightTexture.magFilter = THREE.NearestFilter;
  }
  const water = new WaterSystem(renderer, heightmap, heightTexture, shared, camera);
  scene.add(water.surface.mesh);
  water.surface.setSurf(layout.surf.frame);
  // Ground and rocks: wet sheen and puddles, snow cover, and caustic light under water.
  const caustics = water.causticsUniforms;
  patchWorldMaterial(terrain.material, { wet: true, puddles: true, snow: true, caustics, ground: true }, shared);
  patchTree(rocks.group, { wet: true, porosity: 0.6, snow: true, caustics, stone: true }, shared);

  const reef = createReef(heightmap, WORLD_SEED + 14, shared, caustics, Math.atan2(layout.house.z, layout.house.x));
  scene.add(reef.group);
  const animals = new Animals(heightmap, WORLD_SEED + 15, shared, layout.house, spray, reef.floorAt);
  scene.add(animals.group);
  const underwater = new Underwater(scene, sky.mesh, shared);
  water.attachUnderwater(underwater);
  const weather = new Weather(scene, shared, water);
  const dayNight = new DayNight(shared, lighting, house);
  const fireflies = new Fireflies(heightmap, WORLD_SEED + 9, shared);
  scene.add(fireflies.points);
  // The refraction capture only needs what lies under the water. Sky and particles would show
  // up twice; vegetation is all on land, so skipping it saves most of the capture's cost.
  water.setCaptureHidden([sky.mesh, ...weather.particleMeshes, forest.group, grass.mesh, flowers.group, fireflies.points, shafts, spray.points, footprints.mesh, animals.seagulls.mesh, animals.crabs.mesh, ...fishing.lights.onWater, ...fishing.lights.aboveWater]);
  // Reflections keep the trees (that's what you want to see mirrored) but skip small stuff.
  water.setReflectionHidden([sky.mesh, ...weather.particleMeshes, grass.mesh, flowers.group, fireflies.points, shafts, spray.points, reef.group, footprints.mesh, animals.turtles.mesh, animals.crabs.mesh, ...fishing.lights.onWater]);

  return {
    heightmap,
    layout,
    forest,
    flowers,
    house,
    rocks,
    sky,
    lighting,
    water,
    grass,
    weather,
    dayNight,
    fireflies,
    boat,
    fishingTrip,
    kayak,
    surfboard,
    spray,
    underwater,
    reef,
    hammock,
    footprints,
    animals,
    update(dt, time, camera, waveStrength, player) {
      animals.update(dt, time, camera, player);
      sky.follow(camera);
      spray.update(dt);
      boat.update(time, waveStrength, camera, dt);
      fishingTrip.update(time, waveStrength, camera, dt);
      fishing.lights.update();
    },
  };
}
