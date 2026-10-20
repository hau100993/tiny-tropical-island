import { describe, expect, it } from 'vitest';
import { GOAL_IDS, JOURNAL_KEY, Journal, type GoalId } from '../src/activities/journal';
import { GOAL_RULES, GoalTracker, createGoalFrame } from '../src/activities/goalTracker';

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

describe('Journal', () => {
  it('ticks a goal once and keeps it after a reload', () => {
    const storage = new MemoryStorage();
    const j = new Journal(storage);
    expect(j.complete('kayakLaunch', 1000)).toBe(true);
    expect(j.complete('kayakLaunch', 2000)).toBe(false);
    const again = new Journal(storage);
    expect(again.isDone('kayakLaunch')).toBe(true);
    expect(again.isDone('diveDeep')).toBe(false);
    expect(again.count).toBe(1);
  });

  it('drops unknown ids and bad values, survives broken JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(JOURNAL_KEY, JSON.stringify({ kayakLaunch: 5, bogus: 1, diveDeep: 'x' }));
    const j = new Journal(storage);
    expect(j.count).toBe(1);
    storage.setItem(JOURNAL_KEY, '{not json');
    expect(new Journal(storage).count).toBe(0);
    expect(new Journal(null).count).toBe(0);
  });

  it('reset clears everything', () => {
    const storage = new MemoryStorage();
    const j = new Journal(storage);
    for (const id of GOAL_IDS) j.complete(id);
    expect(j.count).toBe(GOAL_IDS.length);
    j.reset();
    expect(new Journal(storage).count).toBe(0);
  });
});

describe('GoalTracker', () => {
  const run = (frames: (f: ReturnType<typeof createGoalFrame>, i: number) => void, n: number, dt = 0.1): Set<GoalId> => {
    const done = new Set<GoalId>();
    const t = new GoalTracker((id) => done.add(id));
    const f = createGoalFrame();
    for (let i = 0; i < n; i++) {
      frames(f, i);
      t.update(dt, f);
    }
    return done;
  };

  it('a full lap round the island in one kayak trip', () => {
    const lap = (stopAt: number) =>
      run((f, i) => {
        const a = (i / 100) * Math.PI * 2.05;
        f.kayak = i !== stopAt;
        f.kx = Math.cos(a) * 90;
        f.kz = Math.sin(a) * 90;
      }, 101);
    expect(lap(-1).has('kayakRound')).toBe(true);
    // Stepping out halfway starts the lap again.
    expect(lap(50).has('kayakRound')).toBe(false);
    expect(lap(-1).has('kayakLaunch')).toBe(true);
  });

  it('boats reached only when close', () => {
    const far = run((f) => Object.assign(f, { kayak: true, rowboat: 10, fishing: 40 }), 3);
    expect(far.has('kayakRowboat') || far.has('kayakFishing')).toBe(false);
    const near = run((f) => Object.assign(f, { kayak: true, rowboat: 3, fishing: 8 }), 3);
    expect(near.has('kayakRowboat') && near.has('kayakFishing')).toBe(true);
  });

  it('crawl distance adds up; breaststroke does not count', () => {
    const breast = run((f) => Object.assign(f, { swimming: true, crawl: 0, speed: 0.75 }), 1000);
    expect(breast.has('swimFirst')).toBe(true);
    expect(breast.has('swimCrawl')).toBe(false);
    const secs = GOAL_RULES.crawl / 1.5;
    const crawl = run((f) => Object.assign(f, { swimming: true, crawl: 1, speed: 1.5 }), Math.ceil(secs / 0.1) + 2);
    expect(crawl.has('swimCrawl')).toBe(true);
  });

  it('breath hold counts one dive only; depth and reef', () => {
    // 20 s under, surface, 20 s under: never 30 s in one go.
    const split = run((f, i) => Object.assign(f, { swimming: true, diving: i < 200 || i > 205, depth: 3 }), 405);
    expect(split.has('diveFirst')).toBe(true);
    expect(split.has('diveLong')).toBe(false);
    const long = run((f) => Object.assign(f, { swimming: true, diving: true, depth: 3 }), 310);
    expect(long.has('diveLong')).toBe(true);
    expect(long.has('diveDeep')).toBe(false);
    const deep = run((f) => Object.assign(f, { swimming: true, diving: true, depth: 8.2, overReef: true }), 2);
    expect(deep.has('diveDeep') && deep.has('diveReef')).toBe(true);
  });
});
