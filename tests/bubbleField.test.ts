import { describe, expect, it } from 'vitest';
import { BubbleField, FIELD, raySphere, type Slot } from '../src/activities/flight/bubbleField';

/** A seeded generator (mulberry32), so a failing field can be replayed. */
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

const flat = (): number => 0;

/** A bubble with no drift, at (x, y, z) at time 0, grown in 1 s before (its rise taken off). */
function place(s: Slot, x: number, y: number, z: number, r: number): void {
  s.live = true;
  s.p0.set([x, y - FIELD.rise, z]);
  s.freq.fill(0);
  s.phase.fill(0);
  s.born = -1;
  s.radius = r;
  s.burstAt = -1;
  s.respawnAt = -1;
  s.fadeAt = -1;
}

describe('raySphere', () => {
  it('hits a sphere ahead at its near side', () => {
    expect(raySphere(0, 0, 0, 0, 0, 1, 0, 0, 10, 1)).toBeCloseTo(9);
  });
  it('misses a sphere off to the side', () => {
    expect(raySphere(0, 0, 0, 0, 0, 1, 1.5, 0, 10, 1)).toBe(-1);
  });
  it('from inside returns the exit point', () => {
    expect(raySphere(0, 0, 0, 0, 0, 1, 0, 0, 0.5, 2)).toBeCloseTo(2.5);
  });
  it('misses a sphere behind', () => {
    expect(raySphere(0, 0, 0, 0, 0, 1, 0, 0, -10, 1)).toBe(-1);
  });
});

describe('BubbleField', () => {
  it('spawns in the shell ahead', () => {
    const f = new BubbleField(16, seeded(1));
    f.count = 12;
    f.update(0, 0, 50, 0, 0, flat);
    let ahead = 0;
    for (let i = 0; i < 12; i++) {
      const s = f.slots[i];
      expect(s.live).toBe(true);
      const dx = s.p0[0];
      const dz = s.p0[2];
      const d = Math.hypot(dx, dz);
      expect(d).toBeGreaterThanOrEqual(FIELD.shellMin - 1e-6);
      expect(d).toBeLessThanOrEqual(FIELD.shellMax + 1e-6);
      // Forward at yaw 0 is (0, −1).
      if (-dz > 0) ahead++;
    }
    expect(ahead / 12).toBeGreaterThanOrEqual(0.7);
    for (let i = 12; i < 16; i++) expect(f.slots[i].live).toBe(false);
  });

  it('stays clear of the floor', () => {
    const floor = (x: number): number => 30 + 10 * Math.sin(x * 0.1);
    const f = new BubbleField(16, seeded(2));
    f.count = 16;
    f.update(0, 0, 20, 0, 0, floor);
    for (const s of f.slots) {
      let top = -Infinity;
      for (const ox of [-FIELD.drift, 0, FIELD.drift]) top = Math.max(top, floor(s.p0[0] + ox));
      expect(s.p0[1]).toBeGreaterThanOrEqual(top + FIELD.above + FIELD.drift - 1e-4);
    }
  });

  it('posAt follows the motion formula', () => {
    const f = new BubbleField(1, seeded(3));
    f.count = 1;
    f.update(2, 0, 50, 0, 0, flat);
    const s = f.slots[0];
    const out = new Float32Array(3);
    for (const tau of [0, 1.7, 12.3]) {
      f.posAt(0, s.born + tau, out);
      const A = FIELD.drift;
      expect(out[0]).toBeCloseTo(s.p0[0] + A * Math.sin(s.freq[0] * tau + s.phase[0]), 4);
      expect(out[1]).toBeCloseTo(s.p0[1] + FIELD.rise * tau + 0.5 * A * Math.sin(s.freq[1] * tau + s.phase[1]), 4);
      expect(out[2]).toBeCloseTo(s.p0[2] + A * Math.sin(s.freq[2] * tau + s.phase[2]), 4);
    }
  });

  it('pick returns the nearest bubble on the ray', () => {
    const f = new BubbleField(2, seeded(4));
    f.count = 2;
    place(f.slots[0], 0, 0, 40, 3);
    place(f.slots[1], 0, 0, 20, 1);
    const hit = new Float32Array(1);
    expect(f.pick(0, 0, 0, 0, 0, 1, 250, 0, hit)).toBe(1);
    // On its real film (a true hit), not on the inflated sphere.
    expect(hit[0]).toBeCloseTo(20 - 1);
  });

  it('pick ignores bubbles beyond the range', () => {
    const f = new BubbleField(1, seeded(4));
    f.count = 1;
    place(f.slots[0], 0, 0, 300, 2);
    expect(f.pick(0, 0, 0, 0, 0, 1, 250, 0, new Float32Array(1))).toBe(-1);
  });

  it('inflates the hit radius by FIELD.inflate', () => {
    const f = new BubbleField(1, seeded(5));
    f.count = 1;
    const hit = new Float32Array(1);
    place(f.slots[0], 1.25 * 2, 0, 30, 2);
    expect(f.pick(0, 0, 0, 0, 0, 1, 250, 0, hit)).toBe(0);
    place(f.slots[0], 1.35 * 2, 0, 30, 2);
    expect(f.pick(0, 0, 0, 0, 0, 1, 250, 0, hit)).toBe(-1);
  });

  it('a burst bubble is not hittable until it has grown back', () => {
    const f = new BubbleField(1, seeded(6));
    f.count = 1;
    place(f.slots[0], 0, 0, 30, 2);
    const hit = new Float32Array(1);
    f.burst(0, 5, 0, 0, -1);
    expect(f.hittable(0, 5.05)).toBe(false);
    expect(f.pick(0, 0, 0, 0, 0, 1, 250, 5.05, hit)).toBe(-1);
    const s = f.slots[0];
    expect(s.respawnAt).toBeGreaterThanOrEqual(5 + FIELD.burst + FIELD.respawnMin - 1e-6);
    expect(s.respawnAt).toBeLessThanOrEqual(5 + FIELD.burst + FIELD.respawnMax + 1e-6);
    const at = s.respawnAt;
    f.update(at, 0, 50, 0, 0, flat);
    expect(s.born).toBe(at);
    expect(s.burstAt).toBe(-1);
    expect(f.hittable(0, at + FIELD.grow * 0.5)).toBe(false);
    expect(f.hittable(0, at + FIELD.grow + 0.01)).toBe(true);
  });

  it('a burst bumps the version and keeps the direction', () => {
    const f = new BubbleField(1, seeded(6));
    f.count = 1;
    place(f.slots[0], 0, 0, 30, 2);
    const v = f.version;
    f.burst(0, 1, 0, 0, -1);
    expect(f.version).toBeGreaterThan(v);
    expect(Array.from(f.slots[0].burstDir)).toEqual([0, 0, -1]);
  });

  it('recycles bubbles left far behind and respawns them ahead', () => {
    const f = new BubbleField(12, seeded(7));
    f.count = 12;
    f.update(0, 0, 50, 0, 0, flat);
    // Fly 260 m forward (−z at yaw 0).
    f.update(10, 0, 50, -260, 0, flat);
    const out = new Float32Array(3);
    let recycled = 0;
    for (let i = 0; i < 12; i++) {
      f.posAt(i, 10, out);
      const far = Math.hypot(out[0], out[2] + 260) > FIELD.behind;
      if (far) {
        expect(f.slots[i].fadeAt).toBe(10);
        recycled++;
      }
    }
    expect(recycled).toBeGreaterThan(0);
    f.update(10 + FIELD.grow + 0.01, 0, 50, -260, 0, flat);
    for (let i = 0; i < 12; i++) {
      f.posAt(i, 10 + FIELD.grow + 0.01, out);
      expect(Math.hypot(out[0], out[2] + 260)).toBeLessThanOrEqual(FIELD.behind);
    }
  });

  it('slots past the count fade out', () => {
    const f = new BubbleField(16, seeded(8));
    f.count = 16;
    f.update(0, 0, 50, 0, 0, flat);
    f.count = 8;
    f.update(1, 0, 50, 0, 0, flat);
    for (let i = 8; i < 16; i++) expect(f.slots[i].fadeAt).toBe(1);
    f.update(1 + FIELD.grow + 0.01, 0, 50, 0, 0, flat);
    for (let i = 8; i < 16; i++) expect(f.slots[i].live).toBe(false);
  });

  it('clear fades every bubble and none stays hittable', () => {
    const f = new BubbleField(8, seeded(9));
    f.count = 8;
    f.update(0, 0, 50, 0, 0, flat);
    f.clear(3);
    for (let i = 0; i < 8; i++) {
      expect(f.slots[i].fadeAt).toBe(3);
      expect(f.hittable(i, 3)).toBe(false);
    }
    expect(f.visible(3 + FIELD.grow * 0.5)).toBe(true);
    expect(f.visible(3 + FIELD.grow + 0.01)).toBe(false);
  });
});

