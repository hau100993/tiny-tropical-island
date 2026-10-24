import { describe, expect, it } from 'vitest';
import { BubbleCrab } from '../src/world/creatures/bubbleCrab';
import { FireDragon } from '../src/world/creatures/fireDragon';

const sink = { emit: () => {}, drop: () => {}, blow: () => {} };
const flat = (x: number, z: number): number => (Math.hypot(x, z) < 30 ? 0.5 : -1);

/** Runs a brain until its skill is done (s), with you standing near. */
function settle(step: (dt: number) => void, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 30) step(1 / 30);
}

describe('creature skills: each key press starts the next one', () => {
  it('Bọt: jet, bubble shower, geyser, then the jet again; a press while busy is ignored', () => {
    let soaked = 0;
    const crab = new BubbleCrab(
      { heightAt: flat, seaRadius: () => 30, ripple: () => {}, spray: sink, bubbles: sink, rainbow: sink, daylight: () => 1 },
      { x: 10, z: 0 },
      { onSquirt: () => {}, onVoice: () => {}, onHitPlayer: () => soaked++ },
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
    // The geyser comes up under you when you stand near: it soaks you.
    expect(soaked).toBeGreaterThan(0);
  });

  it('Hỏa Long: breath, ring of fire, meteor shower; the meteors burst on the ground', () => {
    let booms = 0;
    const dragon = new FireDragon(
      { heightAt: flat, seaRadius: () => 30, ripple: () => {}, embers: sink, steam: sink },
      { x: 10, z: 0 },
      { onBreath: () => {}, onBoom: () => booms++, onVoice: () => {}, onHitPlayer: () => {} },
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
    expect(booms).toBe(7);
  });
});
