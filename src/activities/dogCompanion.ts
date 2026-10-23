import type { DogAction } from '../world/dog';

/** Where you are and what you're doing, as the dog sees it (filled by the app every frame). */
export interface DogPlayer {
  x: number;
  z: number;
  /** Ground height under you (or the water's surface while swimming). */
  y: number;
  speed: number;
  /** On your feet on land (walking, or standing still in the overview). */
  onFoot: boolean;
  /** In the sea: swimming, diving, in the kayak or on the surfboard. */
  atSea: boolean;
  /** Sitting somewhere: at the desk, in the bath, in the hammock (null: not). */
  seat: 'desk' | 'bath' | 'hammock' | null;
}

/** Where the dog settles by a seat (world, on the floor or ground) and which way it faces. */
export interface DogSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** What the dog needs from the world. */
export interface DogWorld {
  /** Ground (or deck, steps) height at (x, z) near `nearY`. */
  groundAt(x: number, z: number, nearY: number): number;
  /** Terrain height (< 0 under the sea). */
  terrainAt(x: number, z: number): number;
  /** Beside the desk chair (it sits there), by the bath and by the hammock (it lies there). */
  deskSpot: DogSpot;
  bathSpot: DogSpot;
  hammockSpot: DogSpot;
  /** Inside the house's room. */
  inRoom(x: number, z: number, y: number): boolean;
}

/** A paw coming down (for prints and the patter), and other moments worth a sound. */
export interface DogEvents {
  onStep(x: number, z: number, y: number, yaw: number, side: number, speed: number): void;
  onBark(kind: 'woof' | 'yip'): void;
}

/** How far behind you the dog walks (m, along your path). */
const FOLLOW = 1.6;
/** Breadcrumb spacing (m) and how many are kept. */
const CRUMB = 0.3;
const MAX_CRUMBS = 400;
/** Fastest it runs (m/s; you run at 4). */
const MAX_SPEED = 5.5;
/** Further than this (m) from where it should be, it just appears there (after a fade, say). */
const TELEPORT = 35;
/** Standing still this long with you near, it lies down (s). */
const LIE_AFTER = 40;
/** Distance between paw prints (m). */
const STEP = 0.32;
/** Being stroked: it sits this far (m, its centre from your feet) in front of you. */
const PET_GAP = 0.72;
/** After a pat, or after the stroking stops, it stays a moment before following again (s). */
const PAT_LINGER = 2.4;
const PET_LINGER = 1.2;

type Mode = 'follow' | 'come' | 'wait' | 'pet';

/**
 * Mochi, the dog that keeps you company. It follows your own path a couple of metres behind
 * (a trail of breadcrumbs: that way it goes round trees and rocks and up the steps without any
 * path finding), walking or galloping to keep up; idles, sniffs the ground and lies down when
 * you stand still a while; waits at the water's edge while you're at sea; comes into the house
 * with you, sits beside the chair while you work and lies by the bath or the hammock. G calls it
 * straight to you. Pressing on it with the mouse pets it (activities/petting.ts): a click is a
 * pat; held, it comes to sit in front of you for the stroking.
 */
export class DogCompanion {
  x: number;
  z: number;
  y: number;
  yaw = 0;
  speed = 0;
  action: DogAction = 'idle';
  /** How hard the tail wags (0..1). */
  wag = 0.3;
  /** How content it is (0..1, from the petting): wags harder while you stroke it. */
  affection = 0;
  /** Sitting in front of you, within reach of your hand, while you stroke it. */
  petReady = false;
  private mode: Mode = 'follow';
  /** The press is held (stroking), and whether it should come to you for it. */
  private petHold = false;
  private petToYou = false;
  /** Where it sits for the stroking, as a direction from you (NaN: along its own line). */
  private petDirX = Number.NaN;
  private petDirZ = Number.NaN;
  private readonly crumbs: { x: number; z: number }[] = [];
  /** Next breadcrumb the dog walks to. */
  private cursor = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private still = 0;
  private sniffIn = 8;
  private sniffLeft = 0;
  private modeTime = 0;
  /** Time spent waiting apart from you (door, shore): a greeting when you're back. */
  private apart = 0;
  private walked = 0;
  private side = 1;
  private shoreTimer = 0;
  private readonly shore = { x: 0, z: 0 };

