/** Săn Bong Bóng's score: bubbles burst, the combo, and a tomato per SCORE.block bubbles. */

export const SCORE = {
  /** Bursts at most this far apart (s) chain the combo. */
  comboGap: 2,
  /** Bubbles per tomato. */
  block: 30,
  /** From this combo on, a burst shakes the view a little. */
  shakeAt: 5,
} as const;

/** What is kept in localStorage ('tsw.bubbleHunt'): the lifetime count and the count toward the next tomato. */
export interface HuntSave {
  total: number;
  toward: number;
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

export function parseHuntSave(raw: unknown): HuntSave {
  if (typeof raw !== 'object' || raw === null) return { total: 0, toward: 0 };
  const r = raw as Record<string, unknown>;
  return { total: count(r.total), toward: Math.min(SCORE.block - 1, count(r.toward)) };
}

export class HuntScore {
  total: number;
  toward: number;
  combo = 0;
  /** uTime (s) of the last burst. */
  private last = -Infinity;

  constructor(save: Readonly<HuntSave>) {
    this.total = save.total;
    this.toward = save.toward;
  }

  /**
   * A burst at `now` (s, the shared clock) and `wall` (ms, Date.now()). Returns the tomato's
   * ledger id (`b<wall>`) when this burst completes a block, else null.
   */
  add(now: number, wall: number): string | null {
    // Absolute times, not summed frame steps: a hidden tab's long pause breaks the chain.
    this.combo = now - this.last <= SCORE.comboGap ? this.combo + 1 : 1;
    this.last = now;
    this.total++;
    this.toward++;
    if (this.toward < SCORE.block) return null;
    this.toward = 0;
    return `b${Math.round(wall)}`;
  }

  save(): HuntSave {
    return { total: this.total, toward: this.toward };
  }
}
