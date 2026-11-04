import { describe, expect, it } from 'vitest';
import { BACK, BACK_FAST, CLEARANCE, CRUISE, MantaFlight, SPRINT, angleTo, flightInput, type FlightWorld } from '../src/activities/flight/mantaFlight';

/** Flat sea everywhere, with a 30 m wall of trees across x ∈ [100, 120] if `wall`. */
function world(wall = false): FlightWorld {
  return { floor: (x) => (wall && x >= 100 && x <= 120 ? 30 : 0) };
}

function fly(f: MantaFlight, seconds: number, set: (c: ReturnType<typeof flightInput>) => void): void {
  const c = flightInput();
  set(c);
  for (let t = 0; t < seconds; t += 1 / 60) f.update(1 / 60, c);
}

describe('manta flight', () => {
  it('W settles at cruise speed, Shift at sprint speed, letting go coasts to a hover', () => {
    const f = new MantaFlight(world());
    f.place(0, 40, 0, 0);
    fly(f, 20, (c) => (c.thrust = 1));
    expect(f.speed).toBeGreaterThan(CRUISE * 0.95);
    expect(f.speed).toBeLessThan(CRUISE * 1.05);
    fly(f, 20, (c) => {
      c.thrust = 1;
      c.sprint = true;
    });
    expect(f.speed).toBeGreaterThan(SPRINT * 0.95);
    fly(f, 40, () => {});
    expect(f.speed).toBe(0);
  });

  it('S backs up slowly (Shift: twice as fast) and letting go stops it', () => {
    const f = new MantaFlight(world());
    f.place(0, 40, 0, 0);
    fly(f, 10, (c) => (c.back = 1));
    expect(f.speed).toBeLessThan(-BACK * 0.95);
    expect(f.speed).toBeGreaterThan(-BACK * 1.05);
    // Forward is −z at yaw 0: backing up goes +z.
    expect(f.z).toBeGreaterThan(20);
    fly(f, 10, (c) => {
      c.back = 1;
      c.sprint = true;
    });
    expect(f.speed).toBeLessThan(-BACK_FAST * 0.95);
    fly(f, 30, () => {});
    expect(f.speed).toBe(0);
  });

  it('D turns right (yaw falls) and banks right wing down; A the other way', () => {
    const f = new MantaFlight(world());
    f.place(0, 40, 0, 0);
    fly(f, 5, (c) => (c.thrust = 1));
    fly(f, 1, (c) => {
      c.thrust = 1;
      c.turn = 1;
    });
    expect(f.yawRate).toBeLessThan(0);
    expect(f.roll).toBeGreaterThan(0.1);
    fly(f, 3, (c) => {
      c.thrust = 1;
      c.turn = -1;
    });
    expect(f.yawRate).toBeGreaterThan(0);
    expect(f.roll).toBeLessThan(-0.1);
  });

  it('the mouse aim turns it toward the aimed heading', () => {
    const f = new MantaFlight(world());
    f.place(0, 40, 0, 0);
    fly(f, 6, (c) => {
      c.thrust = 1;
      c.aimYaw = 1.2;
    });
    expect(Math.abs(angleTo(f.yaw, 1.2))).toBeLessThan(0.05);
  });

  it('never flies into the floor: it climbs over a wall of trees ahead', () => {
    const f = new MantaFlight(world(true));
    // Heading +x: yaw = −π/2 (forward is (−sin, −cos)).
    f.place(0, 8, 0, -Math.PI / 2);
    let lowest = Infinity;
    const c = flightInput();
    c.thrust = 1;
    c.climb = -1;
    for (let t = 0; t < 15; t += 1 / 60) {
      f.update(1 / 60, c);
      if (f.x >= 100 && f.x <= 120) lowest = Math.min(lowest, f.y);
    }
    expect(f.x).toBeGreaterThan(120);
    expect(lowest).toBeGreaterThan(30 + CLEARANCE - 1.01);
  });

  it('hovering, up lifts it straight up and down (Space) lowers it to the clearance', () => {
    const f = new MantaFlight(world());
    f.place(5, 20, 5, 0);
    fly(f, 2, (c) => (c.climb = 1));
    expect(f.y).toBeGreaterThan(25);
    expect(Math.hypot(f.x - 5, f.z - 5)).toBeLessThan(0.01);
    fly(f, 20, (c) => (c.climb = -1));
    expect(f.y).toBeGreaterThan(CLEARANCE - 1.01);
    expect(f.y).toBeLessThan(CLEARANCE + 0.5);
  });

  it('far out at sea it turns back toward the island by itself', () => {
    const f = new MantaFlight(world());
    // At x = 600 heading further out (+x).
    f.place(600, 40, 0, -Math.PI / 2);
    fly(f, 30, (c) => (c.thrust = 1));
    expect(Math.hypot(f.x, f.z)).toBeLessThan(600);
  });
});
