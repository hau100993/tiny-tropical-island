import { describe, expect, it } from 'vitest';
import { crossing, LEVEL, makeCourse, RING_LEVELS, RingRun, type Course, type Gate } from '../src/activities/flight/ringCourse';
import { earnRing, emptyLedger, tomatoes } from '../src/pets/ledger';

/** A seeded generator (mulberry32), so a failing course can be replayed. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hill in the middle (40 m high within 60 m), the sea elsewhere. */
const floor = (x: number, z: number): number => (Math.hypot(x, z) < 60 ? 40 : 0);

/** Flies straight through every ring's middle, `step` m a frame at 60 fps. */
function flyThrough(run: RingRun, step = 0.4): void {
  let px = 0;
  let py = 20;
  let pz = 120;
  for (const g of run.course.gates) {
    // From a little before it to a little past it, along its way.
    const ax = g.x - g.nx * 3;
    const ay = g.y - g.ny * 3;
    const az = g.z - g.nz * 3;
    run.update(0, px, py, pz, ax, ay, az);
    for (let s = -3; s < 3; s += step) {
      const bx = g.x + g.nx * (s + step);
      const by = g.y + g.ny * (s + step);
      const bz = g.z + g.nz * (s + step);
      run.update(1 / 60, g.x + g.nx * s, g.y + g.ny * s, g.z + g.nz * s, bx, by, bz);
    }
    px = g.x + g.nx * 3;
    py = g.y + g.ny * 3;
    pz = g.z + g.nz * 3;
  }
}

describe('ring course: a random course each cast', () => {
  it('varies difficulty, size, count and shape from cast to cast', () => {
    const rnd = seeded(7);
    const levels = new Set<string>();
    const patterns = new Set<string>();
    const counts = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const c = makeCourse(rnd, 0, 20, 150, 0, floor);
      levels.add(c.level);
      patterns.add(c.pattern);
      counts.add(c.gates.length);
    }
    expect(levels.size).toBe(3);
    expect(patterns.size).toBeGreaterThanOrEqual(5);
    expect(counts.size).toBeGreaterThanOrEqual(5);
  });

  it('keeps each level in its ranges, rings clear of what is under them', () => {
    const rnd = seeded(11);
    for (const level of RING_LEVELS) {
      for (let k = 0; k < 30; k++) {
        const c: Course = makeCourse(rnd, (rnd() - 0.5) * 200, 15, 150, rnd() * 6.28, floor, level);
        const L = LEVEL[level];
        expect(c.gates.length).toBeGreaterThanOrEqual(L.count[0]);
        expect(c.gates.length).toBeLessThanOrEqual(L.count[1]);
        let prev: Gate | null = null;
        for (const g of c.gates) {
          expect(g.radius).toBeGreaterThanOrEqual(L.radius[0] * 0.9 - 1e-9);
          expect(g.radius).toBeLessThanOrEqual(L.radius[1] * 1.1 + 1e-9);
          expect(g.y - g.radius).toBeGreaterThan(floor(g.x, g.z));
          expect(Math.hypot(g.nx, g.ny, g.nz)).toBeCloseTo(1);
          expect(g.time).toBeGreaterThan(2);
          if (prev) {
            const d = Math.hypot(g.x - prev.x, g.z - prev.z);
            expect(d).toBeGreaterThan(L.gap[0] - 1);
            expect(d).toBeLessThan(L.gap[1] + 1);
          }
          prev = g;
        }
      }
    }
  });

  it('bends back toward the island instead of running off', () => {
    const rnd = seeded(3);
    for (let k = 0; k < 40; k++) {
      const c = makeCourse(rnd, 330, 20, 0, -Math.PI / 2, floor, 'easy', 'arc');
      for (const g of c.gates) expect(Math.hypot(g.x, g.z)).toBeLessThan(470);
    }
  });
});

describe('ring course: flying it', () => {
  const g: Gate = { x: 0, y: 10, z: 0, nx: 0, ny: 0, nz: -1, radius: 4, time: 5, seed: 0 };

  it('counts a crossing its way, inside, and reports how far from the middle', () => {
    expect(crossing(g, 1, 10, 1, 1, 10, -1)).toBeCloseTo(1);
    // Backwards: no.
    expect(crossing(g, 1, 10, -1, 1, 10, 1)).toBeNull();
    // Not reaching it.
    expect(crossing(g, 1, 10, 3, 1, 10, 1)).toBeNull();
    // Far beside it: not even a miss.
    expect(crossing(g, 30, 10, 1, 30, 10, -1)).toBeNull();
  });

  it('flown through all its rings in time: done, every one in order', () => {
    const c = makeCourse(seeded(5), 0, 20, 150, 0, floor, 'normal');
    const run = new RingRun(c);
    flyThrough(run);
    expect(run.state).toBe('done');
    expect(run.next).toBe(c.gates.length);
    expect(run.perfect).toBe(c.gates.length);
  });

  it('beside a ring is a miss (it stays); too slow is a timeout', () => {
    const c: Course = { level: 'easy', pattern: 'arc', hex: false, gates: [g, { ...g, z: -40 }] };
    const run = new RingRun(c);
    const ev = run.update(0.1, 5, 10, 1, 5, 10, -1);
    expect(ev).toEqual({ kind: 'miss', index: 0 });
    expect(run.next).toBe(0);
    const pass = run.update(0.1, 0, 10, 1, 0, 10, -1);
    expect(pass).toEqual({ kind: 'pass', index: 0, perfect: true });
    let last = null;
    for (let i = 0; i < 400 && run.state === 'run'; i++) last = run.update(1 / 60, 0, 10, -2, 0, 10, -2);
    expect(run.state).toBe('failed');
    expect(last).toEqual({ kind: 'timeout', index: 1 });
  });
});

describe('ring course: the tomato', () => {
  it('pays one per run, once', () => {
    const a = earnRing(emptyLedger(), 1000);
    expect(a.earned).toBe(true);
    expect(tomatoes(a.ledger)).toBe(1);
    const again = earnRing(a.ledger, 1000);
    expect(again.earned).toBe(false);
    expect(tomatoes(again.ledger)).toBe(1);
    expect(tomatoes(earnRing(a.ledger, 2000).ledger)).toBe(2);
  });
});
