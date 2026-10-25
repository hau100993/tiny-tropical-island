import { describe, expect, it } from 'vitest';
import { BubbleCrab } from '../src/world/creatures/bubbleCrab';
import { FireDragon } from '../src/world/creatures/fireDragon';
import { GrassBunny } from '../src/world/creatures/grassBunny';
import type { SkillFxSink } from '../src/world/creatures/skillFx';

const sink = { emit: () => {}, drop: () => {}, blow: () => {} };
/** Counts what the skills ask of the shared effects. */
function fxLog(): SkillFxSink & { shocks: number; flashes: number } {
  const log = {
    shocks: 0,
    flashes: 0,
    flash: () => log.flashes++,
    shock: () => log.shocks++,
    shake: () => {},
    vortex: () => {},
    mark: () => {},
    focus: () => {},
    sound: () => {},
  };
  return log;
}
const flat = (x: number, z: number): number => (Math.hypot(x, z) < 30 ? 0.5 : -1);

/** Runs a brain until its skill is done (s), with you standing near. */
function settle(step: (dt: number) => void, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30);
}

describe('creature skills: each key press starts the next one', () => {
  it('Bọt: jet, bubble shower, geyser, then the jet again; a press while busy is ignored', () => {
    let soaked = 0;
    const fx = fxLog();
    let bubble = 0;
    const cards: string[] = [];
    const crab = new BubbleCrab(
      {
        heightAt: flat, seaRadius: () => 30, ripple: () => {}, spray: sink, bubbles: sink, rainbow: sink, daylight: () => 1, fx,
        big: { set: (_x, _y, _z, r) => (bubble = Math.max(bubble, r)) },
      },
      { x: 10, z: 0 },
      { onSquirt: () => {}, onVoice: () => {}, onHitPlayer: () => soaked++, onSkill: (s) => cards.push(s) },
    );
    const you = { x: 12, z: 0, y: 0.5 };
    const mouth = { x: 10, y: 0.6, z: 0 };
    const got: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      got.push(crab.command());
      expect(crab.command()).toBeNull();
      settle((dt) => crab.update(dt, you, mouth), 8);
    }
    expect(got).toEqual(['jet', 'bubbles', 'geyser', 'jet']);
    expect(cards).toEqual(got);
    // The giant bubble was blown, and burst (and the geyser broke out) with flashes and shock waves.
    expect(bubble).toBeGreaterThan(1);
    expect(fx.flashes).toBeGreaterThanOrEqual(2);
    expect(fx.shocks).toBeGreaterThan(4);
    // The geyser comes up under you when you stand near: it soaks you.
    expect(soaked).toBeGreaterThan(0);
  });

  it('Hỏa Long: breath, ring of fire, meteor shower; the meteors burst on the ground', () => {
    let booms = 0;
    const dragon = new FireDragon(
      { heightAt: flat, seaRadius: () => 30, ripple: () => {}, embers: sink, steam: sink, fx: fxLog() },
      { x: 10, z: 0 },
      { onBreath: () => {}, onBoom: () => booms++, onVoice: () => {}, onHitPlayer: () => {}, onSkill: () => {} },
    );
    const you = { x: 13, z: 0, y: 0.5 };
    const at = { x: 10, y: 3, z: 0 };
    const dir = { x: 0, y: 0, z: 1 };
    const got: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      got.push(dragon.command());
      settle((dt) => dragon.update(dt, you, at, dir), 12);
    }
    expect(got).toEqual(['breath', 'ring', 'meteors']);
    expect(booms).toBe(10);
  });

  it('Mầm: leaves, the tornado dance (flowers spring up at the end), the dandelion gust', () => {
    const fx = fxLog();
    let flowers = 0;
    const leaves = { fire: () => {}, aim: () => {} };
    const bunny = new GrassBunny(
      // (LeafStorm: only what the brain calls.)
      { heightAt: flat, house: { x: 50, z: 50 }, leaves: leaves as never, spores: sink, fluff: sink, breeze: () => ({ x: 0, z: 0 }), fx, bloom: () => flowers++ },
      { x: 10, z: 0 },
      { onThrow: () => {}, onVoice: () => {}, onSkill: () => {} },
    );
    const you = { x: 12, z: 0, y: 0.5 };
    const bud = { x: 10, y: 0.8, z: 0 };
    const got: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      got.push(bunny.command());
      settle((dt) => bunny.update(dt, you, bud), 9);
    }
    expect(got).toEqual(['leaves', 'dance', 'dandelion']);
    expect(flowers).toBeGreaterThan(20);
    expect(fx.flashes).toBe(2);
  });
});
