import { describe, expect, it } from 'vitest';
import { comboNote } from '../src/audio/synth/huntNotes';

describe('comboNote', () => {
  it('starts on C6 and climbs the major pentatonic scale', () => {
    expect(comboNote(1)).toBeCloseTo(1046.5, 1);
    expect(comboNote(2)).toBeCloseTo(1046.5 * Math.pow(2, 2 / 12), 1);
    expect(comboNote(4)).toBeCloseTo(1046.5 * Math.pow(2, 7 / 12), 1);
    expect(comboNote(6)).toBeCloseTo(2093, 0);
  });
  it('stays on the top note past the tenth step, and treats < 1 as the first', () => {
    expect(comboNote(10)).toBe(comboNote(40));
    expect(comboNote(0)).toBe(comboNote(1));
  });
});
