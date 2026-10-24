import type { DragonAction } from './dragonModel';
import { FireBreath } from './fireBreath';
import type { EmberSink } from './embers';
import type { StreamState } from './jetStream';

/** Cruising height above the ground or the sea (m), and the bob on it. */
const ALT = 2.3;
const BOB = 0.25;
/** Patrol: a lazy loop round home, this wide (m), at this speed (m/s). */
const LOOP = [3.5, 6.5] as const;
const CRUISE = 1.5;
const HURRY = 3.2;
/** Greeting: how near you must come (m), how far it stops from you (m), how often (s). */
const GREET_RANGE = 9;
const GREET_STOP = 2.4;
const GREET_EVERY = 50;
/** Fire on its own, out over the sea, every this many seconds (random in the range). */
const AUTO_SKILL = [40, 75] as const;
/** On command it breathes at you when you stand this near (m); farther, at the sea. */
const AIM_PLAYER = 12;
/** Where it hovers to breathe at you (m from you) and how high above your feet. */
const STANDOFF = 3.4;
const STANDOFF_UP = 2.0;
/** How far it may tip nose-down to breathe at something below (rad), and nose-up for a pat's burst. */
const PITCH_DOWN = 0.62;
const PITCH_UP = -0.75;
/** Skill phases (s): flying into place (at most), wind-up, breathing, recovering. */
const PLACE = 8;
const WINDUP = 0.45;
const BREATH = 1.6;
const RECOVER = 0.6;
/** Embers puffed from the mouth per second while the pointer rests on it. */
const HOVER_EMBERS = 22;

export interface DragonWorld {
  heightAt(x: number, z: number): number;
  /** Distance from the island centre to open water along `angle` (rad). */
  seaRadius(angle: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  embers: EmberSink;
  steam: EmberSink;
}

export interface DragonEvents {
  /** Fire starts (s of breathing). */
  onBreath(duration: number): void;
  /** A sound of its own: `greet` (a friendly chirrup) or `dance` (an excited one). */
  onVoice(kind: 'greet' | 'dance'): void;
  /** The flame reached you. */
  onHitPlayer(): void;
}

/** You, as the dragon sees you: null when not walking about the island. */
export interface DragonPlayer {
  x: number;
  z: number;
  /** Feet height (m). */
  y: number;
}

type State = 'patrol' | 'approach' | 'greet' | 'hover' | 'place' | 'windup' | 'fire' | 'recover' | 'dance';

/**
 * Hỏa Long's behaviour, always on the wing: loops lazily round its home over the beach, flies
 * over to greet you now and then, and breathes fire: on its own out over the sea (steam rises),
 * or on command at you when you are near (it dries you). With the pointer resting on it, it
 * hovers, turns to you and puffs embers; a click is a pat (an excited dance and a burst of fire
 * straight up). Pure logic on a 3D point and a yaw; DragonModel draws it.
 */
export class FireDragon {
  x: number;
  y: number;
  z: number;
  yaw = 0;
  action: DragonAction = 'idle';
  /** 0..1: how much its tail flame flares (excited, breathing fire). */
  flare = 0;
  /** Nose down (rad; negative: up): it tips toward what it breathes at (DragonModel.setPitch). */
  pitch = 0;
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private state: State = 'patrol';
  private timer = 0;
  private loopAngle = 0;
  private clock = 0;
  private greetCooldown = 8;
  private autoSkill: number;
  private queued = false;
  private patQueued = false;
  private hovered = false;
  private viewX = 0;
  private viewZ = 0;
  /** Where it flies to for the skill, and where the fire goes. */
  private spotX = 0;
  private spotY = 0;
  private spotZ = 0;
  private aimX = 0;
  private aimY = 0;
  private aimZ = 0;
  private atPlayer = false;
  private hit = false;
  private emberDebt = 0;
  private voiceIn = 0;
  /** Your chest while breathing at you (the flame's hit test follows it). */
  private readonly chest = { x: 0, y: 0, z: 0 };
  private readonly breath: FireBreath;

  constructor(
    private readonly world: DragonWorld,
    private readonly home: { x: number; z: number },
    private readonly events: DragonEvents,
  ) {
    this.x = home.x;
    this.z = home.z;
    this.y = this.surface(home.x, home.z) + ALT;
    this.autoSkill = between(AUTO_SKILL);
    this.breath = new FireBreath(world.embers, world.steam, world.heightAt, world.ripple, () => {
      if (!this.atPlayer) return;
      this.hit = true;
      events.onHitPlayer();
    });
  }

  /** The flame's arc, for JetStream. */
  get stream(): StreamState {
    return this.breath.stream;
  }

  /** Fire, on command (X). Ignored while one is under way. */
  command(): void {
    if (!this.busy) this.queued = true;
  }

  setHover(on: boolean, viewX: number, viewZ: number): void {
    this.hovered = on;
    this.viewX = viewX;
    this.viewZ = viewZ;
  }

