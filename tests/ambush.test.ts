import { describe, expect, it } from 'vitest';
import { Health, MAX_HP } from '../src/core/health';
import { Ambush, type AmbushHost } from '../src/activities/ambush';
import type { Attacker } from '../src/activities/wildCreatures';

const sink = { emit: () => {}, drop: () => {}, blow: () => {} };

function attacker(): Attacker & { banished: number } {
  const a = {
    kind: 'dragon' as const,
    x: 8,
    y: 2,
    z: 0,
    banished: 0,
    gone: false,
    banish() {
      a.banished++;
      a.gone = true;
    },
  };
  return a;
}

function host(you: { x: number; y: number; z: number }, dog: { x: number; y: number; z: number } | null) {
  const log = { you: 0, dog: 0, countered: 0 };
  const h: AmbushHost = {
    fx: { flash: () => {}, shock: () => {}, shake: () => {}, vortex: () => {}, mark: () => {}, focus: () => {}, sound: () => {} },
    embers: sink,
    spores: sink,
    fluff: sink,
    spray: sink,
    bubbles: sink,
    heightAt: () => 0.5,
    you: () => you,
    dog: () => dog,
    hitYou: (_k, n) => (log.you += n),
    hitDog: (_k, n) => (log.dog += n),
    counter: (a) => {
      log.countered++;
      a.banish();
      return true;
    },
  };
  return { h, log };
}

function run(a: Ambush, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 30) {
    each?.();
    a.update(1 / 30);
  }
}

describe('forest ambushes', () => {
  it('a shot hits you if you stay; Mochi strikes back and drives the attacker off', () => {
    const you = { x: 0, y: 0.5, z: 0 };
    const { h, log } = host(you, null);
    const amb = new Ambush(h);
    const a = attacker();
    amb.attack(a);
    run(amb, 1.5);
    expect(log.you).toBeGreaterThanOrEqual(15);
    expect(log.you).toBeLessThanOrEqual(25);
    expect(log.countered).toBe(1);
    expect(a.banished).toBe(1);
  });

  it('running away dodges it', () => {
    const you = { x: 0, y: 0.5, z: 0 };
    const { h, log } = host(you, null);
    const amb = new Ambush(h);
    amb.attack(attacker());
    // Running at 4 m/s, sideways.
    run(amb, 1.5, () => (you.z += 4 / 30));
    expect(log.you).toBe(0);
  });

  it('health: hits, a faint at 0, back with time and on restore', () => {
    const downs: string[] = [];
    const hp = new Health((who) => downs.push(who));
    hp.hit('you', 30);
    expect(hp.hp.you).toBe(MAX_HP - 30);
    hp.update(3, false);
    expect(hp.hp.you).toBe(MAX_HP - 30);
    for (let t = 0; t < 10; t += 0.1) hp.update(0.1, false);
    expect(hp.hp.you).toBeGreaterThan(MAX_HP - 30);
    hp.hit('dog', 120);
    expect(downs).toEqual(['dog']);
    expect(hp.isDown('dog')).toBe(true);
    expect(hp.hit('dog', 10)).toBe(false);
    hp.restore('dog', 50);
    expect(hp.hp.dog).toBe(50);
    // Petting heals Mochi right away.
    hp.update(1, true);
    expect(hp.hp.dog).toBeGreaterThan(50);
  });
});
