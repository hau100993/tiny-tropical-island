import { describe, expect, it } from 'vitest';
import { overcast, particleAmounts, stepAccumulation, WET_SECONDS, type Accumulation } from '../src/weather/accumulation';
import { gustShape } from '../src/weather/wind';

/** Runs the accumulation for `seconds` in 0.1 s steps. */
function run(start: Accumulation, rain: number, snow: number, seconds: number): Accumulation {
  let s = start;
  for (let t = 0; t < seconds; t += 0.1) s = stepAccumulation(s, rain, snow, 0.1);
  return s;
}

const DRY: Accumulation = { wetness: 0, snowCover: 0 };

describe('weather accumulation', () => {
  it('heavy rain soaks surfaces in about WET_SECONDS, then they dry slowly', () => {
    const wet = run(DRY, 1, 0, WET_SECONDS + 1);
    expect(wet.wetness).toBeCloseTo(1, 2);
    const later = run(wet, 0, 0, 30);
    expect(later.wetness).toBeGreaterThan(0.6);
    expect(later.wetness).toBeLessThan(1);
  });

  it('wetness never exceeds the rain intensity from rain alone', () => {
    expect(run(DRY, 0.4, 0, 300).wetness).toBeCloseTo(0.4, 3);
  });

  it('snow settles when it dominates, and melts (wetting things) when rain takes over', () => {
    const snowy = run(DRY, 0, 1, 120);
    expect(snowy.snowCover).toBe(1);
    const thawing = run(snowy, 0.8, 0, 20);
    expect(thawing.snowCover).toBeLessThan(1);
    expect(thawing.wetness).toBeGreaterThan(0.3);
  });

  it('sleet (equal rain and snow) does not build snow cover', () => {
    expect(run(DRY, 0.6, 0.6, 200).snowCover).toBe(0);
  });

  it('values stay within [0, 1]', () => {
    let s = DRY;
    for (let i = 0; i < 2000; i++) {
      s = stepAccumulation(s, Math.random(), Math.random(), Math.random());
      expect(s.wetness).toBeGreaterThanOrEqual(0);
      expect(s.wetness).toBeLessThanOrEqual(1);
      expect(s.snowCover).toBeGreaterThanOrEqual(0);
      expect(s.snowCover).toBeLessThanOrEqual(1);
    }
  });

  it('rain and snow together thin each other out instead of stacking', () => {
    const both = particleAmounts(1, 1);
    expect(both.rain).toBeLessThan(1);
    expect(both.snow).toBeLessThan(1);
    expect(particleAmounts(1, 0)).toEqual({ rain: 1, snow: 0 });
  });

  it('overcast follows the strongest weather', () => {
    expect(overcast(0, 0, 0)).toBe(0);
    expect(overcast(1, 0, 0)).toBe(1);
    expect(overcast(0, 0, 1)).toBeLessThan(0.5);
  });
});

describe('gustShape', () => {
  it('stays in [0.2, 1] and actually varies', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 600; t += 0.25) {
      const g = gustShape(t);
      min = Math.min(min, g);
      max = Math.max(max, g);
    }
    expect(min).toBeGreaterThanOrEqual(0.2);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.5);
  });

  it('is smooth (no jumps between frames)', () => {
    for (let t = 0; t < 300; t += 1 / 60) {
      expect(Math.abs(gustShape(t + 1 / 60) - gustShape(t))).toBeLessThan(0.05);
    }
  });
});