describe('BubbleField.reset (the shader clock went back to 0)', () => {
  it('empties every slot so they respawn on the new clock', () => {
    const f = new BubbleField(8, seeded(10));
    f.count = 8;
    f.update(5000, 0, 50, 0, 0, flat);
    const v = f.version;
    f.reset();
    expect(f.version).toBeGreaterThan(v);
    for (const s of f.slots) expect(s.live).toBe(false);
    f.update(0, 0, 50, 0, 0, flat);
    for (const s of f.slots) expect(s.born).toBe(0);
  });
});

describe('BubbleField.pick ranking', () => {
  it('a bubble the ray truly hits beats a nearer one only caught by the aim assist', () => {
    const f = new BubbleField(2, seeded(11));
    f.count = 2;
    // Near one at 30 m, the ray passing 1.2 R from its centre (inside 1.3 R, outside R).
    place(f.slots[0], 1.2 * 2, 0, 30, 2);
    // Far one at 50 m, dead on.
    place(f.slots[1], 0, 0, 50, 1.5);
    const hit = new Float32Array(1);
    expect(f.pick(0, 0, 0, 0, 0, 1, 250, 0, hit)).toBe(1);
    // The hit is on its real film, not on the inflated sphere.
    expect(hit[0]).toBeCloseTo(50 - 1.5, 3);
  });
  it('with no true hit the nearest assisted one wins', () => {
    const f = new BubbleField(1, seeded(12));
    f.count = 1;
    place(f.slots[0], 1.2 * 2, 0, 30, 2);
    const hit = new Float32Array(1);
    expect(f.pick(0, 0, 0, 0, 0, 1, 250, 0, hit)).toBe(0);
  });
});
