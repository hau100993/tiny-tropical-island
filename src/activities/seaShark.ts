import * as THREE from 'three';
import type { SharkAction, SharkModel } from '../world/creatures/sharkModel';
import type { SpraySink } from '../water/Spray';
import type { EmberSink } from '../world/creatures/embers';

/** What you are doing at sea (null: not at sea). */
export type SeaMode = 'kayak' | 'surf' | 'swim' | 'dive';

export interface SeaPlayer {
  mode: SeaMode | null;
  x: number;
  z: number;
  /** The sea surface over you; diving: your head. */
  y: number;
}

/** What Bé Mập needs from the app: the sea, you, and what its pranks do to you. */
export interface SharkHost {
  seaHeight(x: number, z: number): number;
  ground(x: number, z: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  spray: SpraySink;
  /** Air bubbles under water. */
  bubbles: SpraySink;
  player(out: SeaPlayer): void;
  kayak: {
    jolt(roll: number, heave: number): void;
    shove(spin: number, vx: number, vz: number): void;
    capsize(side: 1 | -1): boolean;
    splash(n: number): void;
  };
  surfKnock(): void;
  /** Seconds the surfer has been riding this wave (0: not riding). */
  rideTime(): number;
  /** Rainbow motes in the air (the celebration leap). */
  rainbow: EmberSink;
  /** Swimming or diving: shoved (m/s; vy up, diving only). */
  swimPush(vx: number, vz: number, vy: number): void;
  soak(): void;
  /** Sea sparkle on the water (night: the fin's glowing trail). */
  glow: EmberSink;
  /** 0 full day … 1 deep night. */
  night(): number;
  /** A short note for you: it became your friend, you shooed it off, or it cheers your ride. */
  notify(kind: 'friend' | 'shoo' | 'cheer'): void;
  sound: {
    splash(gain: number, pan: number): void;
    giggle(gain: number, pan: number): void;
  };
  ear(x: number, y: number, z: number): { gain: number; pan: number } | null;
  /** Loads the model (once) and puts it in the scene. */
  load(): Promise<SharkModel>;
}

/** First visit after this long at sea (s); between visits (s, random in the range). */
const FIRST_AFTER = 30;
const COOLDOWN = [100, 220] as const;
/** Only where the water is at least this deep under you (m). */
const MIN_DEPTH = 1.5;
/** Arrives from this far (m); circles you this wide (m) for WARN s (its warning). */
const SPAWN_R = 22;
const CIRCLE_R = 5.5;
const WARN = [5, 8] as const;
/** Swimming speeds (m/s): arriving, circling, leaving. */
const ARRIVE = 4.5;
const CIRCLE = 3;
const LEAVE = 5;
/** The fin cuts the surface with the body this far below it (m). */
const FIN_DEPTH = 0.12;
const GRAVITY = 9.81;
/** Whirlpool: its radius (m), angular speed (rad/s), length (s). */
const WHIRL_R = 2.2;
const WHIRL_W = 3.2;
const WHIRL_TIME = 3.5;

/** After this many pranks it is your friend: most visits it swims along with you instead. */
const FRIEND_AFTER = 3;
/** A friend still plays a prank now and then (this share of its visits). */
const FRIEND_PRANKS = 0.25;
/** A friend's visit: how long it swims with you (s), how often it leaps for show (s). */
const ESCORT = [35, 60] as const;
const SHOW_JUMP = [8, 14] as const;
/** Riding one wave this long (s): Bé Mập leaps for you, once a ride (its celebration). */
export const CHEER_AFTER = 8;
/** The celebration leap: time in the air (s, a high arc ~4.4 m), barrel rolls on the way. */
const CHEER_T = 1.9;
const CHEER_ROLLS = 2;
/**
 * Leap lines to try, [ahead, across] of take-off and landing (m, across toward one side; the
 * landing also gets your travel meanwhile). All well ahead and inside the view of the camera
 * behind you: across your line, nearer, then (shallow on one side, near the beach) along it on
 * the deeper side.
 */
const CHEER_LINES: readonly (readonly [number, number, number, number])[] = [
  [11, 4, 9, -4],
  [8, 3, 6, -3],
  [10, 3.5, 8, 2.5],
  [6, 2.5, 5, 2],
];
/** Its rainbow: bands across the arc, their spacing (m), motes per band per second. */
const RAINBOW_BANDS = 7;
const RAINBOW_GAP = 0.13;
const RAINBOW_RATE = 120;
/** Where its friendship is kept (survives reloads). */
const STORAGE_KEY = 'tsw.beMap';

type Skill = 'breach' | 'bump' | 'whirl';
type State = 'away' | 'approach' | 'circle' | 'set' | 'breach' | 'rise' | 'whirl' | 'escort' | 'cheerSet' | 'cheer' | 'leave';

function loadPranks(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { pranks?: unknown };
    return typeof raw.pranks === 'number' && raw.pranks >= 0 ? Math.floor(raw.pranks) : 0;
  } catch {
    return 0;
  }
}

