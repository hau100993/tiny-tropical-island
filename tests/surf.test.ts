import { describe, expect, it } from 'vitest';
import { SurfBody, type SurfControls, type SurfEnv, type SurfEvent } from '../src/activities/surfPhysics';
import { SURF, createSurfSample, sampleSurf, type SurfFrame } from '../src/water/surf';

// A straight beach: the waves run along +x, the waterline at x = 0, the seabed shelving 1:8.
const frame: SurfFrame = { ox: 0, oz: 0, ux: 1, uz: 0 };
const ground = (x: number): number => x / 8;
const depthAt = (x: number): number => -ground(x);
let time = 0;
/** The "Sóng biển" slider. */
let level = 0.45;
const env: SurfEnv = {
  ux: 1,
  uz: 0,
  level: () => level,
  water(x, z, out) {
    const s = sampleSurf(frame, x, z, time, level, depthAt, createSurfSample());
    out.height = s.height;
    out.dhdx = s.dhdx;
    out.dhdz = s.dhdz;
    return out;
  },
  surf: (x, z, out) => sampleSurf(frame, x, z, time, level, depthAt, out),
  ground: (x) => ground(x),
  block(x, z, _y, _r, out) {
    out.x = x;
    out.z = z;
  },
};

const ctl = (p: Partial<SurfControls> = {}): SurfControls => ({ forward: false, back: false, steer: 0, hard: false, ...p });
/** Facing the beach (+x): forward = (−sin yaw, −cos yaw). */
const TO_BEACH = -Math.PI / 2;
const DT = 1 / 60;

/**
 * Lie on the board out back (facing `yaw`, not paddling) and press Space every frame: the first
 * press inside the window starts the catch; then just hold on until standing (or missed).
 */
function catchWave(t0: number, x0 = -55, yaw = TO_BEACH): { body: SurfBody; caught: boolean; tries: Record<string, number> } {
  time = t0;
  const body = new SurfBody(env);
  body.place(x0, 0, yaw);
  body.state = 'prone';
  const tries: Record<string, number> = {};
  for (let i = 0; i < 60 * 30; i++) {
    time += DT;
    const e = body.step(DT, ctl());
    if (e === 'stand') return { body, caught: true, tries };
    if (e === 'missed') tries.missed = (tries.missed ?? 0) + 1;
    if (body.state === 'prone') {
      const r = body.popUp();
      tries[r] = (tries[r] ?? 0) + 1;
    }
  }
  return { body, caught: false, tries };
}

function ride(body: SurfBody, seconds: number, c: SurfControls): { event: SurfEvent; t: number; maxSpeed: number; minX: number; maxX: number } {
  let maxSpeed = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < seconds * 60; i++) {
    time += DT;
    const e = body.step(DT, c);
    maxSpeed = Math.max(maxSpeed, Math.hypot(body.vx, body.vz));
    minX = Math.min(minX, body.wave.x);
    maxX = Math.max(maxX, body.wave.x);
    if (e !== 'none') return { event: e, t: i / 60, maxSpeed, minX, maxX };
  }
  return { event: 'none', t: seconds, maxSpeed, minX, maxX };
}