  constructor(
    private readonly world: DogWorld,
    private readonly events: DogEvents,
    start: { x: number; z: number },
  ) {
    this.x = start.x;
    this.z = start.z;
    this.y = world.groundAt(start.x, start.z, 10);
  }

  /** G: come here, now. */
  call(): void {
    this.mode = 'come';
    this.modeTime = 0;
    this.events.onBark('woof');
  }

  /** A pat (a click on it). It hops, wags hard and yips. */
  pet(): void {
    this.mode = 'pet';
    this.modeTime = 0;
    this.petHold = false;
    this.petToYou = false;
    this.events.onBark('yip');
  }

  /**
   * The press on it is held: stroking. `toYou`: it comes to sit just in front of you (you're
   * walking, your hand reaches it), on the side (dirX, dirZ) from you if given (unit; where the
   * camera sees it past your body), else along the line it is on; otherwise it stays where it
   * is (seen from above).
   */
  startPetting(toYou: boolean, dirX = Number.NaN, dirZ = Number.NaN): void {
    this.mode = 'pet';
    this.modeTime = 0;
    this.petHold = true;
    this.petToYou = toYou;
    this.petDirX = dirX;
    this.petDirZ = dirZ;
  }

  /** The press was let go: it stays a moment, then follows again. */
  stopPetting(): void {
    if (this.mode !== 'pet' || !this.petHold) return;
    this.petHold = false;
    this.modeTime = 0;
  }

  /** Close enough to pet (m). */
  distanceTo(x: number, z: number): number {
    return Math.hypot(this.x - x, this.z - z);
  }

  update(dt: number, p: Readonly<DogPlayer>): void {
    this.modeTime += dt;
    this.recordTrail(p);
    let tx = p.x;
    let tz = p.z;
    let stopAt = FOLLOW;
    let faceYaw: number | null = null;
    let rest = false;
    let pose: DogAction = 'lie';
    let alone = false;

    this.petReady = false;
    if (this.mode === 'pet') {
      const linger = this.petHold ? Infinity : this.petToYou ? PET_LINGER : PAT_LINGER;
      if (this.modeTime > linger || !p.onFoot || p.seat) {
        this.mode = 'follow';
        this.petHold = false;
        this.snapCursor();
      } else {
        this.petting(dt, p);
        this.settleY(p);
        return;
      }
    }
    if (this.mode === 'come') {
      if (this.distanceTo(p.x, p.z) < FOLLOW + 0.3 || this.modeTime > 12 || !p.onFoot) {
        this.mode = 'follow';
        this.snapCursor();
      } else {
        this.steer(dt, p.x, p.z, FOLLOW, MAX_SPEED);
        this.action = 'move';
        this.wag += (0.8 - this.wag) * Math.min(1, dt * 3);
        this.settleY(p);
        return;
      }
    }

    if (p.atSea) {
      // Pacing the water's edge, watching you.
      this.shoreTimer -= dt;
      if (this.shoreTimer <= 0) {
        this.shoreTimer = 1;
        this.findShore(p.x, p.z);
      }
      tx = this.shore.x;
      tz = this.shore.z;
      stopAt = 0.4;
      // Wading near the shore: the edge is where you are; keep the usual distance instead.
      if (Math.hypot(tx - p.x, tz - p.z) < FOLLOW) {
        tx = p.x;
        tz = p.z;
        stopAt = FOLLOW;
      }
      faceYaw = Math.atan2(p.x - this.x, p.z - this.z);
      alone = true;
    } else if (p.seat) {
      const spot = p.seat === 'desk' ? this.world.deskSpot : p.seat === 'bath' ? this.world.bathSpot : this.world.hammockSpot;
      tx = spot.x;
      tz = spot.z;
      stopAt = 0.15;
      faceYaw = spot.yaw;
      rest = true;
      pose = p.seat === 'desk' ? 'sit' : 'lie';
      // An indoor seat with the dog outside (you came with B): it can't walk straight in
      // through the walls, so it's just there.
      if (p.seat !== 'hammock' && !this.world.inRoom(this.x, this.z, this.y)) {
        this.x = spot.x;
        this.z = spot.z;
        this.y = spot.y;
        this.yaw = spot.yaw;
        this.speed = 0;
      }
    }

    if (alone) {
      this.apart += dt;
    } else if (this.apart > 8 && p.onFoot) {
      // You're back.
      this.apart = 0;
      this.events.onBark('woof');
      this.wag = 1;
    } else if (p.onFoot) {
      this.apart = 0;
    }

    // Too far (you jumped somewhere, or it was left behind): just be there.
    if (Math.hypot(tx - this.x, tz - this.z) > TELEPORT) {
      this.x = tx + (p.onFoot ? -2 * Math.sin(this.yaw) : 0);
      this.z = tz + (p.onFoot ? -2 * Math.cos(this.yaw) : 0);
      this.y = this.world.groundAt(this.x, this.z, p.y);
      this.snapCursor();
    }

    if (p.onFoot && !p.seat) {
      this.followTrail(dt, p);
    } else {
      this.mode = 'wait';
      const d = this.steer(dt, tx, tz, stopAt, Math.min(MAX_SPEED, 1.2 + Math.hypot(tx - this.x, tz - this.z)));
      const arrived = d <= stopAt + 0.05;
      if (arrived && faceYaw !== null) this.turnTo(dt, faceYaw);
      this.action = this.speed > 0.05 ? 'move' : rest && arrived ? pose : 'idle';
      this.wag += ((rest ? 0.15 : 0.35) - this.wag) * Math.min(1, dt * 2);
    }
    this.settleY(p);
  }

