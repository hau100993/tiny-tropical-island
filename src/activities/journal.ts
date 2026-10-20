import { isRecord } from '../core/storage';

export const JOURNAL_KEY = 'tsw.journal';

/** The journal's goals, grouped by activity (the order they are listed in). */
export const GOAL_GROUPS = {
  kayak: ['kayakLaunch', 'kayakRowboat', 'kayakFishing', 'kayakRound'],
  swim: ['swimFirst', 'swimCrawl', 'swimJump', 'swimReboard'],
  dive: ['diveFirst', 'diveReef', 'diveDeep', 'diveLong'],
} as const;

export type GoalGroup = keyof typeof GOAL_GROUPS;
export type GoalId = (typeof GOAL_GROUPS)[GoalGroup][number];
export const GOAL_IDS: readonly GoalId[] = Object.values(GOAL_GROUPS).flat();

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * "Nhật ký": which goals are done and when (ms since epoch). Saved in localStorage on every
 * change; unknown ids and bad values in the stored record are dropped.
 */
export class Journal {
  private readonly done = new Map<GoalId, number>();
  private readonly listeners: Array<(id: GoalId | null) => void> = [];

  constructor(private readonly storage: KeyValueStorage | null) {
    let json: string | null = null;
    try {
      json = storage?.getItem(JOURNAL_KEY) ?? null;
    } catch {
      json = null;
    }
    let raw: unknown = null;
    try {
      raw = json ? (JSON.parse(json) as unknown) : null;
    } catch {
      raw = null;
    }
    if (isRecord(raw)) {
      for (const id of GOAL_IDS) {
        const t = raw[id];
        if (typeof t === 'number' && Number.isFinite(t)) this.done.set(id, t);
      }
    }
  }

  isDone(id: GoalId): boolean {
    return this.done.has(id);
  }

  get count(): number {
    return this.done.size;
  }

  /** Ticks a goal; true if it was not done yet (the caller shows the toast). */
  complete(id: GoalId, now = Date.now()): boolean {
    if (this.done.has(id)) return false;
    this.done.set(id, now);
    this.save();
    for (const fn of this.listeners) fn(id);
    return true;
  }

  /** "Làm lại": every goal open again. */
  reset(): void {
    this.done.clear();
    this.save();
    for (const fn of this.listeners) fn(null);
  }

  /** Called with the goal just ticked, or null after a reset. */
  onChange(fn: (id: GoalId | null) => void): void {
    this.listeners.push(fn);
  }

  private save(): void {
    try {
      this.storage?.setItem(JOURNAL_KEY, JSON.stringify(Object.fromEntries(this.done)));
    } catch {
      // Keep working in memory.
    }
  }
}
