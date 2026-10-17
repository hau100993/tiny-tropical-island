import { describe, expect, it } from 'vitest';
import { defaultMixerState, parseMixerState } from '../src/audio/mixerState';
import { BUILT_IN_PRESETS, parseUserPresets, sanitizePresetName, MAX_USER_PRESETS } from '../src/audio/presets';
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

describe('presets', () => {
  it('built-ins have unique ids and valid mixes', () => {
    const ids = new Set(BUILT_IN_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(BUILT_IN_PRESETS.length);
    for (const p of BUILT_IN_PRESETS) expect(parseMixerState(p.mixer)).toEqual(p.mixer);
  });

  it('storm turns rain on and birds off', () => {
    const storm = BUILT_IN_PRESETS.find((p) => p.id === 'storm');
    expect(storm?.mixer.layers.rain.enabled).toBe(true);
    expect(storm?.mixer.layers.birds.enabled).toBe(false);
  });

  it('sanitizes names', () => {
    expect(sanitizePresetName('   ')).toBeNull();
    expect(sanitizePresetName('  Mưa   đêm  ')).toBe('Mưa đêm');
    expect(sanitizePresetName('x'.repeat(100))?.length).toBe(32);
  });

  it('drops invalid stored presets and caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: `P${i}`, mixer: {}, waveStrength: 0.5 }));
    expect(parseUserPresets([{ id: 1 }, { id: 'a', name: '' }, ...many]).length).toBe(MAX_USER_PRESETS);
    expect(parseUserPresets('nope')).toEqual([]);
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
