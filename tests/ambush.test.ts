import { describe, expect, it } from 'vitest';
import { Health, MAX_HP } from '../src/core/health';
import { Ambush, type AmbushHost } from '../src/activities/ambush';
import type { Attacker } from '../src/activities/wildCreatures';

const sink = { emit: () => {}, drop: () => {}, blow: () => {} };

function attacker(): Attacker & { banished: number; left: number; casts: number } {
  const a = {
    kind: 'dragon' as const,
    x: 8,
    y: 2,
    z: 0,
    banished: 0,
    left: 0,
    casts: 0,
    gone: false,
    banish() {
      a.banished++;
      a.gone = true;
    },
    leave() {
      a.left++;
      a.gone = true;
    },
    cast() {
      a.casts++;
    },
  };
  return a;
}

type P = { x: number; y: number; z: number };

function host(you: P, dog: P | null) {
  const log = { splashed: 0, dogHurt: 0, counters: 0, guards: [] as [number, number][] };
  const state = { dog };
  const h: AmbushHost = {
    fx: { flash: () => {}, shock: () => {}, shake: () => {}, vortex: () => {}, mark: () => {}, focus: () => {}, sound: () => {} },
    embers: sink,
    spores: sink,
    fluff: sink,
    spray: sink,
    bubbles: sink,
    heightAt: () => 0.5,
    you: () => you,
    dog: () => state.dog,
    guard: (x, z) => {
      log.guards.push([x, z]);
      return true;
    },
    splashYou: () => log.splashed++,
    hitDog: (_k, n) => (log.dogHurt += n),
    counter: (_a, hit) => {
      log.counters++;
      hit();
      return true;
    },
  };
  return { h, log, state };
}

function run(a: Ambush, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += 1 / 30) {
    each?.();
    a.update(1 / 30);
  }
}

describe('forest fights', () => {
  it('Mochi stands guard between you and it, and takes 2–3 strikes to drive it off', () => {
    const you = { x: 0, y: 0.5, z: 0 };
    const { h, log } = host(you, { x: 1, y: 0.5, z: 1 });
    const amb = new Ambush(h);
    const a = attacker();
    amb.windup(a);
    amb.update(1 / 30);
    // In front of you, toward the attacker (at x = 8): 1.5 m along +x.
    expect(log.guards[0][0]).toBeCloseTo(1.5);
    expect(log.guards[0][1]).toBeCloseTo(0);
    amb.attack(a);
    run(amb, 8);
    expect(a.banished).toBe(1);
    expect(log.counters).toBeGreaterThanOrEqual(2);
    expect(log.counters).toBeLessThanOrEqual(3);
    expect(amb.fighting).toBe(false);
  });

  it('a shot that hits you only splashes; running dodges it', () => {
    const you = { x: 0, y: 0.5, z: 0 };
    const { h, log } = host(you, null);
    const amb = new Ambush(h);
    amb.attack(attacker());
    run(amb, 1.2);
    expect(log.splashed).toBe(1);
    const run2 = host({ x: 0, y: 0.5, z: 0 }, null);
    const amb2 = new Ambush(run2.h);
    amb2.attack(attacker());
    const me = run2.h.you() as P;
    run(amb2, 1.2, () => (me.z += 4 / 30));
    expect(run2.log.splashed).toBe(0);
  });

  it('Mochi down: it has won and slips away; with no Mochi at all it gives up after a few shots', () => {
    const { h, state } = host({ x: 0, y: 0.5, z: 0 }, { x: 1.5, y: 0.5, z: 0 });
    // (Mochi can't strike in this one: it only takes the shots.)
    h.counter = () => false;
    const amb = new Ambush(h);
    const a = attacker();
    amb.attack(a);
    run(amb, 1);
    state.dog = null;
    run(amb, 0.1);
    expect(a.left).toBe(1);
    const alone = host({ x: 0, y: 0.5, z: 0 }, null);
    const amb2 = new Ambush(alone.h);
    const b = attacker();
    amb2.attack(b);
    run(amb2, 8);
    expect(b.left).toBe(1);
  });

  it("Mochi's health: hits, down at 0, back with time, faster while stroked", () => {
    let downs = 0;
    const hp = new Health(() => downs++);
    hp.hit(30);
    expect(hp.hp).toBe(MAX_HP - 30);
    hp.update(3, false);
    expect(hp.hp).toBe(MAX_HP - 30);
    for (let t = 0; t < 10; t += 0.1) hp.update(0.1, false);
    expect(hp.hp).toBeGreaterThan(MAX_HP - 30);
    hp.hit(200);
    expect(downs).toBe(1);
    expect(hp.isDown).toBe(true);
    expect(hp.hit(10)).toBe(false);
    hp.restore(50);
    hp.update(1, true);
    expect(hp.hp).toBeGreaterThan(50);
  });
});
