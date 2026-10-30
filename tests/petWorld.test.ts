import { describe, expect, it } from 'vitest';
import { Ceremonies } from '../src/world/pets/ceremony';
import { RecipeRunner, recipeLength } from '../src/world/pets/recipes';
import { standInBody } from '../src/world/pets/bodies';
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
  it('each egg species has a stand-in that animates', () => {
    for (const s of EGG_SPECIES) {
      for (const level of [1, 2] as const) {
        const body = standInBody(s, { seed: 42, shiny: level === 2, level });
        for (const a of ['idle', 'move', 'greet', 'dance', 'skill'] as const) body.animate(0.05, a, 0.5, 0.3);
        expect(body.head).toBeGreaterThan(0);
        expect(body.root.children.length).toBeGreaterThan(0);
      }
    }
  });

  it('follows you, and walkers stay out of the sea', () => {
    const land = (x: number): number => (x < 10 ? 1 : -1);
    const body = standInBody('kimquy', { seed: 1, shiny: false, level: 1 });
    const a = new PetActor('p', body, { heightAt: (x) => land(x) }, { x: 0, z: 0 }, 0, { x: 0, z: 0 });
    for (let i = 0; i < 400; i++) a.update(0.05, { x: 6, z: 0, yaw: Math.PI / 2 }, 0);
    expect(Math.hypot(a.x - 6, a.z)).toBeLessThan(3.5);
    // You wade out: the turtle waits on the beach.
    for (let i = 0; i < 400; i++) a.update(0.05, { x: 16, z: 0, yaw: Math.PI / 2 }, 0);
    expect(a.x).toBeLessThan(10);
  });

  it('ten following you keep their own places behind you, apart; flyers beside and above', () => {
    const species = ['deer', 'na', 'frog', 'bee', 'tiger', 'seahorse', 'spider', 'cloudDragon', 'kind8', 'kimquy'] as const;
    const actors = species.map((s, i) => new PetActor(s, standInBody(s, { seed: i, shiny: false, level: 1 }), { heightAt: () => 1 }, { x: 0, z: 0 }, i, { x: 0, z: 0 }));
    // You at the origin facing +z: behind you is −z.
    const you = { x: 0, z: 0, yaw: 0 };
    for (let k = 0; k < 600; k++) {
      for (const a of actors) a.update(0.05, you, 0);
      for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) PetActor.separate(actors[i], actors[j], 0.05);
    }
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) expect(Math.hypot(actors[i].x - actors[j].x, actors[i].z - actors[j].z)).toBeGreaterThan(0.7);
      // None in front of you.
      expect(actors[i].z, species[i]).toBeLessThan(0.5);
    }
    for (const a of actors.filter((x) => x.body.hover > 0)) {
      expect(Math.abs(a.x)).toBeGreaterThan(1.5);
      expect(a.y).toBeGreaterThan(1 + 1.75);
    }
  });
});

describe('wild visitors', () => {
  async function world(over: Partial<{ rain: number; day: number; trees: number; surface: string; height: number }>) {
    const THREE = await import('three');
    const { WildVisitors } = await import('../src/world/pets/wildVisitors');
    const o = { rain: 0, day: 1, trees: 0, surface: 'grass', height: 1, ...over };
    let sparkles = 0;
    const scene = new THREE.Scene();
    const v = new WildVisitors({
      scene,
      heightAt: () => o.height,
      surfaceAt: () => o.surface,
      treesNear: () => o.trees,
      daylight: () => o.day,
      rain: () => o.rain,
      house: { x: 1000, z: 1000 },
      body: async (kind) => standInBody(kind, { seed: 1, shiny: false, level: 1 }),
      compile: async () => undefined,
      sparkle: () => sparkles++,
    });
    const run = async (seconds: number, you: { x: number; z: number } | null) => {
      for (let t = 0; t < seconds; t += 0.1) {
        v.update(0.1, you);
        await Promise.resolve();
      }
    };
    const seen = () => {
      const out: { kind: string; x: number; z: number; fed(): void; join(): void }[] = [];
      v.watchers(out as never);
      return out;
    };
    /** Walks about until one shows up (or `max` s go by). */
    const wait = async (you: { x: number; z: number }, max = 120) => {
      for (let t = 0; t < max && seen().length === 0; t += 1) await run(1, you);
      return seen();
    };
    return { v, run, seen, wait, sparkles: () => sparkles };
  }

  it('a frog shows up on the sand in the rain, not in fine weather', async () => {
    const dry = await world({ surface: 'sand', height: 0.5, rain: 0 });
    expect(await dry.wait({ x: 0, z: 0 })).toHaveLength(0);
    const wet = await world({ surface: 'sand', height: 0.5, rain: 0.8 });
    expect((await wet.wait({ x: 0, z: 0 })).map((s) => s.kind)).toEqual(['frog']);
  });

  it('a spider at night in the forest; it slips away when you come close', async () => {
    const w = await world({ day: 0.05, trees: 9 });
    const [s] = await w.wait({ x: 0, z: 0 });
    expect(s?.kind).toBe('spider');
    await w.run(2, { x: s.x, z: s.z });
    expect(w.seen()).toHaveLength(0);
    expect(w.sparkles()).toBeGreaterThan(0);
  });

  it('befriended: it leaves in sparkles', async () => {
    const w = await world({ day: 0.9, surface: 'grass', trees: 0 });
    const [b] = await w.wait({ x: 0, z: 0 });
    expect(b?.kind).toBe('bee');
    b.fed();
    b.join();
    await w.run(2, { x: 0, z: 0 });
    expect(w.seen()).toHaveLength(0);
  });
});