  /** Being petted: comes to sit in front of you (or stays put), facing you, wagging. */
  private petting(dt: number, p: Readonly<DogPlayer>): void {
    if (this.petToYou) {
      // PET_GAP from you: on the asked side, or along the line it is on now.
      const side = !Number.isNaN(this.petDirX);
      const dx = side ? this.petDirX : this.x - p.x;
      const dz = side ? this.petDirZ : this.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const left = this.steer(dt, p.x + (dx / d) * PET_GAP, p.z + (dz / d) * PET_GAP, 0.04, 3);
      const arrived = left < 0.12 && this.speed < 0.05;
      if (arrived) this.turnTo(dt * 0.6, Math.atan2(p.x - this.x, p.z - this.z));
      this.action = this.speed > 0.05 ? 'move' : this.petHold ? 'sit' : 'idle';
      this.petReady = this.petHold && arrived;
    } else {
      this.steer(dt, p.x, p.z, 0, 0);
      // A long stroke: it sits down for it.
      this.action = this.petHold && this.modeTime > 0.6 ? 'sit' : 'idle';
    }
    const wagTo = this.petHold ? 0.6 + 0.4 * this.affection : 1;
    this.wag += (wagTo - this.wag) * Math.min(1, dt * 6);
    this.still = 0;
  }

