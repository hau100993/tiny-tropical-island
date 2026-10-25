import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DogSkills, type DogSkillHost, type StrikeTarget } from '../src/activities/dogSkills';
import type { DogCompanion } from '../src/activities/dogCompanion';
import type { Lightning } from '../src/world/creatures/lightning';
import { Scorcher } from '../src/world/scorch';
import { KNOCK, knockLevel } from '../src/core/knock';

const sink = { emit: () => {} };

/** A dog that stands where it is and does what it is told (only what DogSkills uses). */
function fakeDog(): DogCompanion & { acting: number } {
  const d = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    acting: 0,
    busy: false,
    act(time: number) {
      d.acting = time;
      return true;
    },
  };
  // (Only the members DogSkills reads are there.)
  return d as unknown as DogCompanion & { acting: number };
}

function host(you: { x: number; y: number; z: number } | null, targets: StrikeTarget[]) {
  const log = { knocked: 0, bolts: 0, cards: [] as string[], startled: 0 };
  const scorch = new Scorcher();
  const dog = fakeDog();
  const h: DogSkillHost = {
    dog: () => dog,
    head: (out) => out.set(0, 0.6, 0),
    player: () => you,
    knockDown: () => {
      log.knocked++;
      return true;
    },
    targets: (_x, _z, _r, out) => out.push(...targets),
    startle: () => log.startled++,
    heightAt: () => 0.5,
    ripple: () => {},
    fx: { flash: () => {}, shock: () => {}, shake: () => {}, vortex: () => {}, mark: () => {}, focus: () => {}, sound: () => {} },
    // (Only strike is called.)
    lightning: { strike: () => log.bolts++ } as unknown as Lightning,
    scorch,
    sparks: sink,
    smoke: sink,
    dust: sink,
    card: (s) => log.cards.push(s),
  };
  return { h, log, scorch };
}

function run(skills: DogSkills, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 30) skills.update(1 / 30);
}

describe("Mochi's skills", () => {
  it('J cycles: zoomies, bark, lightning; a press while one runs is ignored', () => {
    const { h, log } = host({ x: 3, y: 0.5, z: 0 }, []);
    const skills = new DogSkills(h);
    expect(skills.next(() => true)).toBe('zoom');
    expect(skills.next(() => true)).toBe('bark');
    expect(skills.next(() => true)).toBeNull();
    run(skills, 2);
    expect(skills.next(() => true)).toBe('zap');
    expect(log.cards).toEqual(['zoom', 'bark', 'zap']);
  });

  it('the bark knocks you over within 8 m, not farther', () => {
    const near = host({ x: 5, y: 0.5, z: 0 }, []);
    const a = new DogSkills(near.h);
    a.next(() => false);
    a.next(() => false);
    run(a, 2);
    expect(near.log.knocked).toBe(1);
    expect(near.log.startled).toBe(1);
    const far = host({ x: 12, y: 0.5, z: 0 }, []);
    const b = new DogSkills(far.h);
    b.next(() => false);
    b.next(() => false);
    run(b, 2);
    expect(far.log.knocked).toBe(0);
  });

  it('the lightning strikes four times, scorches what it hits, and its colour comes back', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x80c0ff });
    const body = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    const { h, log, scorch } = host({ x: 3, y: 0.5, z: 0 }, [{ x: 3, y: 1.7, z: 0, kind: 'you', body }]);
    const skills = new DogSkills(h);
    skills.next(() => false);
    skills.next(() => false);
    run(skills, 2);
    skills.next(() => false);
    run(skills, 3);
    // Each strike is two strokes; the charge adds little arcs.
    expect(log.bolts).toBeGreaterThanOrEqual(8);
    scorch.update(1);
    expect(mat.color.r).toBeLessThan(0.2);
    for (let t = 0; t < 6; t += 0.1) scorch.update(0.1);
    expect(mat.color.getHex()).toBe(0x80c0ff);
  });

  it('knocked over: down within the fall, lying, then up again', () => {
    expect(knockLevel(-1)).toBe(0);
    expect(knockLevel(KNOCK.fall)).toBe(1);
    expect(knockLevel(KNOCK.fall + KNOCK.lie / 2)).toBe(1);
    expect(knockLevel(KNOCK.fall + KNOCK.lie + KNOCK.rise)).toBe(0);
    expect(knockLevel(KNOCK.fall / 2)).toBeLessThan(0.5);
  });
});