function savePranks(n: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pranks: n }));
  } catch {
    // Storage blocked (private window): the friendship lasts only this session.
  }
}

/**
 * Bé Mập, the baby shark: lives out at sea and comes to play while you are on it (kayak, surf,
 * swim, dive), at most every few minutes. It warns you first, circling with its fin cutting the
 * surface and a giggle, then plays one of three pranks at a random strength (light, medium,
 * strong): "Cú Nhảy Ùm", a leap over you and a big splash; "Húc Đùa", a bump from below; "Xoáy
 * Nước", a tight whirl round you that spins you. What they do depends on what you are doing:
 * the kayak rocks, spins or capsizes (rolling up again), the surfer is knocked off, a swimmer or
 * diver is shoved; you always get wet. Then it swims off and dives. Ride one wave for
 * CHEER_AFTER s and it comes to celebrate: "Cầu Vồng Mập", a high leap across your line with
 * barrel rolls, drawing a rainbow in the air, a burst of coloured sparkles at the top.
 */
export class SeaShark {
  private enabled = true;
  private model: SharkModel | null = null;
  private loading = false;
  private state: State = 'away';
  private timer = 0;
  private cooldown = FIRST_AFTER;
  private skill: Skill = 'breach';
  /** 0 light … 2 strong. */
  private level = 0;
  /** Which way it circles / you get rocked (±1). */
  private side: 1 | -1 = 1;
  private angle = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private speed = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private hit = false;
  private rippleIn = 0;
  /** Pranks played on you so far (kept); a friend from FRIEND_AFTER on. */
  private pranks = loadPranks();
  /** This visit is a friend's: it swims along with you (escort) instead of a prank. */
  private friendly = false;
  private escortLeft = 0;
  private showJumpIn = 0;
  /** Your heading and speed (from how you moved), for swimming beside you. */
  private heading = 0;
  private pSpeed = 0;
  private lastX = NaN;
  private lastZ = NaN;
  /** This ride has been celebrated already. */
  private cheered = false;
  private rainbowIn = 0;
  private readonly p: SeaPlayer = { mode: null, x: 0, z: 0, y: 0 };
  private readonly fin = new THREE.Vector3();
  /** The celebration's take-off (x, y: its x, z) and landing (z, w: its x, z) points. */
  private readonly cheerAt = new THREE.Vector4();

  constructor(private readonly host: SharkHost) {}

  /** Where it is now (its back, world), or false while away (Thú Cưng feeding). */
  spot(out: { x: number; y: number; z: number }): boolean {
    if (this.state === 'away' || !this.model?.root.visible) return false;
    out.x = this.x;
    out.y = Math.max(this.y, this.host.seaHeight(this.x, this.z)) + 0.35;
    out.z = this.z;
    return true;
  }

