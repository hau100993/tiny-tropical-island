import { describe, expect, it } from 'vitest';
import { defaultMixerState, parseMixerState } from '../src/audio/mixerState';
import { generateBrown, generateDroplets, generatePink, makeSeamless } from '../src/audio/noiseBuffers';
import { createRng } from '../src/core/rng';

describe('parseMixerState', () => {
  it('falls back to defaults for garbage', () => {
    expect(parseMixerState(null)).toEqual(defaultMixerState());
    expect(parseMixerState('x')).toEqual(defaultMixerState());
  });

  it('keeps valid values, clamps volumes, repairs bad fields', () => {
    const s = parseMixerState({
      master: { volume: 2, muted: true },
      layers: { rain: { volume: 0.3, enabled: true, muted: 'no' }, birds: 'broken' },
    });
    expect(s.master).toEqual({ volume: 1, muted: true });
    expect(s.layers.rain).toEqual({ volume: 0.3, enabled: true, muted: false });
    expect(s.layers.birds).toEqual(defaultMixerState().layers.birds);
  });
});

describe('noise buffers', () => {
  it('makeSeamless makes both ends meet so loops do not click', () => {
    const data = makeSeamless(new Float32Array([0, 1, 2, 3, 4]));
    expect(data[0]).toBeCloseTo(data[4], 6);
  });

  it('pink and brown loops are seamless and within [-1, 1]', () => {
    for (const gen of [generatePink, generateBrown]) {
      const d = gen(48000, createRng(3));
      expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThan(1e-5);
      let max = 0;
      for (const v of d) max = Math.max(max, Math.abs(v));
      expect(max).toBeLessThanOrEqual(1);
      expect(max).toBeGreaterThan(0.05);
    }
  });

  it('droplets are normalized to the target peak', () => {
    const [l, r] = generateDroplets(8000, 1, 50, createRng(5));
    let max = 0;
    for (let i = 0; i < l.length; i++) max = Math.max(max, Math.abs(l[i]), Math.abs(r[i]));
    expect(max).toBeCloseTo(0.9, 5);
  });
});
