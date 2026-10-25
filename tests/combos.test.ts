import { describe, expect, it } from 'vitest';
import { Combos, comboOf, type ComboHost, type Partner } from '../src/activities/combos';
import type { Lightning } from '../src/world/creatures/lightning';

const sink = { emit: () => {}, drop: () => {} };

function host(partners: Partner[] = []): { h: ComboHost; cards: string[] } {
  const cards: string[] = [];
  const h: ComboHost = {
    fx: { flash: () => {}, shock: () => {}, shake: () => {}, vortex: () => {}, mark: () => {}, focus: () => {}, sound: () => {} },
    // (Only strike is called.)
    lightning: { strike: () => {} } as unknown as Lightning,
    embers: sink,
    steam: sink,
    spores: sink,
    rainbow: sink,
    spray: sink,
    heightAt: () => 0.5,
    bloom: () => {},
    ripple: () => {},
    stage: () => null,
    viewer: () => ({ x: 0, z: 10 }),
    partners: () => partners,
    card: (id) => cards.push(id),
  };
  return { h, cards };
}

describe('combos', () => {
  it('every pair of different elements has its own combo, the same element none', () => {
    expect(comboOf('fire', 'water')).toBe('steamRainbow');
    expect(comboOf('water', 'fire')).toBe('steamRainbow');
    expect(comboOf('grass', 'fire')).toBe('fireBloom');
    expect(comboOf('water', 'grass')).toBe('flowerRain');
    expect(comboOf('spark', 'water')).toBe('stormColumn');
    expect(comboOf('fire', 'spark')).toBe('thunderFire');
    expect(comboOf('spark', 'grass')).toBe('glowMeadow');
    expect(comboOf('fire', 'fire')).toBeNull();
  });

  it('two skills within 1.5 s make a combo, then not again for a while; farther apart, none', () => {
    const { h, cards } = host();
    const c = new Combos(h);
    c.note('water', 0, 0);
    c.update(1);
    c.note('fire', 5, 0);
    expect(cards).toEqual(['steamRainbow']);
    for (let t = 0; t < 3; t += 0.1) c.update(0.1);
    c.note('grass', 0, 0);
    expect(cards).toEqual(['steamRainbow']);
    for (let t = 0; t < 10; t += 0.1) c.update(0.1);
    c.note('grass', 0, 0);
    c.update(2);
    c.note('fire', 0, 0);
    expect(cards).toEqual(['steamRainbow']);
  });

  it('a neighbour of another element sometimes joins in', () => {
    let joined = 0;
    const { h } = host([{ element: 'fire', x: 3, z: 0, start: () => (joined++, true) }]);
    const c = new Combos(h);
    for (let i = 0; i < 200; i++) {
      c.note('water', 0, 0);
      c.update(2);
    }
    // ~30 %.
    expect(joined).toBeGreaterThan(30);
    expect(joined).toBeLessThan(100);
  });
});
