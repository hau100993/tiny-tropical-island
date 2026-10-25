import type { DragonAction } from './dragonModel';
import { FireBreath } from './fireBreath';
import type { EmberSink } from './embers';
import type { SkillFxSink } from './skillFx';
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
/**
 * "Vòng Lửa": it spins in the air drawing fire into itself, then a ring of fire bursts from the
 * ground under it with a flash and a wall of flame, racing out to `reach` m in `time` s
 * (released `at` s into the spin).
 */
const RING = { spin: 2.0, at: 0.8, time: 1.4, reach: 10, rate: 1500 } as const;
/**
 * "Mưa Thiên Thạch": it climbs, nose to the sky, a circle of fire opens in the sky over you
 * (or over it), and it spits `count` fireballs up, `every` s apart, that rain down round you
 * within `spread` m after `flight` s and blow up: flash, shock wave, the ground shaking.
 */
const METEOR = { climb: 2.2, count: 10, every: 0.24, flight: 1.5, spread: 7, burst: 90, core: 0.6 } as const;

/** Its skills, in the order X cycles through them. */
export type DragonSkill = 'breath' | 'ring' | 'meteors';
const SKILLS: readonly DragonSkill[] = ['breath', 'ring', 'meteors'];

interface Fireball {
  live: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface DragonWorld {
  heightAt(x: number, z: number): number;
  /** Distance from the island centre to open water along `angle` (rad). */
  seaRadius(angle: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  embers: EmberSink;
  steam: EmberSink;
  /** Flashes, shock waves, shake and big sounds. */
  fx: SkillFxSink;
}

export interface DragonEvents {
  /** Fire starts (s of breathing). */
  onBreath(duration: number): void;
  /** A fireball bursts on the ground (or the sea) at (x, y, z). */
  onBoom(x: number, y: number, z: number): void;
  /** A sound of its own: `greet` (a friendly chirrup) or `dance` (an excited one). */
  onVoice(kind: 'greet' | 'dance'): void;
  /** The flame reached you. */
  onHitPlayer(): void;
  /** A skill you set off (a key or a click) starts (for its name card). */
  onSkill(skill: DragonSkill): void;
}

/** You, as the dragon sees you: null when not walking about the island. */
export interface DragonPlayer {
  x: number;
  z: number;
  /** Feet height (m). */
  y: number;
}

type State = 'patrol' | 'approach' | 'greet' | 'hover' | 'place' | 'windup' | 'fire' | 'recover' | 'dance' | 'ring' | 'meteors';

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
  /** The skill X starts next, and the one queued. */
  private nextSkill = 0;
  private skill: DragonSkill = 'breath';
  /** The ring of fire: its centre and its age (s; < 0: not yet released). */
  private ringX = 0;
  private ringZ = 0;
  private ringAge = -1;
  private ringHit = false;
  /** The meteor shower: where it falls round, fireballs left to throw, the next one in (s). */
  private rainX = 0;
  private rainZ = 0;
  private toThrow = 0;
  private throwIn = 0;
  private readonly balls: Fireball[] = Array.from({ length: METEOR.count }, () => ({ live: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
  /** Where you are (for a meteor or the ring reaching you). */
  private player: DragonPlayer | null = null;
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

  /**
   * A fire skill, on command (X): each press the next one (breath, ring of fire, meteor shower).
   * Ignored while one is under way; returns the one started (null: busy).
   */
  command(): DragonSkill | null {
    if (this.busy || this.queued) return null;
    this.skill = SKILLS[this.nextSkill];
    this.nextSkill = (this.nextSkill + 1) % SKILLS.length;
    this.queued = true;
    return this.skill;
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
    const s = this.state;
    return s === 'place' || s === 'windup' || s === 'fire' || s === 'recover' || s === 'ring' || s === 'meteors';
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

    this.player = player;
    // A pat: an excited dance, nose to the sky, and a short burst of fire upward; or (now and
    // then) a ring of fire or a meteor shower.
    if (this.patQueued && !this.busy) {
      const r = Math.random();
      if (r < 0.5) {
        this.events.onVoice('dance');
        this.go('dance', 1.6);
        this.breath.fire(0.8, null);
        this.events.onBreath(0.8);
        this.atPlayer = false;
      } else {
        this.skill = r < 0.75 ? 'ring' : 'meteors';
        this.queued = true;
      }
    }
    this.patQueued = false;
    if (this.hovered && !this.busy && this.state !== 'dance' && this.state !== 'hover') {
      if (this.voiceIn <= 0) this.events.onVoice('greet');
      this.voiceIn = 4;
      this.go('hover', 0);
    }
    const quiet = this.state === 'patrol';
    if (!this.busy && this.queued && this.skill !== 'breath') {
      this.queued = false;
      this.autoSkill = between(AUTO_SKILL);
      this.events.onVoice('dance');
      this.events.onSkill(this.skill);
      const fx = this.world.fx;
      if (this.skill === 'ring') {
        this.ringAge = -1;
        this.ringHit = false;
        fx.sound('charge', 0.8, this.x, this.y, this.z);
        this.go('ring', RING.spin);
      } else {
        const near = player !== null && toPlayer < AIM_PLAYER;
        this.rainX = near && player ? player.x : this.x;
        this.rainZ = near && player ? player.z : this.z;
        this.toThrow = METEOR.count;
        this.throwIn = 0.7;
        // The circle of fire in the sky they fall from.
        const sky = this.surface(this.rainX, this.rainZ) + 8;
        fx.shock(this.rainX, sky, this.rainZ, 'fire', 0xff6a20, 5.5, 3.6);
        fx.shock(this.rainX, sky, this.rainZ, 'energy', 0xffb050, 3.2, 2.8);
        fx.flash(this.rainX, sky, this.rainZ, 0xff7a30, 60, 22, 1.2);
        fx.sound('charge', 1, this.x, this.y, this.z);
        fx.focus(this.rainX, sky * 0.5, this.rainZ, 0.7 + METEOR.count * METEOR.every + METEOR.flight + 0.6);
        this.go('meteors', 0.7 + METEOR.count * METEOR.every + METEOR.flight + 0.4);
      }
    }
    if (!this.busy && (this.queued || (this.autoSkill <= 0 && quiet))) {
      if (this.queued) this.events.onSkill('breath');
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
      case 'ring': {
        // Stays put, spinning once round; the ring leaves from the ground under it.
        ty = this.surface(this.x, this.z) + ALT;
        speed = 0.6;
        const k = 1 - this.timer / RING.spin;
        face = this.yaw + dt * ((Math.PI * 2) / RING.spin) * 6;
        if (this.ringAge < 0 && k < RING.at / RING.spin) this.drawIn(dt, k / (RING.at / RING.spin));
        if (this.ringAge < 0 && k >= RING.at / RING.spin) {
          this.ringAge = 0;
          this.ringX = this.x;
          this.ringZ = this.z;
          this.events.onBreath(RING.time);
          this.releaseRing();
        }
        if (this.timer <= 0) this.go('dance', 1.2);
        break;
      }
      case 'meteors':
        // Up, nose to the sky, spitting fireballs.
        ty = this.surface(this.x, this.z) + ALT + METEOR.climb;
        speed = 1.2;
        this.throwIn -= dt;
        if (this.toThrow > 0 && this.throwIn <= 0) {
          this.throwIn = METEOR.every;
          this.toThrow--;
          this.throwBall(mouth);
        }
        if (this.timer <= 0) this.go('dance', 1.2);
        break;
    }
    this.fly(dt, tx, ty, tz, speed);
    const hs = Math.hypot(this.vx, this.vz);
    this.turn(dt, face ?? (hs > 0.3 ? Math.atan2(this.vx, this.vz) : this.yaw));

    const breathing = this.state === 'windup' || this.state === 'fire' || this.state === 'ring' || this.state === 'meteors';
    this.action = breathing ? 'skill' : this.state === 'greet' || this.state === 'hover' ? 'greet' : this.state === 'dance' ? 'dance' : hs > 2 ? 'move' : 'idle';
    const wantFlare = breathing || this.state === 'dance' ? 1 : this.state === 'hover' ? 0.7 : this.state === 'greet' ? 0.4 : 0;
    this.flare += (wantFlare - this.flare) * (1 - Math.exp(-dt * 5));
    // Tip the body toward what it breathes at (the fire leaves along its forward); nose up for a
    // pat's burst; level otherwise.
    let wantPitch = 0;
    if (breathing || (this.state === 'place' && this.timer < PLACE - 1)) {
      const h = Math.hypot(this.aimX - mouth.x, this.aimZ - mouth.z);
      wantPitch = Math.max(PITCH_UP, Math.min(PITCH_DOWN, Math.atan2(mouth.y - this.aimY, h)));
    } else if ((this.state === 'dance' && this.timer > 0.6) || this.state === 'meteors') {
      wantPitch = PITCH_UP;
    }
    this.updateRing(dt);
    this.updateBalls(dt);
    this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-dt * 6));
    this.breath.update(dt, mouth.x, mouth.y, mouth.z, dir.x, dir.y, dir.z);
  }

  /**
   * The ring of fire, one frame: embers thrown up and out all along a circle that grows from
   * under it (the front fastest at first, then slowing), steam where it runs over the sea.
   */
  private updateRing(dt: number): void {
    if (this.ringAge < 0) return;
    this.ringAge += dt;
    const k = this.ringAge / RING.time;
    if (k >= 1) {
      this.ringAge = -1;
      return;
    }
    // Ease out: fast at first.
    const r = 0.4 + (RING.reach - 0.4) * (1 - (1 - k) * (1 - k));
    const n = Math.round(RING.rate * dt * (1 - 0.5 * k));
    const w = this.world;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = this.ringX + Math.cos(a) * r;
      const z = this.ringZ + Math.sin(a) * r;
      const g = w.heightAt(x, z);
      // Over the sea: above the waves (under them the water would tint it).
      const y = g < 0 ? 0.35 : g + 0.05;
      // A wall of flame on the front: big licks going up, a few sparks thrown out ahead.
      const spark = Math.random() < 0.2;
      const out = spark ? 1.5 + Math.random() * 1.5 : 0.3;
      // Over the sea it skims the water: mostly fire, a wisp of steam now and then.
      if (g < 0 && Math.random() < 0.06) w.steam.emit(x, y, z, Math.cos(a) * 0.3, 0.6, Math.sin(a) * 0.3, 0.15 + Math.random() * 0.1);
      else w.embers.emit(x, y, z, Math.cos(a) * out, (spark ? 2 : 1.2) + Math.random() * 1.8, Math.sin(a) * out, spark ? 0.06 + Math.random() * 0.05 : 0.16 + Math.random() * 0.16);
    }
    // The front passing over you.
    const p = this.player;
    if (p && !this.ringHit && Math.abs(Math.hypot(p.x - this.ringX, p.z - this.ringZ) - r) < 0.5) {
      this.ringHit = true;
      this.events.onHitPlayer();
    }
  }

  /** Charging the ring: sparks drawn in from all round into its body, faster and denser (k 0..1). */
  private drawIn(dt: number, k: number): void {
    const n = Math.round(dt * (120 + 380 * k));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * 1.6;
      const d = 2 + Math.random() * 1.8;
      const dx = Math.cos(a) * Math.cos(e);
      const dy = Math.sin(e);
      const dz = Math.sin(a) * Math.cos(e);
      // Fast inward: drag and lift bring them to rest round it (embers: drag 2.2/s, lift 2.4 m/s²).
      this.world.embers.emit(this.x + dx * d, this.y + dy * d, this.z + dz * d, -dx * d * 2.4, -dy * d * 2.4 - 1.2, -dz * d * 2.4, 0.05 + Math.random() * 0.05);
    }
  }

