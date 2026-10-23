import { describe, expect, it } from 'vitest';
import { PAT_MOVE, PAT_TIME, Petting, rayEllipsoid } from '../src/activities/petting';

describe('petting', () => {
  it('a quick, still click is a pat with hearts', () => {
    const p = new Petting();
    p.start();
    p.update(0.1);
    expect(p.stroking).toBe(false);
    p.end();
    expect(p.takePat()).toBe(true);
    expect(p.takePat()).toBe(false);
    expect(p.takeHearts()).toBe(2);
    expect(p.affection).toBeGreaterThan(0);
  });

  it('holding or moving makes it a stroke, not a pat', () => {
    const held = new Petting();
    held.start();
    held.update(PAT_TIME + 0.05);
    expect(held.stroking).toBe(true);
    held.end();
    expect(held.takePat()).toBe(false);

    const moved = new Petting();
    moved.start();
    moved.move(PAT_MOVE + 1, 0);
    expect(moved.stroking).toBe(true);
    moved.end();
    expect(moved.takePat()).toBe(false);
  });

  it('the hand goes head → back → head with the mouse travel', () => {
    const p = new Petting();
    p.start();
    p.move(70, 0);
    expect(p.stroke).toBeCloseTo(0.5, 5);
    expect(p.returning).toBe(false);
    p.move(0, 105);
    expect(p.stroke).toBeCloseTo(0.75, 5);
    expect(p.returning).toBe(true);
    p.move(105, 0);
    expect(p.stroke).toBeCloseTo(0, 5);
  });

  it('stroking gives hearts by distance and over time, and affection that fades after', () => {
    const p = new Petting();
    p.start();
    p.move(600, 0);
    expect(p.takeHearts()).toBe(2);
    for (let i = 0; i < 20; i++) p.update(0.1);
    expect(p.takeHearts()).toBe(1);
    const love = p.affection;
    expect(love).toBeGreaterThan(0.3);
    p.cancel();
    expect(p.takePat()).toBe(false);
    p.update(5);
    expect(p.affection).toBeLessThan(love);
    expect(p.stroke).toBe(0);
  });
});

describe('rayEllipsoid', () => {
  it('hits from outside at the surface', () => {
    // Along +X toward an ellipsoid at x = 5 with radius 2 along X.
    expect(rayEllipsoid(0, 0, 0, 1, 0, 0, 5, 0, 0, 2, 1, 1)).toBeCloseTo(3, 6);
    // Radius along Y matters for a ray along Y.
    expect(rayEllipsoid(0, -10, 0, 0, 1, 0, 0, 0, 0, 2, 3, 1)).toBeCloseTo(7, 6);
  });

  it('misses beside it and behind', () => {
    expect(rayEllipsoid(0, 1.5, 0, 1, 0, 0, 5, 0, 0, 2, 1, 1)).toBeNull();
    expect(rayEllipsoid(0, 0, 0, -1, 0, 0, 5, 0, 0, 2, 1, 1)).toBeNull();
  });

  it('is 0 from inside', () => {
    expect(rayEllipsoid(5, 0, 0, 1, 0, 0, 5, 0, 0, 2, 1, 1)).toBe(0);
  });
});
