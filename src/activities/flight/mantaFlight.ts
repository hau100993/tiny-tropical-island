import { clamp, damp } from '../../core/math';

/** Fixed physics step (s): the same flight at any frame rate. */
const STEP = 1 / 120;
/** Cruise and sprint top speeds (m/s); thrust is sized so drag balances it there. */
export const CRUISE = 14;
export const SPRINT = 26;
const THRUST = 5;
const DRAG = THRUST / (CRUISE * CRUISE);
const SPRINT_THRUST = DRAG * SPRINT * SPRINT;
/** Backing up (S): a slow scull, Shift twice as fast (m/s); its own drag sets those speeds. */
export const BACK = 5;
export const BACK_FAST = 10;
const BACK_THRUST = 3;
const BACK_DRAG = BACK_THRUST / (BACK * BACK);
const BACK_FAST_THRUST = BACK_DRAG * BACK_FAST * BACK_FAST;
/** Without thrust it coasts, slowing to a hover; braking (landing) slows it harder. */
const COAST = 0.9;
const BRAKE = 7;
/** Diving gains speed, climbing costs it: half of g·sin(pitch) (a manta, not a stone). */
const TRADE = 4.9;
/** Fastest turn (rad/s) and steepest flight path (rad). */
const TURN = 1.15;
const MAX_PITCH = 0.62;
/** Straight up or down at a hover (m/s), fading out as it picks up speed. */
const HOVER_CLIMB = 4.5;
/** Its middle stays this far above whatever is below (m): the wings droop ~1.3 m in a flap. */
export const CLEARANCE = 3;
/** Looks this far ahead (s of flight) for something to climb over. */
const LOOKAHEAD = 1.1;
/** Soft ceiling (m) and the radius where it turns back toward the island (m). */
const CEILING = 140;
const BOUND = 520;
const G = 9.81;

/** What the rider asks for this frame. */
export interface FlightInput {
  /** W: 0 … 1 (the joystick pushes less). */
  thrust: number;
  /** S: back up, 0 … 1. */
  back: number;
  /** Shift: W or S faster. */
  sprint: boolean;
  /** Slow to a hover (landing, or nobody on it). */
  brake: boolean;
  /** A/D: −1 (left) … 1 (right). */
  turn: number;
  /** Up (+1) / down (−1): Space goes down; the touch buttons both ways. */
  climb: number;
  /**
   * The mouse steering while moving: the heading and flight-path pitch to head for (camera
   * direction), or NaN when the keys alone steer.
   */
  aimYaw: number;
  aimPitch: number;
}

export interface FlightWorld {
  /** Highest thing below (x, z): ground, sea, a treetop, the roof. */
  floor(x: number, z: number): number;
}

export function flightInput(): FlightInput {
  return { thrust: 0, back: 0, sprint: false, brake: false, turn: 0, climb: 0, aimYaw: Number.NaN, aimPitch: Number.NaN };
}

/** Shortest signed angle from `a` to `b` (rad). */
export function angleTo(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The manta's flight as a small point body: heading (yaw; forward is (−sin, −cos) like the
 * walker), flight-path pitch and speed along it. Arcade, but with the feel of a glider: thrust
 * against drag ∝ v², height traded for speed, a bank angle that follows the turn (a
 * coordinated turn: tan(roll) = v·ω / g). It can hover and never crashes: the floor (with a
 * look ahead) lifts it over the island, a soft ceiling and a soft boundary keep it near.
 */
export class MantaFlight {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  speed = 0;
  /** Turn rate (rad/s, + left like yaw) and the bank it leans into (rad, + right wing down). */
  yawRate = 0;
  roll = 0;
  /** Vertical speed this step (m/s), for the animation and the camera. */
  vy = 0;
  /** Its middle's lowest allowed height here (m), with the clearance. */
  minY = 0;
  /** How far it may come down to the floor (m): CLEARANCE in flight, less when landing. */
  clearance = CLEARANCE;
  private acc = 0;

  constructor(private readonly world: FlightWorld) {}

  place(x: number, y: number, z: number, yaw: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.speed = 0;
    this.yawRate = 0;
    this.roll = 0;
    this.vy = 0;
  }

