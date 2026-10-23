import { describe, expect, it } from 'vitest';
import {
  advanceTime,
  createPalette,
  dayLight,
  formatClock,
  formatClockSeconds,
  moonDirection,
  nightness,
  paletteFor,
  SUN_RADIUS,
  sunDirection,
  sunGlintElevation,
  sunGlintScale,
  sunVisibleFraction,
  windowSkyTurn,
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

  it('a sky turn rotates sun and moon around the vertical only', () => {
    const a = sunDirection(17.7);
    const b = sunDirection(17.7, undefined, Math.PI / 2);
    expect(b.y).toBeCloseTo(a.y, 6);
    const d = Math.atan2(b.z, b.x) - Math.atan2(a.z, a.x);
    expect(Math.atan2(Math.sin(d), Math.cos(d))).toBeCloseTo(Math.PI / 2, 6);
    const m = moonDirection(19, undefined, -1);
    expect(m.y).toBeCloseTo(moonDirection(19).y, 6);
    expect(m.length()).toBeCloseTo(1, 6);
  });

  it('aims the sun, or at night the moon, at a view direction', () => {
    const view = 0.7;
    const at = (v: { x: number; z: number }) => Math.atan2(v.z, v.x);
    const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.01;
    const dusk = windowSkyTurn(17.7, view, 0);
    expect(near(at(sunDirection(17.7, undefined, (dusk * Math.PI) / 180)), view)).toBe(true);
    const night = windowSkyTurn(21, view, 0);
    expect(near(at(moonDirection(21, undefined, (night * Math.PI) / 180)), view)).toBe(true);
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
  const free = (speed: 1 | 10 | 30 | 60 | 240, paused = false) => ({ mode: 'free' as const, speed, paused });

  it('the island clock runs at its speed, wraps at midnight and can stop', () => {
    expect(advanceTime(10, free(60), 60, new Date())).toBeCloseTo(11, 5);
    expect(advanceTime(10, free(240), 15, new Date())).toBeCloseTo(11, 5);
    expect(advanceTime(10, free(1), 3600, new Date())).toBeCloseTo(11, 5);
    expect(advanceTime(23.9, free(60), 60, new Date())).toBeCloseTo(0.9, 5);
    expect(advanceTime(7.25, free(60, true), 100, new Date())).toBe(7.25);
  });

  it('real mode follows the computer clock, seconds included', () => {
    const clock = { mode: 'real' as const, speed: 60 as const, paused: true };
    expect(advanceTime(0, clock, 0, new Date(2026, 9, 17, 14, 30, 36))).toBeCloseTo(14.51, 5);
  });

  it('formats hh:mm:ss', () => {
    expect(formatClockSeconds(14.51)).toBe('14:30:36');
    expect(formatClockSeconds(0)).toBe('00:00:00');
  });

  it('formats hours as hh:mm', () => {
    expect(formatClock(6.5)).toBe('06:30');
    expect(formatClock(23.99)).toBe('23:59');
  });
});

describe('sun glitter road', () => {
  const r = SUN_RADIUS;

  it('counts the part of the disc above the horizon', () => {
    expect(sunVisibleFraction(r, r)).toBeCloseTo(1, 6);
    expect(sunVisibleFraction(0.5, r)).toBe(1);
    expect(sunVisibleFraction(0, r)).toBeCloseTo(0.5, 6);
    expect(sunVisibleFraction(-r, r)).toBeCloseTo(0, 6);
    expect(sunVisibleFraction(-0.2, r)).toBe(0);
    // Symmetric: half a radius up shows as much as half a radius down hides.
    expect(sunVisibleFraction(r / 2, r) + sunVisibleFraction(-r / 2, r)).toBeCloseTo(1, 6);
    expect(sunVisibleFraction(r / 2, r)).toBeGreaterThan(0.5);
  });

  it('stays strong while the sun touches the sea, and matches the scene light high up', () => {
    // At the horizon the scene light is ~0.1 of noon (sunIntensity 0.6 / 2.6, faded); the road
    // keeps the full sun colour, halved because half the disc is gone.
    expect(sunGlintScale(0, 0.6, 0.5)).toBeCloseTo(0.5, 6);
    expect(sunGlintScale(0.3, 2.6, 1)).toBeCloseTo(1, 6);
    expect(sunGlintScale(0.2, 1.3, 1)).toBeCloseTo(0.5, 6);
    expect(sunGlintScale(-0.1, 0, 0)).toBe(0);
  });

  it('aims at the visible sliver while the sun is cut by the horizon', () => {
    expect(sunGlintElevation(0.2, r)).toBe(0.2);
    expect(sunGlintElevation(r, r)).toBeCloseTo(r, 9);
    expect(sunGlintElevation(0, r)).toBeCloseTo(r / 2, 9);
    expect(sunGlintElevation(-r, r)).toBeCloseTo(0, 9);
  });
});
