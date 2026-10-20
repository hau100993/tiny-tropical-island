import * as THREE from 'three';
import { Seagulls } from './seagulls';
import { Dolphins } from './dolphins';
import { Crabs } from './crabs';
import { Turtles } from './turtles';
import type { Heightmap } from '../heightmap';
import type { Placement } from '../layout';
import type { SharedUniforms } from '../../core/uniforms';
import type { Spray } from '../../water/Spray';
import { createRng } from '../../core/rng';

/**
 * The island's animals: seagulls overhead, a dolphin pod off the house beach, ghost crabs on the
 * sand and sea turtles over the reef. Four instanced meshes (one draw call each); paths are
 * worked out on the CPU (a few dozen matrices a frame), wing and flipper strokes in the shaders.
 */
export class Animals {
  readonly group = new THREE.Group();
  readonly seagulls: Seagulls;
  readonly dolphins: Dolphins;
  readonly crabs: Crabs;
  readonly turtles: Turtles;

  constructor(
    hm: Heightmap,
    seed: number,
    shared: SharedUniforms,
    house: Placement,
    spray: Spray,
    floorAt: (x: number, z: number) => number,
  ) {
    this.group.name = 'animals';
    const houseAngle = Math.atan2(house.z, house.x);
    this.seagulls = new Seagulls(createRng(seed), shared, hm.config.radius);
    this.dolphins = new Dolphins(createRng(seed + 1), shared, house, spray);
    // The house beach, the umbrella and the hammock.
    this.crabs = new Crabs(hm, createRng(seed + 2), shared, [houseAngle - 0.45, houseAngle + 0.9]);
    this.turtles = new Turtles(hm, createRng(seed + 3), shared, floorAt, houseAngle);
    this.group.add(this.seagulls.mesh, this.dolphins.mesh, this.crabs.mesh, this.turtles.mesh);
  }

  /** `player`: where you are on foot (crabs run from you), or null. */
  update(dt: number, time: number, camera: THREE.Camera, player: { x: number; z: number } | null): void {
    this.seagulls.update(time);
    this.dolphins.update(dt, time, camera);
    this.crabs.update(dt, player);
    this.turtles.update(time);
  }
}
