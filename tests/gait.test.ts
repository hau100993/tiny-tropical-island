import { describe, expect, it } from 'vitest';
import { RUN_STEP, stepLength, WALK_STEP } from '../src/core/gait';

describe('stepLength', () => {
  it('is the full gait step at full speed', () => {
    expect(stepLength(1.6, 1.6, false)).toBeCloseTo(WALK_STEP);
    expect(stepLength(4, 4, true)).toBeCloseTo(RUN_STEP);
  });

  it('is zero standing still and never longer than the full step', () => {
    expect(stepLength(0, 1.6, false)).toBe(0);
    expect(stepLength(9, 1.6, false)).toBeCloseTo(WALK_STEP);
  });

  it('shortens the step and slows the cadence when walking slower', () => {
    const half = stepLength(0.8, 1.6, false);
    expect(half).toBeLessThan(WALK_STEP);
    // Shorter steps, but not in proportion: the cadence drops too.
    expect(half).toBeGreaterThan(WALK_STEP / 2);
    expect(0.8 / half).toBeLessThan(1.6 / WALK_STEP);
  });
});
