import { describe, expect, it } from 'vitest';
import { MantaSummon, SUMMON } from '../src/activities/flight/mantaSummon';

/** Runs the entrance at 60 fps; returns what happened along the way. */
function run(yaw = 0.7) {
  const m = new MantaSummon();
  m.start(50, -30, yaw, 0.2);
  const startY = m.y;
  let t = 0;
  let breaches = 0;
  let breachT = -1;
  let top = -Infinity;
  let jump = 0;
  let px = m.x;
  let py = m.y;
  let pz = m.z;
  while (m.active && t < 30) {
    m.update(1 / 60);
    t += 1 / 60;
    if (m.breached) {
      breaches++;
      breachT = t;
      m.breached = false;
    }
    top = Math.max(top, m.y);
    jump = Math.max(jump, Math.hypot(m.x - px, m.y - py, m.z - pz));
    px = m.x;
    py = m.y;
    pz = m.z;
  }
  return { m, t, startY, breaches, breachT, top, jump };
}

describe('MantaSummon (coming up out of the sea)', () => {
  it('starts deep under the sea and stays under while the sea churns', () => {
    const m = new MantaSummon();
    m.start(0, 0, 0, 0);
    expect(m.y).toBeLessThan(-5);
    for (let i = 0; i < SUMMON.stir * 60 - 2; i++) {
      m.update(1 / 60);
      expect(m.y).toBeLessThan(0);
    }
    expect(m.phase).toBe('stir');
  });

  it('breaks the surface once, right after the churn, near where it was asked to', () => {
    const r = run();
    expect(r.breaches).toBe(1);
    expect(r.breachT).toBeGreaterThan(SUMMON.stir);
    expect(r.breachT).toBeLessThan(SUMMON.stir + 0.5);
  });

  it('loops high and comes out low, level-ish and heading the way it set off', () => {
    const r = run(0.7);
    expect(r.top).toBeGreaterThan(16);
    expect(r.m.phase).toBe('done');
    expect(r.m.y).toBeGreaterThan(3);
    expect(r.m.y).toBeLessThan(10);
    expect(r.m.pitch).toBeCloseTo(SUMMON.exitPitch);
    expect(r.m.roll).toBe(0);
    expect(r.m.fx).toBeCloseTo(-Math.sin(0.7));
    expect(r.m.fz).toBeCloseTo(-Math.cos(0.7));
    // Moving on at a good speed, the whole show in well under ten seconds, smoothly.
    expect(r.m.speed).toBeGreaterThan(10);
    expect(r.t).toBeLessThan(10);
    expect(r.jump).toBeLessThan(0.5);
  });
});