  /** The model (Level 2 changes its look), once loaded. */
  get root(): THREE.Object3D | null {
    return this.model?.root ?? null;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.state !== 'away') this.go('leave', 4);
  }

  update(dt: number): void {
    const h = this.host;
    const p = this.p;
    h.player(p);
    const atSea = this.enabled && p.mode !== null;
    if (atSea && !this.model && !this.loading) {
      this.loading = true;
      h.load()
        .then((m) => {
          this.model = m;
          m.root.visible = false;
        })
        .catch((err: unknown) => console.warn('shark load failed', err))
        .finally(() => {
          this.loading = false;
        });
    }
    const m = this.model;
    if (!m) return;
    if (atSea) this.cooldown -= dt;
    // Your heading and speed, from how you moved since the last frame.
    if (atSea && Number.isFinite(this.lastX) && dt > 0) {
      const mx = p.x - this.lastX;
      const mz = p.z - this.lastZ;
      const v = Math.hypot(mx, mz) / dt;
      this.pSpeed += (v - this.pSpeed) * (1 - Math.exp(-dt * 3));
      if (v > 0.3) this.heading = Math.atan2(mx, mz);
    }
    this.lastX = p.x;
    this.lastZ = p.z;
    // You left the sea mid-visit: it leaves too.
    if (!atSea && this.state !== 'away' && this.state !== 'leave') this.go('leave', 4);
    // A long ride: it drops whatever it was doing to celebrate it.
    const ride = atSea && p.mode === 'surf' ? h.rideTime() : 0;
    if (ride === 0) this.cheered = false;
    else if (ride >= CHEER_AFTER && !this.cheered) {
      this.cheered = true;
      this.startCheer();
    }

    if (this.state === 'away') {
      m.root.visible = false;
      if (atSea && this.cooldown <= 0 && h.ground(p.x, p.z) < -MIN_DEPTH) this.arrive();
      return;
    }
    this.timer -= dt;
    const diving = p.mode === 'dive';
    let action: SharkAction = 'swim';
    switch (this.state) {
      case 'approach': {
        // Toward its place on the circle round you.
        const tx = p.x + Math.cos(this.angle) * CIRCLE_R;
        const tz = p.z + Math.sin(this.angle) * CIRCLE_R;
        this.swimTo(dt, tx, this.cruiseY(tx, tz, diving), tz, ARRIVE);
        action = 'fast';
        if (Math.hypot(tx - this.x, tz - this.z) < 1 || this.timer <= 0) {
          if (this.friendly) {
            // A friend: no warning, no prank; it swims along with you for a while.
            this.escortLeft = ESCORT[0] + Math.random() * (ESCORT[1] - ESCORT[0]);
            this.showJumpIn = SHOW_JUMP[0] + Math.random() * (SHOW_JUMP[1] - SHOW_JUMP[0]);
            this.go('escort', 0);
          } else {
            this.go('circle', WARN[0] + Math.random() * (WARN[1] - WARN[0]));
          }
          this.voice();
        }
        break;
      }
      case 'escort':
        action = this.escort(dt, diving);
        break;
      case 'circle': {
        // The warning: round and round you, the fin cutting the water.
        this.angle += (this.side * CIRCLE) / CIRCLE_R * dt;
        const tx = p.x + Math.cos(this.angle) * CIRCLE_R;
        const tz = p.z + Math.sin(this.angle) * CIRCLE_R;
        this.swimTo(dt, tx, this.cruiseY(tx, tz, diving), tz, CIRCLE * 1.3);
        if (this.timer <= 0) this.beginSkill();
        break;
      }
      case 'set':
        action = this.setUp(dt, diving);
        break;
      case 'breach':
        action = this.flyBreach(dt);
        break;
      case 'rise':
        action = this.rise(dt, diving);
        break;
      case 'whirl':
        action = this.whirl(dt, diving);
        break;
      case 'cheerSet': {
        // Up from below to its take-off point, ahead of you and to one side.
        const f = this.cheerAt;
        this.swimTo(dt, f.x, h.seaHeight(f.x, f.y) - 1.2, f.y, 7);
        action = 'fast';
        if (this.timer <= 0) {
          this.hit = false;
          this.launchTo(f.z, f.w, CHEER_T);
          this.state = 'cheer';
          this.voice();
        }
        break;
      }
      case 'cheer':
        action = this.flyCheer(dt);
        break;
      case 'leave': {
        // Off out to sea and down.
        let dx = this.x - p.x;
        let dz = this.z - p.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d;
        dz /= d;
        const tx = this.x + dx * 6;
        const tz = this.z + dz * 6;
        this.swimTo(dt, tx, h.seaHeight(tx, tz) - 2.5, tz, LEAVE);
        action = 'fast';
        if (this.timer <= 0 || d > 32) {
          this.state = 'away';
          this.cooldown = COOLDOWN[0] + Math.random() * (COOLDOWN[1] - COOLDOWN[0]);
        }
        break;
      }
    }
    // Never into the sea bed.
    this.y = Math.max(this.y, h.ground(this.x, this.z) + 0.25);
    m.root.visible = true;
    m.place(this.x, this.y, this.z, this.yaw, this.pitch, this.roll);
    m.update(dt, action, Math.max(0.6, Math.min(2.2, this.speed / 2)));
    this.wake(dt);
  }

  /** Starts a visit: from far off, with a prank and a strength drawn at random. */
  private arrive(): void {
    const p = this.p;
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const x = p.x + Math.cos(a) * SPAWN_R;
      const z = p.z + Math.sin(a) * SPAWN_R;
      if (this.host.ground(x, z) > -2) continue;
      this.x = x;
      this.z = z;
      this.y = this.host.seaHeight(x, z) - 2;
      this.angle = Math.atan2(z - p.z, x - p.x);
      this.side = Math.random() < 0.5 ? 1 : -1;
      // Diving, a leap makes no sense: bumps and whirls only.
      const skills: Skill[] = p.mode === 'dive' ? ['bump', 'whirl'] : ['breach', 'bump', 'whirl'];
      this.skill = skills[Math.floor(Math.random() * skills.length)];
      this.level = Math.floor(Math.random() * 3);
      // A friend mostly comes just to swim with you.
      this.friendly = this.pranks >= FRIEND_AFTER && Math.random() > FRIEND_PRANKS;
      this.roll = 0;
      this.go('approach', 12);
      return;
    }
    // No open water round you: try again a little later.
    this.cooldown = 10;
  }

  private beginSkill(): void {
    this.hit = false;
    if (this.skill === 'whirl') {
      this.go('whirl', WHIRL_TIME);
      this.voice();
      return;
    }
    // Breach: down a little, beside you; bump: deep, right under you.
    this.go('set', this.skill === 'breach' ? 1.4 : 1.6);
  }

  /** Getting into position for a leap or a bump. */
  private setUp(dt: number, diving: boolean): SharkAction {
    const p = this.p;
    if (this.skill === 'breach') {
      const a = this.angle;
      const tx = p.x + Math.cos(a) * 3;
      const tz = p.z + Math.sin(a) * 3;
      this.swimTo(dt, tx, this.host.seaHeight(tx, tz) - 1.4, tz, 4);
      if (this.timer <= 0) this.launch();
      return 'fast';
    }
    // Bump: under you, a couple of metres down, then straight up.
    const below = diving ? p.y - 1.6 : this.host.seaHeight(p.x, p.z) - 2.4;
    const tx = p.x + Math.cos(this.angle) * 1.2;
    const tz = p.z + Math.sin(this.angle) * 1.2;
    this.swimTo(dt, tx, below, tz, 4);
    if (this.timer <= 0) this.go('rise', 1.5);
    return 'fast';
  }

  /** Leaps from beside you, over you, to land on your other side. */
  private launch(): void {
    const p = this.p;
    this.launchTo(p.x - Math.cos(this.angle) * 2.6, p.z - Math.sin(this.angle) * 2.6);
  }

  /**
   * The celebration: take-off ahead of you on one side, landing on the other side further on
   * (where you will be by then), so the arc and its rainbow cross your view; near the beach
   * (shallow ahead), alongside you on the deeper side instead. False when nowhere is deep enough.
   */
  private startCheer(): boolean {
    const p = this.p;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // Right of your heading: (cos h, −sin h).
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);
    const side: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const travel = Math.min(12, this.pSpeed * CHEER_T);
    // [ahead, across] of the take-off and the landing (m; across × side).
    for (const [a0, c0, a1, c1] of CHEER_LINES) {
      for (const sd of [side, -side as 1 | -1]) {
        const ax = p.x + fx * a0 + rx * c0 * sd;
        const az = p.z + fz * a0 + rz * c0 * sd;
        const bx = p.x + fx * (a1 + travel) + rx * c1 * sd;
        const bz = p.z + fz * (a1 + travel) + rz * c1 * sd;
        if (this.host.ground(ax, az) > -1 || this.host.ground(bx, bz) > -1) continue;
        this.beginCheer(ax, az, bx, bz, fx, fz, sd);
        return true;
      }
    }
    return false;
  }

  /** To its take-off point (from below, if it wasn't here), leaping on `side`'s line. */
  private beginCheer(ax: number, az: number, bx: number, bz: number, fx: number, fz: number, side: 1 | -1): void {
    this.cheerAt.set(ax, az, bx, bz);
    if (this.state === 'away' || this.state === 'leave') {
      // Not here yet: it comes up from below, a little behind the take-off point.
      this.x = ax - fx * 4;
      this.z = az - fz * 4;
      this.y = this.host.seaHeight(this.x, this.z) - 2.2;
      this.yaw = this.heading;
    }
    this.side = side;
    this.roll = 0;
    this.go('cheerSet', 0.8);
  }

  /** In the air for the celebration: barrel rolls, a rainbow behind, sparkles at the top. */
  private flyCheer(dt: number): SharkAction {
    const h = this.host;
    const up = this.vy > 0;
    this.vy -= GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    const hs = Math.hypot(this.vx, this.vz);
    this.yaw = Math.atan2(this.vx, this.vz);
    this.pitch = Math.atan2(this.vy, hs);
    this.roll += ((Math.PI * 2 * CHEER_ROLLS) / CHEER_T) * dt * this.side;
    this.speed = Math.hypot(hs, this.vy);
    const sea = h.seaHeight(this.x, this.z);
    if (this.y > sea + 0.2) this.drawRainbow(dt, hs);
    if (up && this.vy <= 0) {
      // The top: a burst of coloured sparkles, a giggle, the note.
      for (let k = 0; k < 220; k++) {
        const a = Math.random() * Math.PI * 2;
        const c = Math.random() * 2 - 1;
        const sn = Math.sqrt(1 - c * c);
        const v = 3.5 + Math.random() * 4;
        h.rainbow.emit(this.x, this.y, this.z, Math.cos(a) * sn * v, c * v + 1, Math.sin(a) * sn * v, 0.06 + Math.random() * 0.07);
      }
      this.voice();
      h.notify('cheer');
    }
    if (this.vy < 0 && this.y < sea - 0.1 && !this.hit) {
      // Splash down: white water, and a ring of colour spreading on the water.
      this.hit = true;
      this.roll = 0;
      this.splash(this.x, this.z, 90, 1.6);
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        h.rainbow.emit(this.x, sea + 0.15, this.z, Math.cos(a) * 3, 0.8 + Math.random(), Math.sin(a) * 3, 0.08, ((k % RAINBOW_BANDS) / RAINBOW_BANDS) * 0.8);
      }
      this.go('leave', 4);
    }
    return up ? 'bite' : 'swim';
  }

  /**
   * The rainbow it draws: bands of motes stacked across its path (in the arc's own plane), red on
   * the outside, violet inside; they hang in the air a couple of seconds.
   */
  private drawRainbow(dt: number, hs: number): void {
    this.rainbowIn -= dt * RAINBOW_RATE;
    const v = Math.max(1e-3, this.speed);
    const hx = this.vx / (hs || 1);
    const hz = this.vz / (hs || 1);
    // Perpendicular to the velocity, in the vertical plane of the leap, away from the arc's centre.
    const nx = (-this.vy * hx) / v;
    const ny = hs / v;
    const nz = (-this.vy * hz) / v;
    // A row of motes every 1/RATE s, spread back along this frame's path.
    for (; this.rainbowIn <= 0; this.rainbowIn += 1) {
      const back = Math.min(dt, -this.rainbowIn / RAINBOW_RATE);
      const px = this.x - this.vx * back;
      const py = this.y - this.vy * back + 0.1;
      const pz = this.z - this.vz * back;
      for (let k = 0; k < RAINBOW_BANDS; k++) {
        const o = (RAINBOW_BANDS / 2 - k) * RAINBOW_GAP;
        const j = (Math.random() - 0.5) * 0.05;
        this.host.rainbow.emit(px + nx * o + j, py + ny * o, pz + nz * o - j, (Math.random() - 0.5) * 0.2, 0.25, (Math.random() - 0.5) * 0.2, 0.11 + Math.random() * 0.04, (k / RAINBOW_BANDS) * 0.8);
      }
    }
  }

  /** A leap from where it is to land at (lx, lz) in T s: a ballistic arc. */
  private launchTo(lx: number, lz: number, T = 1.3): void {
    this.vx = (lx - this.x) / T;
    this.vz = (lz - this.z) / T;
    this.vy = (GRAVITY * T) / 2 + (this.host.seaHeight(lx, lz) - this.y) / T;
    this.splash(this.x, this.z, 18, 0.6);
    this.go('breach', T + 0.4);
  }

  private flyBreach(dt: number): SharkAction {
    const h = this.host;
    this.vy -= GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    const hs = Math.hypot(this.vx, this.vz);
    this.yaw = Math.atan2(this.vx, this.vz);
    this.pitch = Math.atan2(this.vy, hs);
    // A strong one turns a full roll in the air.
    if (this.level === 2) this.roll += ((Math.PI * 2) / 1.3) * dt * this.side;
    this.speed = Math.hypot(hs, this.vy);
    const sea = h.seaHeight(this.x, this.z);
    if (this.vy < 0 && this.y < sea - 0.1 && !this.hit) {
      this.hit = true;
      this.roll = 0;
      if (this.friendly) {
        // A leap for show, away from you: a splash, and back to swimming along.
        this.splash(this.x, this.z, 40, 1);
        this.go('escort', 0);
      } else {
        // Splash down: water everywhere, and you get it.
        this.splash(this.x, this.z, 70, 1.4);
        this.prank(1);
        this.go('leave', 4);
      }
    }
    return this.vy > 0 ? 'bite' : 'swim';
  }

  /** Straight up at you from below; at contact, the bump. */
  private rise(dt: number, diving: boolean): SharkAction {
    const p = this.p;
    const top = diving ? p.y - 0.3 : this.host.seaHeight(p.x, p.z) - 0.25;
    this.swimTo(dt, p.x, top + 0.3, p.z, 5);
    this.pitch = Math.min(1.2, this.pitch + dt * 3);
    if (!this.hit && (this.y > top - 0.15 || this.timer <= 0)) {
      this.hit = true;
      if (!diving) this.splash(p.x, p.z, 30, 1);
      else this.bubbleBurst(p.x, p.y - 0.3, p.z, 30);
      this.prank(1);
      this.voice();
      this.go('leave', 4);
    }
    return 'bite';
  }

  /** Round and round you, fast and tight: the water spins and so do you. */
  private whirl(dt: number, diving: boolean): SharkAction {
    const p = this.p;
    this.angle += this.side * WHIRL_W * dt;
    const tx = p.x + Math.cos(this.angle) * WHIRL_R;
    const tz = p.z + Math.sin(this.angle) * WHIRL_R;
    this.swimTo(dt, tx, this.cruiseY(tx, tz, diving), tz, WHIRL_R * WHIRL_W * 1.3);
    const strength = [1.2, 2.2, 3.4][this.level];
    // Tangent to the circle at your place, the way it swims.
    const tgx = -Math.sin(this.angle) * this.side;
    const tgz = Math.cos(this.angle) * this.side;
    switch (p.mode) {
      case 'kayak':
        this.host.kayak.shove(this.side * strength * dt, tgx * strength * 0.4 * dt, tgz * strength * 0.4 * dt);
        break;
      case 'swim':
      case 'dive':
        this.host.swimPush(tgx * strength * 0.5, tgz * strength * 0.5, 0);
        if (diving && Math.random() < 0.5) this.bubbleBurst(this.x, this.y, this.z, 2);
        break;
      default:
        break;
    }
    if (this.timer <= 0) {
      this.prank(0.6);
      this.voice();
      this.go('leave', 4);
    }
    return 'fast';
  }

  /**
   * A friend's visit: it swims beside you (a couple of metres to one side, keeping pace), now
   * and then leaping out ahead for show; then it leaves.
   */
  private escort(dt: number, diving: boolean): SharkAction {
    const p = this.p;
    this.escortLeft -= dt;
    this.showJumpIn -= dt;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    // Right of your heading: (cos h, −sin h).
    const tx = p.x + Math.cos(this.heading) * 2.4 * this.side - fx * 0.3;
    const tz = p.z - Math.sin(this.heading) * 2.4 * this.side - fz * 0.3;
    this.swimTo(dt, tx, this.cruiseY(tx, tz, diving), tz, Math.max(2.5, this.pSpeed + 1.5));
    if (!diving && this.showJumpIn <= 0 && this.escortLeft > 3) {
      this.showJumpIn = SHOW_JUMP[0] + Math.random() * (SHOW_JUMP[1] - SHOW_JUMP[0]);
      // Out ahead and away from you.
      const lx = this.x + fx * 4 + Math.cos(this.heading) * this.side * 1.5;
      const lz = this.z + fz * 4 - Math.sin(this.heading) * this.side * 1.5;
      if (this.host.ground(lx, lz) < -1.2) {
        this.hit = false;
        this.splash(this.x, this.z, 12, 0.5);
        this.launchTo(lx, lz);
        this.voice();
      }
    }
    if (this.escortLeft <= 0) this.go('leave', 4);
    return this.pSpeed > 1.5 ? 'fast' : 'swim';
  }

  /**
   * Shooed away (you clicked it while it was coming for you): it leaves at once, a little huffy.
   * True when the click hit it.
   */
  shoo(ray: THREE.Ray): boolean {
    const m = this.model;
    const st = this.state;
    if (!m || st === 'away' || st === 'leave' || st === 'breach' || st === 'rise' || st === 'cheerSet' || st === 'cheer') return false;
    if (m.hitTest(ray) === null) return false;
    this.splash(this.x, this.z, 10, 0.5);
    this.voice();
    this.host.notify('shoo');
    this.go('leave', 4);
    return true;
  }

  /**
   * What a prank does to you, by what you are doing and how strong it is (`weight`: the whirl's
   * end counts for a little less). You always get wet.
   */
  private prank(weight: number): void {
    this.pranks++;
    savePranks(this.pranks);
    if (this.pranks === FRIEND_AFTER) this.host.notify('friend');
    const h = this.host;
    const p = this.p;
    const lv = this.level;
    const side = this.side;
    switch (p.mode) {
      case 'kayak': {
        const roll = [0.2, 0.32, 0.45][lv] * weight;
        const heave = this.skill === 'bump' ? [0.3, 0.45, 0.6][lv] : [0.08, 0.12, 0.18][lv];
        h.kayak.jolt(side * roll, heave);
        h.kayak.splash(20 + lv * 15);
        if (lv === 2 && this.skill !== 'whirl') h.kayak.capsize(side);
        break;
      }
      case 'surf':
        // Light: only a scare and a splash; medium and strong: off the board.
        if (lv >= 1) h.surfKnock();
        break;
      case 'swim':
      case 'dive': {
        let dx = p.x - this.x;
        let dz = p.z - this.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d;
        dz /= d;
        const push = [1.5, 2.5, 3.5][lv] * weight;
        h.swimPush(dx * push, dz * push, p.mode === 'dive' && this.skill === 'bump' ? push * 0.6 : 0);
        break;
      }
      default:
        break;
    }
    h.soak();
  }

  /** Cruising depth: the fin cutting the surface; diving: at your depth. */
  private cruiseY(x: number, z: number, diving: boolean): number {
    return diving ? this.p.y : this.host.seaHeight(x, z) - FIN_DEPTH;
  }

  /** Steers toward (tx, ty, tz) at up to `speed`, facing the way it swims. */
  private swimTo(dt: number, tx: number, ty: number, tz: number, speed: number): void {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dy, dz);
    const v = Math.min(speed, d * 2);
    if (d > 1e-3) {
      const k = Math.min(1, (v * dt) / d);
      this.x += dx * k;
      this.y += dy * k;
      this.z += dz * k;
    }
    this.speed = v;
    if (Math.hypot(dx, dz) > 0.05) {
      let turn = Math.atan2(dx, dz) - this.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.yaw += turn * (1 - Math.exp(-dt * 6));
    }
    const want = Math.atan2(dy, Math.max(0.3, Math.hypot(dx, dz)));
    this.pitch += (Math.max(-0.6, Math.min(0.6, want)) - this.pitch) * (1 - Math.exp(-dt * 4));
    this.roll *= Math.exp(-dt * 3);
  }

  private go(state: State, time: number): void {
    this.state = state;
    this.timer = time;
  }

  /** The fin cutting the surface: ripples behind it, a little spray when fast. */
  private wake(dt: number): void {
    const m = this.model;
    if (!m) return;
    m.finPoint(this.fin);
    const sea = this.host.seaHeight(this.fin.x, this.fin.z);
    if (this.fin.y < sea - 0.05 || this.y > sea + 0.3) return;
    this.rippleIn -= dt;
    if (this.rippleIn > 0) return;
    this.rippleIn = 0.07;
    this.host.ripple(this.fin.x, this.fin.z, 0.45, -0.1 - 0.02 * this.speed);
    // At night the water it stirs lights up: a glowing trail behind the fin.
    const night = this.host.night();
    if (night > 0.3) {
      const n = Math.round(1 + 3 * night);
      for (let k = 0; k < n; k++) {
        this.host.glow.emit(this.fin.x + (Math.random() - 0.5) * 0.3, sea + 0.02, this.fin.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3, 0.08 + Math.random() * 0.09);
      }
    }
    if (this.speed > 2.5) {
      for (let k = 0; k < 3; k++) {
        this.host.spray.drop(this.fin.x, sea + 0.05, this.fin.z, (Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.8, 0.012 + Math.random() * 0.012);
      }
    }
  }

  /** A splash at (x, z): a ring of water thrown up, a big ripple and its sound. */
  private splash(x: number, z: number, n: number, size: number): void {
    const h = this.host;
    const sea = h.seaHeight(x, z);
    h.ripple(x, z, 1.2 * size, -0.8 * size);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.5 + Math.random() * 1.8) * size;
      h.spray.drop(x + Math.cos(a) * 0.3, sea + 0.05, z + Math.sin(a) * 0.3, Math.cos(a) * s, (2 + Math.random() * 3) * size, Math.sin(a) * s, 0.02 + Math.random() * 0.04);
    }
    // At night the splash glows on the water round it.
    if (h.night() > 0.3) {
      for (let k = 0; k < Math.round(n * 0.6); k++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.4 + Math.random() * 1.2) * size;
        h.glow.emit(x, sea + 0.02, z, Math.cos(a) * s, 0, Math.sin(a) * s, 0.06 + Math.random() * 0.08);
      }
    }
    const ear = h.ear(x, sea, z);
    if (ear) h.sound.splash(ear.gain * Math.min(1, size), ear.pan);
  }

  private bubbleBurst(x: number, y: number, z: number, n: number): void {
    for (let k = 0; k < n; k++) {
      this.host.bubbles.drop(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.4, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6, 0.008 + Math.random() * 0.02);
    }
  }

  /** Its giggle (a bubbly laugh). */
  private voice(): void {
    const ear = this.host.ear(this.x, this.y, this.z);
    if (ear) this.host.sound.giggle(ear.gain, ear.pan);
  }
}