  /** The ring lets go: a flash, a wall of flame racing out with a second ring, the ground shaking. */
  private releaseRing(): void {
    const fx = this.world.fx;
    const g = this.surface(this.x, this.z);
    fx.flash(this.x, this.y, this.z, 0xff7a2a, 140, 20, 0.9);
    fx.shock(this.x, g + (this.world.heightAt(this.x, this.z) < 0 ? 0.3 : 0), this.z, 'fire', 0xff5a14, RING.reach, RING.time, 2.4);
    fx.shock(this.x, g, this.z, 'energy', 0xffc060, RING.reach * 0.6, RING.time * 0.75, 1.1);
    fx.shake(this.x, g, this.z, 0.5, 0.9);
    fx.sound('boom', 0.9, this.x, g, this.z);
    fx.focus(this.x, g + 1, this.z, RING.time + 0.8);
  }

  /** A fireball from the mouth, up and over, to land somewhere round the shower's centre. */
  private throwBall(mouth: { x: number; y: number; z: number }): void {
    const b = this.balls.find((f) => !f.live);
    if (!b) return;
    const a = Math.random() * Math.PI * 2;
    const r = 1 + Math.random() * (METEOR.spread - 1);
    const tx = this.rainX + Math.cos(a) * r;
    const tz = this.rainZ + Math.sin(a) * r;
    const ty = Math.max(0, this.world.heightAt(tx, tz));
    const T = METEOR.flight * (0.85 + Math.random() * 0.3);
    b.live = true;
    b.x = mouth.x;
    b.y = mouth.y;
    b.z = mouth.z;
    b.vx = (tx - mouth.x) / T;
    b.vz = (tz - mouth.z) / T;
    b.vy = (ty - mouth.y) / T + (9.81 * T) / 2;
    this.events.onBreath(0.25);
  }

