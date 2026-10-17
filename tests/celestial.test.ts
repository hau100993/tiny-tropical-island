import { describe, expect, it } from 'vitest';
import {
  advanceTime,
  createPalette,
  dayLight,
  formatClock,
  moonDirection,
  nightness,
  paletteFor,
  sunDirection,
} from '../src/world/celestial';

describe('sun and moon', () => {
  it('sun rises in the east at 6, is highest at noon, sets in the west at 18', () => {
    const dawn = sunDirection(6);
    const noon = sunDirection(12);
    const dusk = sunDirection(18);
    expect(dawn.y).toBeCloseTo(0, 5);
    expect(dawn.x).toBeGreaterThan(0.9);
    expect(dusk.x).toBeLessThan(-0.9);
    expect(noon.y).toBeGreaterThan(0.9);
    expect(sunDirection(0).y).toBeLessThan(-0.9);
  });

  it('the moon is up at midnight and down at noon', () => {
    expect(moonDirection(0).y).toBeGreaterThan(0.8);
    expect(moonDirection(12).y).toBeLessThan(-0.8);
  });
});

describe('palette', () => {
  it('changes smoothly with sun elevation (no jumps between keys)', () => {
    const a = createPalette();
    const b = createPalette();
    for (let e = -0.4; e < 0.5; e += 0.002) {
      paletteFor(e, a);
      paletteFor(e + 0.002, b);
      expect(Math.abs(a.top.r - b.top.r) + Math.abs(a.horizon.g - b.horizon.g)).toBeLessThan(0.05);
      expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.1);
    }
  });

  it('night is dark and day is bright', () => {
    const night = paletteFor(-0.5, createPalette());
    const day = paletteFor(0.8, createPalette());
    expect(night.top.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.05);
    expect(day.sunIntensity).toBeGreaterThan(2);
    expect(dayLight(-1)).toBeGreaterThan(0);
    expect(dayLight(1)).toBe(1);
    expect(nightness(-1)).toBe(1);
    expect(nightness(0.5)).toBe(0);
  });
});

describe('time', () => {
  it('cycle modes compress a day into 24 or 6 minutes and wrap at midnight', () => {
    expect(advanceTime(10, 'cycle24', 60, new Date())).toBeCloseTo(11, 5);
    expect(advanceTime(10, 'cycle6', 15, new Date())).toBeCloseTo(11, 5);
    expect(advanceTime(23.9, 'cycle24', 60, new Date())).toBeCloseTo(0.9, 5);
    expect(advanceTime(7.25, 'paused', 100, new Date())).toBe(7.25);
  });

  it('real mode follows the clock', () => {
    expect(advanceTime(0, 'real', 0, new Date(2026, 9, 17, 14, 30, 0))).toBeCloseTo(14.5, 5);
  });

  it('formats hours as hh:mm', () => {
    expect(formatClock(6.5)).toBe('06:30');
    expect(formatClock(23.99)).toBe('23:59');
  });
});
