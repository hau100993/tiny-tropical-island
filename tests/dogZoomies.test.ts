import { describe, expect, it } from 'vitest';
import { DogCompanion, type DogPlayer, type DogWorld } from '../src/activities/dogCompanion';

const spot = { x: 0, y: 0, z: 0, yaw: 0 };
function world(clear: (x: number, z: number) => boolean): DogWorld {
  return { groundAt: () => 0, terrainAt: () => 1, deskSpot: spot, bathSpot: spot, hammockSpot: spot, inRoom: () => false, clear };
}
const you: DogPlayer = { x: 0, z: 0, y: 0, speed: 0, onFoot: true, atSea: false, seat: null };

describe('Mochi: Sao Băng (zoomies)', () => {
  it('runs laps round you on open ground, leaps, lands and follows again', () => {
    const phases: string[] = [];
    let maxLift = 0;
    let maxR = 0;
    const dog = new DogCompanion(world(() => true), { onStep: () => {}, onBark: () => {}, onZoom: (p) => phases.push(p) }, { x: 1.5, z: 1.5 });
    expect(dog.zoomies(you)).toBe(true);
    for (let i = 0; i < 60 * 15 && phases.length < 3; i++) {
      dog.update(1 / 60, you);
      maxLift = Math.max(maxLift, dog.lift);
      if (dog.zooming) maxR = Math.max(maxR, Math.hypot(dog.x, dog.z));
    }
    expect(phases).toEqual(['start', 'leap', 'land']);
    expect(maxLift).toBeGreaterThan(0.5);
    expect(maxR).toBeGreaterThan(2);
    expect(dog.zooming).toBe(false);
    expect(dog.lift).toBe(0);
  });

  it('with trees all round, it stays put', () => {
    const dog = new DogCompanion(world((x, z) => Math.hypot(x, z) < 1), { onStep: () => {}, onBark: () => {}, onZoom: () => {} }, { x: 0.5, z: 0 });
    expect(dog.zoomies(you)).toBe(false);
  });
});