  update(dt: number, input: Readonly<FlightInput>): void {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) {
      this.step(STEP, input);
      this.acc -= STEP;
    }
  }

  private step(dt: number, c: Readonly<FlightInput>): void {
    // ---- Speed along the path (negative: backing up) ----
    const v = this.speed;
    const thrust = c.thrust * (c.sprint ? SPRINT_THRUST : THRUST) - c.back * (c.sprint ? BACK_FAST_THRUST : BACK_THRUST);
    const drag = (v < 0 ? BACK_DRAG : DRAG) * v * Math.abs(v);
    // Height is traded for speed only flying forward.
    let a = thrust - drag - (v > 0 ? TRADE * Math.sin(this.pitch) : 0);
    const keys = c.thrust > 0 || c.back > 0;
    if (!keys) a -= COAST * Math.sign(v);
    if (c.brake) a -= BRAKE * Math.sign(v);
    let next = v + a * dt;
    // Coasting and braking stop it; only the keys turn it round.
    if (!keys && Math.sign(next) !== Math.sign(v)) next = 0;
    this.speed = next;

    // ---- Heading: keys turn at a rate, the mouse aims (and both may play) ----
    // Yaw grows to the left; the keys say right = +1.
    let want = -c.turn * TURN;
    if (!Number.isNaN(c.aimYaw)) want += clamp(angleTo(this.yaw, c.aimYaw) * 2.2, -TURN, TURN);
    // Past the boundary: a growing pull back toward the island (heading home: forward = −position).
    const r = Math.hypot(this.x, this.z);
    if (r > BOUND) {
      const home = Math.atan2(this.x, this.z);
      want += clamp(angleTo(this.yaw, home) * 1.5, -TURN, TURN) * clamp((r - BOUND) / 80, 0, 1);
    }
    want = clamp(want, -TURN, TURN);
    this.yawRate += (want - this.yawRate) * damp(4, dt);
    this.yaw += this.yawRate * dt;

    // ---- Flight path: climb keys, or the mouse's pitch while moving ----
    let pitch = c.climb * 0.5;
    if (!Number.isNaN(c.aimPitch) && c.climb === 0) pitch = clamp(c.aimPitch, -MAX_PITCH, MAX_PITCH);
    const floor = this.floorAhead();
    this.minY = floor + this.clearance;
    // Low over the floor: never point down into it; well under it: climb.
    if (this.y < this.minY + 4) pitch = Math.max(pitch, clamp((this.minY - this.y) * 0.15, -0.05, MAX_PITCH));
    if (this.y > CEILING) pitch = Math.min(pitch, -clamp((this.y - CEILING) * 0.02, 0, 0.3));
    // Too slow for its pitch to carry it: the climb keys lift it straight up instead.
    const flying = clamp(this.speed / 8, 0, 1);
    this.pitch += (clamp(pitch, -MAX_PITCH, MAX_PITCH) * flying - this.pitch) * damp(2.5, dt);

    // ---- Move ----
    const cp = Math.cos(this.pitch);
    this.vy = this.speed * Math.sin(this.pitch) + c.climb * HOVER_CLIMB * (1 - flying);
    this.x += -Math.sin(this.yaw) * this.speed * cp * dt;
    this.z += -Math.cos(this.yaw) * this.speed * cp * dt;
    this.y += this.vy * dt;
    if (this.y > CEILING + 20) this.y = CEILING + 20;
    // The floor: eased up from under it (no bump), never more than a metre into the clearance.
    const under = this.world.floor(this.x, this.z) + this.clearance;
    if (this.y < under) {
      this.y += (under - this.y) * damp(6, dt);
      this.y = Math.max(this.y, under - 1);
      if (this.vy < 0) this.vy = 0;
    }

    // ---- Bank into the turn (coordinated), a little even at a hover ----
    const bank = Math.atan((Math.max(this.speed, 3) * -this.yawRate) / G);
    this.roll += (clamp(bank, -0.75, 0.75) - this.roll) * damp(3, dt);
  }

  /** The floor under it and where it will be in LOOKAHEAD seconds, whichever is higher. */
  private floorAhead(): number {
    const d = this.speed * LOOKAHEAD;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    let f = this.world.floor(this.x, this.z);
    f = Math.max(f, this.world.floor(this.x + fx * d * 0.5, this.z + fz * d * 0.5));
    f = Math.max(f, this.world.floor(this.x + fx * d, this.z + fz * d));
    return f;
  }
}
