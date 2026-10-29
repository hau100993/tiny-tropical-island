import { describe, expect, it } from 'vitest';
import { Ceremonies } from '../src/world/pets/ceremony';
import { RecipeRunner, recipeLength } from '../src/world/pets/recipes';
import { buildBody } from '../src/world/pets/bodies';
import { PetActor } from '../src/world/pets/PetActor';
import type { SkillFxSink } from '../src/world/creatures/skillFx';
import { EGG_SPECIES, SPECIES } from '../src/pets/species';

/** Counts every call made to the effects. */
function fakeFx(): SkillFxSink & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (k: string) => () => {
    calls[k] = (calls[k] ?? 0) + 1;
  };
  return { calls, flash: count('flash'), shock: count('shock'), shake: count('shake'), vortex: count('vortex'), mark: count('mark'), focus: count('focus'), sound: count('sound') };
}

const sink = { n: 0, emit() { this.n++; }, drop() { this.n++; }, blow() { this.n++; } };

describe('pet ceremonies', () => {
  it('a hatching bursts once, then runs its callback and ends', () => {
    const c = new Ceremonies(fakeFx(), sink);
    let done = 0;
    c.hatch(0, 0, 0, 0xffffff, true, () => done++);
    for (let i = 0; i < 100 && c.busy; i++) c.update(0.05);
    expect(done).toBe(1);
    expect(c.busy).toBe(false);
  });

  it('an evolution does the same', () => {
    const fx = fakeFx();
    const c = new Ceremonies(fx, sink);
    let done = 0;
    c.evolve(0, 0, 0, 0xff0000, () => done++);
    for (let i = 0; i < 100 && c.busy; i++) c.update(0.05);
    expect(done).toBe(1);
    expect(fx.calls.flash).toBe(1);
  });
});

describe('recipe skills', () => {
  it('every skill runs to its end without errors and uses the effects', () => {
    const names = [...EGG_SPECIES.flatMap((s) => SPECIES[s].skills), ...(['dog', 'crab', 'dragon', 'bunny', 'shark'] as const).flatMap((s) => SPECIES[s].skills.slice(3))];
    for (const name of names) {
      const fx = fakeFx();
      const runner = new RecipeRunner({
        fx,
        pools: { embers: sink, steam: sink, spores: sink, fluff: sink, rainbow: sink, spray: sink, bubbles: sink, bloom() {} },
        heightAt: () => 1,
        ripple() {},
      });
      expect(runner.cast(name, { x: 0, y: 1, z: 0, yaw: 0 }, 'fire', 1.5), name).toBe(true);
      const end = recipeLength(name);
      let t = 0;
      while (runner.busy && t < end + 5) {
        runner.update(0.05);
        t += 0.05;
      }
      expect(runner.busy, name).toBe(false);
      expect(Object.keys(fx.calls).length, name).toBeGreaterThan(0);
    }
  });
});

describe('new pets', () => {
  it('each egg species builds at both Levels and animates', () => {
    for (const s of EGG_SPECIES) {
      for (const level of [1, 2] as const) {
        const body = buildBody(s, { seed: 42, shiny: level === 2, level });
        for (const a of ['idle', 'move', 'greet', 'dance', 'skill'] as const) body.animate(0.05, a, 0.5, 0.3);
        expect(body.head).toBeGreaterThan(0);
        expect(body.root.children.length).toBeGreaterThan(0);
      }
    }
  });

  it('follows you, and walkers stay out of the sea', () => {
    const land = (x: number): number => (x < 10 ? 1 : -1);
    const body = buildBody('turtle', { seed: 1, shiny: false, level: 1 });
    const a = new PetActor('p', body, { heightAt: (x) => land(x) }, { x: 0, z: 0 }, 0, { x: 0, z: 0 });
    for (let i = 0; i < 400; i++) a.update(0.05, { x: 6, z: 0 }, 0);
    expect(Math.hypot(a.x - 6, a.z)).toBeLessThan(3.5);
    // You wade out: the turtle waits on the beach.
    for (let i = 0; i < 400; i++) a.update(0.05, { x: 16, z: 0 }, 0);
    expect(a.x).toBeLessThan(10);
  });
});
