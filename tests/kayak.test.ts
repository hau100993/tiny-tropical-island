import { describe, expect, it } from 'vitest';
import { KayakBody, Paddle, type KayakEnv, type PaddleControls } from '../src/activities/kayakPhysics';

/** Calm, deep water, nothing in the way. */
const flat: KayakEnv = {
  water: (_x, _z, out) => {
    out.height = 0;
    out.dhdx = 0;
    out.dhdz = 0;
    return out;
  },
  ground: () => -5,
  block: (x, z, _y, _r, out) => {
    out.x = x;
    out.z = z;
  },
};

const NONE: PaddleControls = { left: false, right: false, cruise: false, back: false, sweep: false };

function run(ctl: Partial<PaddleControls>, seconds: number, body = new KayakBody(flat), paddle = new Paddle()): { body: KayakBody; turned: number } {
  const c = { ...NONE, ...ctl };
  const dt = 1 / 60;
  const yaw0 = body.yaw;
  for (let t = 0; t < seconds; t += dt) {
    paddle.update(dt, c);
    body.step(dt, paddle);
  }
  return { body, turned: body.yaw - yaw0 };
}

describe('kayak physics', () => {
  it('steady alternating strokes cruise at a real sea-kayak pace and go straight', () => {
    const { body, turned } = run({ cruise: true }, 30);
    console.info(`cruise ${body.speed.toFixed(2)} m/s, heading drift ${turned.toFixed(3)} rad`);
    expect(body.speed).toBeGreaterThan(1.2);
    expect(body.speed).toBeLessThan(2.4);
    expect(Math.abs(turned)).toBeLessThan(0.35);
  });

  it('strokes on the left only turn the boat to the right', () => {
    const { turned } = run({ left: true }, 6);
    console.info(`left only: ${turned.toFixed(2)} rad in 6 s`);
    expect(turned).toBeLessThan(-0.5);
  });

  it('a sweep turns much more than a forward stroke', () => {
    const fwd = run({ right: true }, 1.4);
    const sweep = run({ right: true, sweep: true }, 1.4);
    console.info(`one stroke: forward ${fwd.turned.toFixed(2)} rad / ${fwd.body.speed.toFixed(2)} m/s, sweep ${sweep.turned.toFixed(2)} rad / ${sweep.body.speed.toFixed(2)} m/s`);
    expect(Math.abs(sweep.turned)).toBeGreaterThan(Math.abs(fwd.turned) * 1.5);
  });

  it('reverse strokes back up, and stop a moving boat', () => {
    const back = run({ back: true }, 8);
    console.info(`reverse ${back.body.speed.toFixed(2)} m/s`);
    expect(back.body.speed).toBeLessThan(-0.4);
    const moving = run({ cruise: true }, 10);
    const v0 = moving.body.speed;
    run({ back: true }, 2.5, moving.body);
    expect(moving.body.speed).toBeLessThan(v0 * 0.4);
  });

  it('glides on after the last stroke, then slows down', () => {
    const { body } = run({ cruise: true }, 15);
    const v0 = body.speed;
    run({}, 5, body);
    expect(body.speed).toBeGreaterThan(0.1);
    expect(body.speed).toBeLessThan(v0 * 0.8);
  });

  it('runs aground and stops on a beach', () => {
    // Seabed rising toward −Z (the bow's direction): dry land past z = −20.
    const beach: KayakEnv = { ...flat, ground: (_x, z) => -1.5 + Math.max(0, -z) * 0.075 };
    const { body } = run({ cruise: true }, 40, new KayakBody(beach));
    expect(body.z).toBeGreaterThan(-24);
    expect(body.z).toBeLessThan(-12);
    expect(body.grounded).toBeGreaterThan(0.3);
  });
});