  pat(): void {
    this.patQueued = true;
  }

  private get busy(): boolean {
    return this.state === 'place' || this.state === 'windup' || this.state === 'fire' || this.state === 'recover';
  }

  /**
   * `mouth`: where fire leaves (world) and `dir` which way it goes (world, unit), both from the
   * model's last frame.
   */
  update(
    dt: number,
    player: DragonPlayer | null,
    mouth: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
  ): void {
    this.timer -= dt;
    this.clock += dt;
    this.greetCooldown -= dt;
    this.autoSkill -= dt;
    this.voiceIn -= dt;
    const toPlayer = player ? Math.hypot(player.x - this.x, player.z - this.z) : Infinity;

    // A pat: an excited dance, nose to the sky, and a short burst of fire upward.
    if (this.patQueued && !this.busy) {
      this.events.onVoice('dance');
      this.go('dance', 1.6);
      this.breath.fire(0.8, null);
      this.events.onBreath(0.8);
      this.atPlayer = false;
    }
    this.patQueued = false;
    if (this.hovered && !this.busy && this.state !== 'dance' && this.state !== 'hover') {
      if (this.voiceIn <= 0) this.events.onVoice('greet');
      this.voiceIn = 4;
      this.go('hover', 0);
    }
    const quiet = this.state === 'patrol';
    if (!this.busy && (this.queued || (this.autoSkill <= 0 && quiet))) {
      this.atPlayer = this.queued && player !== null && toPlayer < AIM_PLAYER;
      this.queued = false;
      this.autoSkill = between(AUTO_SKILL);
      this.hit = false;
      if (this.atPlayer && player) this.planAtPlayer(player);
      else this.planAtSea();
      this.go('place', PLACE);
    }

    // Where it wants to be this frame, how fast it may go, and which way to face (null: along its flight).
    let tx = this.x;
    let ty = this.y;
    let tz = this.z;
    let speed = CRUISE;
    let face: number | null = null;
    const bob = Math.sin(this.clock * 0.9) * BOB;
    switch (this.state) {
      case 'patrol': {
        if (player && toPlayer < GREET_RANGE && this.greetCooldown <= 0) {
          this.go('approach', 8);
          break;
        }
        // A loop that breathes in and out, so it never quite repeats.
        const r = LOOP[0] + (LOOP[1] - LOOP[0]) * (0.5 + 0.5 * Math.sin(this.clock * 0.13));
        this.loopAngle += (CRUISE / r) * dt;
        tx = this.home.x + Math.cos(this.loopAngle) * r;
        tz = this.home.z + Math.sin(this.loopAngle) * r;
        ty = this.surface(tx, tz) + ALT + bob;
        break;
      }
      case 'approach':
        if (!player || this.timer <= 0 || toPlayer > GREET_RANGE * 1.6) {
          this.go('patrol', 0);
          break;
        }
        this.standOff(player, GREET_STOP);
        tx = this.spotX;
        tz = this.spotZ;
        ty = player.y + STANDOFF_UP + bob * 0.4;
        speed = HURRY;
        if (Math.hypot(tx - this.x, tz - this.z) < 0.4) {
          this.greetCooldown = GREET_EVERY;
          this.events.onVoice('greet');
          this.go('greet', 1.8);
        }
        break;
      case 'greet':
        if (player) face = Math.atan2(player.x - this.x, player.z - this.z);
        ty = this.y + bob * 0.02;
        speed = 0.5;
        if (this.timer <= 0) this.go('patrol', 0);
        break;
      case 'hover': {
        face = Math.atan2(this.viewX - this.x, this.viewZ - this.z);
        speed = 0.4;
        if (!this.hovered) {
          this.go('patrol', 0);
          break;
        }
        // Little puffs of embers from the mouth, toward you.
        this.emberDebt += dt * HOVER_EMBERS;
        const fx = Math.sin(this.yaw);
        const fz = Math.cos(this.yaw);
        while (this.emberDebt >= 1) {
          this.emberDebt -= 1;
          this.world.embers.emit(mouth.x, mouth.y, mouth.z, fx * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.6, fz * (0.6 + Math.random()) + (Math.random() - 0.5) * 0.6, 0.02 + Math.random() * 0.025);
        }
        break;
      }
      case 'place':
        if (this.atPlayer && player) this.planAtPlayer(player);
        tx = this.spotX;
        ty = this.spotY + bob * 0.3;
        tz = this.spotZ;
        speed = HURRY;
        if (Math.hypot(tx - this.x, ty - this.y, tz - this.z) < 0.35 || this.timer <= 0) {
          this.go('windup', WINDUP);
        } else if (Math.hypot(tx - this.x, tz - this.z) < 1.5) {
          face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        }
        break;
      case 'windup':
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        speed = 0.4;
        if (this.timer <= 0) {
          this.breath.fire(BREATH, this.atPlayer ? this.chest : null);
          this.events.onBreath(BREATH);
          this.go('fire', BREATH);
        }
        break;
      case 'fire':
        if (this.atPlayer && player) {
          this.planAtPlayer(player);
          tx = this.spotX;
          ty = this.spotY;
          tz = this.spotZ;
        }
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        speed = 0.8;
        if (this.timer <= 0) this.go('recover', RECOVER);
        break;
      case 'recover':
        speed = 0.6;
        if (this.timer <= 0) {
          if (this.hit) {
            this.events.onVoice('dance');
            this.go('dance', 1.6);
          } else {
            this.go('patrol', 0);
          }
        }
        break;
      case 'dance':
        ty = this.y + Math.sin(this.clock * 9) * 0.02;
        speed = 0.3;
        if (this.timer <= 0) this.go(this.hovered ? 'hover' : 'patrol', 0);
        break;
    }
    this.fly(dt, tx, ty, tz, speed);
    const hs = Math.hypot(this.vx, this.vz);
    this.turn(dt, face ?? (hs > 0.3 ? Math.atan2(this.vx, this.vz) : this.yaw));

    const breathing = this.state === 'windup' || this.state === 'fire';
    this.action = breathing ? 'skill' : this.state === 'greet' || this.state === 'hover' ? 'greet' : this.state === 'dance' ? 'dance' : hs > 2 ? 'move' : 'idle';
    const wantFlare = breathing || this.state === 'dance' ? 1 : this.state === 'hover' ? 0.7 : this.state === 'greet' ? 0.4 : 0;
    this.flare += (wantFlare - this.flare) * (1 - Math.exp(-dt * 5));
    // Tip the body toward what it breathes at (the fire leaves along its forward); nose up for a
    // pat's burst; level otherwise.
    let wantPitch = 0;
    if (breathing || (this.state === 'place' && this.timer < PLACE - 1)) {
      const h = Math.hypot(this.aimX - mouth.x, this.aimZ - mouth.z);
      wantPitch = Math.max(PITCH_UP, Math.min(PITCH_DOWN, Math.atan2(mouth.y - this.aimY, h)));
    } else if (this.state === 'dance' && this.timer > 0.6) {
      wantPitch = PITCH_UP;
    }
    this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-dt * 6));
    this.breath.update(dt, mouth.x, mouth.y, mouth.z, dir.x, dir.y, dir.z);
  }

  private go(state: State, time: number): void {
    this.state = state;
    this.timer = time;
  }

  /** Ground or sea level under (x, z). */
  private surface(x: number, z: number): number {
    return Math.max(0, this.world.heightAt(x, z));
  }

  /** Steers toward (tx, ty, tz) at most `speed`, easing in and out; never below a safe height. */
  private fly(dt: number, tx: number, ty: number, tz: number, speed: number): void {
    let dx = tx - this.x;
    let dy = ty - this.y;
    let dz = tz - this.z;
    const d = Math.hypot(dx, dy, dz);
    // Wanted velocity: toward the target, slowing in the last metre.
    const want = Math.min(speed, d * 1.5);
    if (d > 1e-3) {
      dx = (dx / d) * want;
      dy = (dy / d) * want;
      dz = (dz / d) * want;
    }
    const k = 1 - Math.exp(-dt * 3);
    this.vx += (dx - this.vx) * k;
    this.vy += (dy - this.vy) * k;
    this.vz += (dz - this.vz) * k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.y = Math.max(this.y, this.surface(this.x, this.z) + 0.9);
  }

  private turn(dt: number, yaw: number): void {
    let d = yaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-dt * 4));
  }

  /** A point `dist` m from you on its side, to hover at. */
  private standOff(p: DragonPlayer, dist: number): void {
    let dx = this.x - p.x;
    let dz = this.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    this.spotX = p.x + dx * dist;
    this.spotZ = p.z + dz * dist;
    this.spotY = p.y + STANDOFF_UP;
  }

  /** Hover a few metres off you and breathe at your chest. */
  private planAtPlayer(p: DragonPlayer): void {
    this.standOff(p, STANDOFF);
    this.aimX = p.x;
    this.aimY = p.y + 1.2;
    this.aimZ = p.z;
    this.chest.x = this.aimX;
    this.chest.y = this.aimY;
    this.chest.z = this.aimZ;
  }

  /**
   * Hover over the water's edge, facing out to sea, and breathe forward and down: tipped
   * nose-down toward a point ~5 m out, the long flame meets the water there.
   */
  private planAtSea(): void {
    const a = Math.atan2(this.home.z, this.home.x) + (Math.random() - 0.5) * 0.5;
    const shore = this.world.seaRadius(a);
    this.spotX = Math.cos(a) * (shore + 0.3);
    this.spotZ = Math.sin(a) * (shore + 0.3);
    this.spotY = ALT;
    this.aimX = Math.cos(a) * (shore + 5.5);
    this.aimY = 0;
    this.aimZ = Math.sin(a) * (shore + 5.5);
  }
}

function between(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}
