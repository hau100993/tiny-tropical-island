import { smoothstep } from './math';

/**
 * Knocked off your feet (Mochi's "Sonic Bark"): falling on your back, lying there, getting up
 * (s), pushed back this far (m) as you fall.
 */
export const KNOCK = { fall: 0.5, lie: 1.3, rise: 1.1, push: 1.3 } as const;

/** How far down you are `t` s after being knocked over (< 0: never): 0 standing … 1 lying. */
export function knockLevel(t: number): number {
  if (t < 0) return 0;
  // Toppling: slow, then faster (gravity).
  if (t < KNOCK.fall) return (t / KNOCK.fall) ** 2;
  t -= KNOCK.fall;
  if (t < KNOCK.lie) return 1;
  t -= KNOCK.lie;
  return t < KNOCK.rise ? 1 - smoothstep(0, 1, t / KNOCK.rise) : 0;
}