describe('surf break', () => {
  it('the wave is steep in front, gentle behind, and breaks from one end', () => {
    // At the break line, a crest at x = −30 (t chosen so): face slope > back slope.
    const s = createSurfSample();
    // The crest (d = 0) is where (x − c·t) / L is a half-integer: put one at x = −30.
    time = (-30 + 100.5 * SURF.length) / SURF.speed;
    let face = 0;
    let back = 0;
    for (let x = -60; x < -10; x += 0.25) {
      sampleSurf(frame, x, 40, time, level, depthAt, s);
      if (s.d > 0) face = Math.min(face, s.dhdx);
      else back = Math.max(back, s.dhdx);
    }
    expect(-face).toBeGreaterThan(back * 1.6);
    // Broken at the peel's start side, still clean on the far shoulder.
    const crestX = (l: number): number => {
      let best = -Infinity;
      let bx = 0;
      for (let x = -40; x < -12; x += 0.1) {
        const h = sampleSurf(frame, x, l, time, level, depthAt, s).height;
        if (h > best) {
          best = h;
          bx = x;
        }
      }
      return bx;
    };
    sampleSurf(frame, crestX(-45), -45, time, level, depthAt, s);
    const left = s.broken;
    sampleSurf(frame, crestX(45), 45, time, level, depthAt, s);
    expect(left).toBeGreaterThan(0.5);
    expect(s.broken).toBeLessThan(0.1);
  });

  it('Space as a wave comes catches it, even facing out to sea; no Space, no ride', () => {
    const r = catchWave(3.7);
    console.info('catch tries', r.tries, 'at x', r.body.wave.x.toFixed(1));
    expect(r.caught).toBe(true);
    expect(r.body.state).toBe('ride');
    // Lying the wrong way round (nose out to sea): the board turns for the beach by itself.
    const back = catchWave(3.7, -55, TO_BEACH + Math.PI);
    expect(back.caught).toBe(true);
    time = 3.7;
    const idle = new SurfBody(env);
    idle.place(-55, 0, TO_BEACH);
    idle.state = 'prone';
    for (let i = 0; i < 60 * 20; i++) {
      time += DT;
      idle.step(DT, ctl({ forward: true }));
    }
    expect(idle.state).toBe('prone');
  });

  it('the ride goes the way the nose points along the beach', () => {
    // u = +x here, +l = +z. Forward is (−sin yaw, −cos yaw): yaw −π/2 + 0.5 leans to −z
    // (forward z = −cos yaw = −sin 0.5 < 0), −π/2 − 0.5 leans to +z.
    const left = catchWave(3.7, -55, TO_BEACH + 0.5);
    ride(left.body, 1.5, ctl());
    expect(left.caught).toBe(true);
    expect(left.body.vz).toBeLessThan(-0.5);
    const right = catchWave(3.7, -55, TO_BEACH - 0.5);
    ride(right.body, 1.5, ctl());
    expect(right.caught).toBe(true);
    expect(right.body.vz).toBeGreaterThan(0.5);
  });

  it('angled along the shoulder, the ride lasts and goes fast', () => {
    // Nose angled toward the unbroken shoulder (+z here, the far end of the peel): the catch
    // keeps that line, then just ride on.
    const r = catchWave(3.7, -55, TO_BEACH - 0.6);
    const body = r.body;
    const long = ride(body, 8, ctl());
    console.info('ride', long, 'state', body.state);
    expect(long.t).toBeGreaterThan(4);
    expect(long.maxSpeed).toBeGreaterThan(SURF.speed + 1);
    // The ride clock (Bé Mập's celebration waits for it).
    expect(body.rideTime).toBeGreaterThan(4);
  });

  it('Space keeps the line the nose points (no swing to a fixed angle)', () => {
    for (const off of [0, 0.4, -0.4]) {
      const r = catchWave(3.7, -55, TO_BEACH + off);
      expect(r.caught).toBe(true);
      const turned = Math.atan2(Math.sin(r.body.yaw - (TO_BEACH + off)), Math.cos(r.body.yaw - (TO_BEACH + off)));
      expect(Math.abs(turned)).toBeLessThan(0.15);
    }
  });

  it('holding A or D rides along the wave instead of falling over its back', () => {
    for (const steer of [1, -1]) {
      const r = catchWave(3.7);
      const res = ride(r.body, 12, ctl({ steer }));
      console.info('hold steer', steer, res.event, res.t.toFixed(1));
      expect(res.t).toBeGreaterThan(10);
    }
  });

  it('a normal carve holds (and keeps its speed)', () => {
    const r = catchWave(3.7);
    ride(r.body, 1.0, ctl());
    ride(r.body, 1.0, ctl());
    const v0 = Math.hypot(r.body.vx, r.body.vz);
    const res = ride(r.body, 1.0, ctl({ steer: 1 }));
    expect(res.event).not.toBe('wipeout');
    expect(Math.hypot(r.body.vx, r.body.vz)).toBeGreaterThan(v0 * 0.6);
  });

  it('on small waves even a hard carve holds', () => {
    level = 0.15;
    const r = catchWave(3.7);
    ride(r.body, 2.0, ctl());
    const res = ride(r.body, 2, ctl({ steer: 1, hard: true }));
    level = 0.45;
    expect(r.caught).toBe(true);
    expect(res.event).not.toBe('wipeout');
  });

  it('the face holds the board: riding straight on, the wave carries it to the beach', () => {
    const r = catchWave(3.7);
    const res = ride(r.body, 25, ctl());
    console.info('hands off', res);
    // Still riding (or just lying down in the close-out) right in by the beach.
    expect(res.maxX).toBeGreaterThan(-16);
    expect(res.event === 'none' || res.event === 'waveGone' || res.event === 'beach').toBe(true);
  });

  it('a hard carve at speed wipes out', () => {
    const r = catchWave(3.7);
    // Turn further along the wave (toward +z, the open shoulder) for speed.
    ride(r.body, 0.6, ctl({ steer: -1 }));
    ride(r.body, 1.0, ctl());
    const res = ride(r.body, 3, ctl({ steer: 1, hard: true }));
    console.info('carve', res);
    expect(res.event).toBe('wipeout');
    // A moment in the white water, then lying on the board again by itself.
    const back = ride(r.body, 3, ctl());
    expect(back.event).toBe('remount');
    expect(r.body.state).toBe('prone');
  });
});
