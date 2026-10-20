import { describe, expect, it } from 'vitest';
import { nextSpeed } from '../src/ui/timeSpeed';

describe('speed button', () => {
  it('clicks up through ×1 → ×10 → ×60 → ×240 and round again', () => {
    expect(nextSpeed(1, 1, true)).toBe(10);
    expect(nextSpeed(10, 1, true)).toBe(60);
    expect(nextSpeed(60, 1, true)).toBe(240);
    expect(nextSpeed(240, 1, true)).toBe(1);
  });

  it('Shift + click goes down, round too', () => {
    expect(nextSpeed(60, -1, true)).toBe(10);
    expect(nextSpeed(1, -1, true)).toBe(240);
  });

  it('the wheel stops at the ends', () => {
    expect(nextSpeed(240, 1, false)).toBe(240);
    expect(nextSpeed(1, -1, false)).toBe(1);
  });

  it('an old ×30 setting steps to its neighbours', () => {
    expect(nextSpeed(30, 1, true)).toBe(60);
    expect(nextSpeed(30, -1, true)).toBe(10);
  });
});