  /** On foot: along your path, a couple of metres behind; idles, sniffs, lies down when you stop. */
  private followTrail(dt: number, p: Readonly<DogPlayer>): void {
    if (this.mode !== 'follow') {
      this.mode = 'follow';
      this.snapCursor();
    }
    const c = this.crumbs;
    // Shortcut: a later breadcrumb closer to the dog (you doubled back past it).
    let best = this.cursor;
    let bestD = Infinity;
    for (let i = this.cursor; i < Math.min(c.length, this.cursor + 80); i++) {
      const d = Math.hypot(c[i].x - this.x, c[i].z - this.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.cursor = best;
    while (this.cursor < c.length && Math.hypot(c[this.cursor].x - this.x, c[this.cursor].z - this.z) < 0.35) this.cursor++;
    // Path length from the dog to you.
    let len = 0;
    let px = this.x;
    let pz = this.z;
    for (let i = this.cursor; i < c.length; i++) {
      len += Math.hypot(c[i].x - px, c[i].z - pz);
      px = c[i].x;
      pz = c[i].z;
    }
    len += Math.hypot(p.x - px, p.z - pz);
    const next = this.cursor < c.length ? c[this.cursor] : { x: p.x, z: p.z };
    const want = len > FOLLOW ? Math.min(MAX_SPEED, p.speed + (len - FOLLOW) * 1.4) : 0;
    this.accelerate(dt, want);
    if (this.speed > 0.02) {
      const dx = next.x - this.x;
      const dz = next.z - this.z;
      const d = Math.hypot(dx, dz) || 1;
      const stepLen = Math.min(d, this.speed * dt);
      this.turnTo(dt, Math.atan2(dx, dz));
      this.move(dx / d * stepLen, dz / d * stepLen);
    }
    // Standing about with you.
    if (this.speed < 0.05 && p.speed < 0.1) {
      this.still += dt;
      this.face(dt, p.x, p.z);
    } else if (len > FOLLOW + 0.6 || p.speed > 0.1) {
      this.still = 0;
    }
    this.sniffIn -= dt;
    if (this.sniffLeft > 0) this.sniffLeft -= dt;
    else if (this.sniffIn <= 0 && this.still > 2 && this.still < LIE_AFTER) {
      this.sniffLeft = 2.5;
      this.sniffIn = 8 + Math.random() * 10;
    }
    const lying = this.still > LIE_AFTER;
    this.action = this.speed > 0.05 ? 'move' : lying ? 'lie' : this.sniffLeft > 0 ? 'sniff' : 'idle';
    // Happier near you and on the move.
    const near = Math.hypot(p.x - this.x, p.z - this.z) < 3;
    const wagTo = this.speed > 0.05 ? 0.45 : lying ? 0.1 : near ? 0.6 : 0.3;
    this.wag += (wagTo - this.wag) * Math.min(1, dt * 2);
  }

  /** Keeps breadcrumbs of your path while you're on foot; a jump (teleport) starts a new trail. */
  private recordTrail(p: Readonly<DogPlayer>): void {
    if (!p.onFoot) return;
    const jump = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    if (Number.isNaN(this.lastX) || jump > 3) {
      this.crumbs.length = 0;
      this.cursor = 0;
    }
    if (Number.isNaN(this.lastX) || jump >= CRUMB || this.crumbs.length === 0) {
      this.crumbs.push({ x: p.x, z: p.z });
      this.lastX = p.x;
      this.lastZ = p.z;
      if (this.crumbs.length > MAX_CRUMBS) {
        this.crumbs.shift();
        this.cursor = Math.max(0, this.cursor - 1);
      }
    }
  }

  /** Back on the trail at the breadcrumb nearest the dog. */
  private snapCursor(): void {
    let best = this.crumbs.length;
    let bestD = 4;
    for (let i = 0; i < this.crumbs.length; i++) {
      const d = Math.hypot(this.crumbs[i].x - this.x, this.crumbs[i].z - this.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.cursor = best;
  }

  /** Straight toward (tx, tz), stopping `stopAt` short; returns the distance left. */
  private steer(dt: number, tx: number, tz: number, stopAt: number, maxSpeed: number): number {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    const want = d > stopAt ? Math.min(maxSpeed, (d - stopAt) * 2 + 0.3) : 0;
    this.accelerate(dt, want);
    if (this.speed > 0.02 && d > 1e-3) {
      const stepLen = Math.min(d - stopAt * 0.5, this.speed * dt);
      if (stepLen > 0) {
        this.turnTo(dt, Math.atan2(dx, dz));
        this.move((dx / d) * stepLen, (dz / d) * stepLen);
      }
    }
    return Math.hypot(tx - this.x, tz - this.z);
  }

  private accelerate(dt: number, want: number): void {
    const a = want > this.speed ? 7 : 10;
    this.speed += Math.max(-a * dt, Math.min(a * dt, want - this.speed));
  }

  private move(dx: number, dz: number): void {
    this.x += dx;
    this.z += dz;
    this.walked += Math.hypot(dx, dz);
    while (this.walked >= STEP) {
      this.walked -= STEP;
      this.side = -this.side;
      this.events.onStep(this.x, this.z, this.y, this.yaw, this.side, this.speed);
    }
  }

  private face(dt: number, x: number, z: number): void {
    if (Math.hypot(x - this.x, z - this.z) > 0.3) this.turnTo(dt * 0.4, Math.atan2(x - this.x, z - this.z));
  }

  private turnTo(dt: number, yaw: number): void {
    let d = yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 7);
  }

  private settleY(p: Readonly<DogPlayer>): void {
    const g = this.world.groundAt(this.x, this.z, Number.isNaN(this.y) ? p.y : this.y);
    // Never into the sea: on the seabed it would walk under water.
    this.y += (Math.max(g, -0.05) - this.y) * 0.4;
  }

  /** The dry sand nearest you on the way back to the island's middle. */
  private findShore(px: number, pz: number): void {
    const len = Math.hypot(px, pz) || 1;
    const ux = -px / len;
    const uz = -pz / len;
    let x = px;
    let z = pz;
    for (let i = 0; i < 300; i++) {
      if (this.world.terrainAt(x, z) > 0.12) break;
      x += ux * 0.5;
      z += uz * 0.5;
    }
    this.shore.x = x + ux * 0.6;
    this.shore.z = z + uz * 0.6;
  }
}
