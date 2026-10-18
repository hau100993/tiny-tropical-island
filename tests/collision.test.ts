import { describe, expect, it } from 'vitest';
import { CollisionWorld, frame, STEP_UP, type BoxCollider, type Platform, type Support } from '../src/controls/collision';
import { IslandColliders, type WalkSurface } from '../src/controls/islandColliders';
import { spatialMix, type ListenerState } from '../src/audio/spatial';
import { createWorldData } from './worldData';

type S = 'ground' | 'wood';
const flat = { heightAt: () => 0, surfaceAt: (): S => 'ground' };

describe('CollisionWorld', () => {
  const box: BoxCollider = { ...frame(5, 0, 0), hx: 0.5, hz: 2, yMin: 0, yMax: 2 };
  const deck: Platform<S> = { ...frame(0, 10, 0), hx: 2, hz: 2, height: () => 1.0, surface: 'wood' };
  const step: Platform<S> = { ...frame(0, -10, 0), hx: 2, hz: 2, height: () => 0.3, surface: 'wood' };
  const world = new CollisionWorld<S>(flat, [{ x: 0, z: 0, r: 1 }], [box], [deck, step]);
  const out = { x: 0, z: 0 };

  it('pushes the walker out of a circle', () => {
    world.resolve(0.5, 0, 0, 0.3, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1.3, 5);
  });

  it('pushes the walker out of a box only when heights overlap', () => {
    world.resolve(4.6, 0, 0, 0.3, out);
    expect(out.x).toBeCloseTo(4.2, 5);
    // Feet above the top of the box: no collision.
    world.resolve(4.6, 0, 2.5, 0.3, out);
    expect(out.x).toBeCloseTo(4.6, 5);
  });

  it('handles rotated boxes', () => {
    // A thin wall rotated 90°: its long side now runs along x.
    const wall: BoxCollider = { ...frame(0, 5, Math.PI / 2), hx: 0.1, hz: 3, yMin: 0, yMax: 2 };
    const w = new CollisionWorld<S>(flat, [], [wall], []);
    w.resolve(1, 5.2, 0, 0.3, out);
    expect(out.x).toBeCloseTo(1, 5);
    expect(out.z).toBeCloseTo(5.4, 5);
  });

  it('steps onto low platforms and is blocked by head-height ones', () => {
    const sup: Support<S> = { y: 0, surface: 'ground', onPlatform: false };
    expect(world.supportAt(0, -10, 0, sup)).toBe(true);
    expect(sup.y).toBeCloseTo(0.3);
    expect(sup.surface).toBe('wood');
    expect(0.3).toBeLessThan(STEP_UP);
    // 1 m deck from the ground: too high to step on, low enough to hit your head.
    expect(world.supportAt(0, 10, 0, sup)).toBe(false);
    // Standing on it already: fine.
    expect(world.supportAt(0, 10, 1.0, sup)).toBe(true);
    expect(sup.y).toBe(1.0);
  });
});

describe('IslandColliders', () => {
  const data = createWorldData();
  const c = new IslandColliders(data);
  const sup: Support<WalkSurface> = { y: 0, surface: 'sand', onPlatform: false };

  it('spawns on dry land outside the house', () => {
    const { x, z } = c.spawn;
    expect(data.heightmap.heightAt(x, z)).toBeGreaterThan(0);
    expect(c.shelterAt(x, z, data.heightmap.heightAt(x, z))).toBe('none');
  });

  it('can climb the steps to the porch and walk into the room', () => {
    const { x: hx, z: hz, rotY } = data.house.placement;
    const toWorld = (lx: number, lz: number): [number, number] => [
      hx + lx * Math.cos(rotY) + lz * Math.sin(rotY),
      hz - lx * Math.sin(rotY) + lz * Math.cos(rotY),
    ];
    // Walk from the spawn point up the steps (local +Z → −Z along x = 0) into the room.
    let feet = data.heightmap.heightAt(c.spawn.x, c.spawn.z);
    for (let lz = 7; lz >= -1; lz -= 0.05) {
      const [x, z] = toWorld(0, lz);
      expect(c.world.supportAt(x, z, feet, sup), `blocked at local z = ${lz.toFixed(2)}`).toBe(true);
      feet = sup.y;
    }
    expect(feet).toBeCloseTo(data.house.floorY, 5);
    const [x, z] = toWorld(0, -1);
    expect(c.shelterAt(x, z, feet)).toBe('room');
  });

  it('cannot walk under the house floor from the side', () => {
    const { x, z, rotY } = data.house.placement;
    const lx = 2.0;
    const wx = x + lx * Math.cos(rotY);
    const wz = z - lx * Math.sin(rotY);
    expect(c.world.supportAt(wx, wz, data.heightmap.heightAt(wx, wz), sup)).toBe(false);
  });
});

describe('spatialMix', () => {
  const l: ListenerState = { walking: true, shoreDistance: 0, seaSide: 1, trees: 0, shelter: 'none' };
  const out = { gain: 1, pan: 0, occlusion: 0 };

  it('is neutral in orbit mode', () => {
    expect(spatialMix('waves', { ...l, walking: false }, out)).toEqual({ gain: 1, pan: 0, occlusion: 0 });
  });

  it('makes waves louder at the shore than inland, panned toward the sea', () => {
    const shore = { ...spatialMix('waves', l, out) };
    const inland = { ...spatialMix('waves', { ...l, shoreDistance: 60 }, out) };
    expect(shore.gain).toBeGreaterThan(inland.gain * 3);
    expect(shore.pan).toBeGreaterThan(0.4);
  });

  it('makes birds louder in the forest', () => {
    expect(spatialMix('birds', { ...l, trees: 12 }, out).gain).toBeGreaterThan(spatialMix('birds', l, { ...out }).gain);
  });

  it('muffles rain indoors more than on the porch', () => {
    const room = { ...spatialMix('rain', { ...l, shelter: 'room' }, out) };
    const porch = { ...spatialMix('rain', { ...l, shelter: 'porch' }, out) };
    expect(room.occlusion).toBeGreaterThan(porch.occlusion);
    expect(room.gain).toBeLessThan(porch.gain);
  });
});
