import type { GoalId } from './journal';

/** What the goals look at, filled in by the app every frame (one reused object). */
export interface GoalFrame {
  /** Sitting in the kayak; its position. */
  kayak: boolean;
  kx: number;
  kz: number;
  /** Distance (m) from the kayak to the moored rowboat and to the fishing boat out at sea. */
  rowboat: number;
  fishing: number;
  swimming: boolean;
  diving: boolean;
  /** 0 breaststroke … 1 front crawl; swimming speed (m/s). */
  crawl: number;
  speed: number;
  /** How far below the surface the diver's head is (m). */
  depth: number;
  /** The diver is close above a reef rock. */
  overReef: boolean;
}

export function createGoalFrame(): GoalFrame {
  return {
    kayak: false, kx: 0, kz: 0, rowboat: Infinity, fishing: Infinity,
    swimming: false, diving: false, crawl: 0, speed: 0, depth: 0, overReef: false,
  };
}

/** Thresholds of the goals. */
export const GOAL_RULES = {
  /** Paddle up to the rowboat / fishing boat: this close (m). */
  rowboat: 4,
  fishing: 12,
  /** Front-crawl distance (m), counted over every swim. */
  crawl: 50,
  /** Dive this deep (m below the surface). */
  deep: 8,
  /** Hold your breath this long in one dive (s). */
  breath: 30,
} as const;

/**
 * Turns the frame-by-frame state into ticked goals. Pure (no DOM, no three.js), so the rules are
 * unit-tested. Goals that are single events (jumping out of the kayak, climbing back in) are
 * ticked by the app directly.
 */
export class GoalTracker {
  /** Angle (rad) swept around the island center in the current kayak trip. */
  private swept = 0;
  private lastAngle = Number.NaN;
  private crawled = 0;
  private underFor = 0;

  constructor(private readonly complete: (id: GoalId) => void) {}

  update(dt: number, f: GoalFrame): void {
    if (f.kayak) {
      this.complete('kayakLaunch');
      if (f.rowboat < GOAL_RULES.rowboat) this.complete('kayakRowboat');
      if (f.fishing < GOAL_RULES.fishing) this.complete('kayakFishing');
      // Round the island: add up the turn of the angle seen from the island center.
      const a = Math.atan2(f.kz, f.kx);
      if (!Number.isNaN(this.lastAngle)) {
        let d = a - this.lastAngle;
        if (d > Math.PI) d -= Math.PI * 2;
        else if (d < -Math.PI) d += Math.PI * 2;
        this.swept += d;
      }
      this.lastAngle = a;
      if (Math.abs(this.swept) >= Math.PI * 2) this.complete('kayakRound');
    } else {
      // A new trip starts the lap again.
      this.swept = 0;
      this.lastAngle = Number.NaN;
    }

    if (f.swimming) {
      this.complete('swimFirst');
      if (!f.diving && f.crawl > 0.5) {
        this.crawled += f.speed * dt;
        if (this.crawled >= GOAL_RULES.crawl) this.complete('swimCrawl');
      }
    }

    if (f.diving) {
      this.complete('diveFirst');
      this.underFor += dt;
      if (this.underFor >= GOAL_RULES.breath) this.complete('diveLong');
      if (f.depth >= GOAL_RULES.deep) this.complete('diveDeep');
      if (f.overReef) this.complete('diveReef');
    } else {
      this.underFor = 0;
    }
  }
}
