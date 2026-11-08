import { describe, expect, it } from 'vitest';
import { Exposure, FIRE, LaserFire } from '../src/activities/flight/laserFire';

describe('LaserFire', () => {
  it('a click is one flash, fired once, then off', () => {
    const f = new LaserFire();
    f.press(0);
    f.update(0);
    expect(f.mode).toBe('flash');
    expect(f.flashFired).toBe(true);
    f.update(0.02);
    expect(f.flashFired).toBe(false);
    f.release(0.05);
    f.update(0.1);
    expect(f.mode).toBe('flash');
    expect(f.strength).toBeGreaterThan(0);
    f.update(FIRE.flash + 0.01);
    expect(f.mode).toBe('off');
    expect(f.strength).toBe(0);
  });

  it('presses inside the cooldown are ignored', () => {
    const f = new LaserFire();
    f.press(0);
    f.update(0);
    f.release(0.03);
    f.press(FIRE.cooldown - 0.02);
    f.update(FIRE.cooldown - 0.02);
    expect(f.flashFired).toBe(false);
    f.release(FIRE.cooldown - 0.01);
    f.press(FIRE.cooldown + 0.01);
    f.update(FIRE.cooldown + 0.01);
    expect(f.flashFired).toBe(true);
  });

  it('held past FIRE.hold it becomes a beam that heats up', () => {
    const f = new LaserFire();
    f.press(0);
    f.update(0);
    f.update(FIRE.hold + 0.001);
    expect(f.mode).toBe('beam');
    f.update(FIRE.hold + FIRE.heat / 2);
    expect(f.heat).toBeCloseTo(0.5, 2);
    f.update(FIRE.hold + FIRE.heat + 0.2);
    expect(f.heat).toBe(1);
    expect(f.strength).toBe(1);
  });

  it('releasing the beam turns it off', () => {
    const f = new LaserFire();
    f.press(0);
    f.update(0.5);
    expect(f.mode).toBe('beam');
    f.release(0.6);
    f.update(0.6);
    expect(f.mode).toBe('off');
    expect(f.heat).toBe(0);
  });

  it('cancel stops a beam at once', () => {
    const f = new LaserFire();
    f.press(0);
    f.update(1);
    f.cancel();
    expect(f.mode).toBe('off');
    expect(f.heat).toBe(0);
    expect(f.strength).toBe(0);
    // The button is no longer held: time passing doesn't bring the beam back.
    f.update(2);
    expect(f.mode).toBe('off');
  });
});

describe('Exposure', () => {
  it('fires once the beam has been on a slot for FIRE.exposure', () => {
    const e = new Exposure(4);
    expect(e.add(2, 0.05)).toBe(false);
    expect(e.add(2, 0.04)).toBe(true);
  });
  it('keeps each slot apart and resets', () => {
    const e = new Exposure(4);
    e.add(1, 0.06);
    expect(e.add(0, 0.06)).toBe(false);
    e.reset(1);
    expect(e.add(1, 0.06)).toBe(false);
    e.clearAll();
    expect(e.add(0, 0.06)).toBe(false);
  });
});
