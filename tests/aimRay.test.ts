import { describe, expect, it } from 'vitest';
import { rayBlock } from '../src/activities/flight/aimRay';

const flat = (): number => 0;
/** A hill 20 m high between x = 40 and x = 60. */
const hill = (x: number): number => (x > 40 && x < 60 ? 20 : 0);

describe('rayBlock', () => {
  it('finds the ground under a falling ray', () => {
    const d = Math.SQRT1_2;
    // From (0, 10, 0) along (1, −1)/√2: meets y = 0 after 10√2.
    expect(rayBlock(0, 10, 0, d, -d, 0, 250, flat)).toBeCloseTo(10 * Math.SQRT2, 1);
  });
  it('a hill in front of the target blocks before maxT', () => {
    const t = rayBlock(0, 10, 0, 1, 0, 0, 100, hill);
    expect(t).toBeGreaterThan(38);
    expect(t).toBeLessThanOrEqual(41);
  });
  it('nothing in the way within maxT', () => {
    expect(rayBlock(0, 10, 0, 1, 0, 0, 35, hill)).toBe(-1);
    expect(rayBlock(0, 10, 0, 0, 1, 0, 250, flat)).toBe(-1);
  });
});