  /** Fireballs in flight: a blazing core with a tail of sparks; a burst where they land. */
  private updateBalls(dt: number): void {
    const w = this.world;
    for (const b of this.balls) {
      if (!b.live) continue;
      b.vy -= 9.81 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      // The core (big, bright) and its tail.
      w.embers.emit(b.x, b.y, b.z, 0, 0, 0, METEOR.core);
      for (let i = 0; i < 7; i++) w.embers.emit(b.x + (Math.random() - 0.5) * 0.15, b.y + (Math.random() - 0.5) * 0.15, b.z + (Math.random() - 0.5) * 0.15, -b.vx * 0.15 + (Math.random() - 0.5), -b.vy * 0.15 + (Math.random() - 0.5), -b.vz * 0.15 + (Math.random() - 0.5), 0.08 + Math.random() * 0.08);
      const g = w.heightAt(b.x, b.z);
      // The sea: bursts on its waves (~0.3 m), not under them.
      const floor = g < 0 ? 0.3 : g;
      if (b.vy < 0 && b.y <= floor + 0.05) {
        b.live = false;
        for (let i = 0; i < METEOR.burst; i++) {
          const a = Math.random() * Math.PI * 2;
          const c = Math.random();
          const v = 1.5 + Math.random() * 3;
          w.embers.emit(b.x, floor + 0.1, b.z, Math.cos(a) * v * (1 - c * 0.5), c * v + 1, Math.sin(a) * v * (1 - c * 0.5), 0.07 + Math.random() * 0.1);
        }
        if (g < 0) {
          // Into the sea: a hiss of steam and a ring of ripples.
          for (let i = 0; i < 14; i++) w.steam.emit(b.x, 0.05, b.z, (Math.random() - 0.5) * 0.8, 0.8 + Math.random(), (Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 0.3);
          w.ripple(b.x, b.z, 0.8, -0.5);
        }
        this.events.onBoom(b.x, floor, b.z);
        w.fx.flash(b.x, floor + 1, b.z, 0xff8a3d, 45, 10, 0.45);
        w.fx.shock(b.x, floor, b.z, 'fire', 0xff6a20, 3.6, 0.9, 1.5);
        w.fx.shake(b.x, floor, b.z, 0.38, 0.5);
        w.fx.sound('boom', 0.6, b.x, floor, b.z);
        const p = this.player;
        if (p && Math.hypot(p.x - b.x, p.z - b.z) < 1.8) this.events.onHitPlayer();
      }
    }
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
