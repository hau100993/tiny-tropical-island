/** Major pentatonic steps (semitones) from C6, ten notes: a bubble combo climbs them. */
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
const C6 = 1046.5;

/** The chime's pitch (Hz) for combo `n` (1 = the first burst); past the tenth it stays on top. */
export function comboNote(n: number): number {
  const i = Math.max(0, Math.min(STEPS.length - 1, Math.round(n) - 1));
  return C6 * Math.pow(2, STEPS[i] / 12);
}
