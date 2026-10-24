import type { BunnyAction } from './bunnyModel';
import type { LeafStorm } from './leafStorm';
import type { EmberSink } from './embers';

/** Ground it lives on (height, m): the grass above the beach; how far it strays from home (m). */
const BAND = [0.5, 6] as const;
const HOME_RADIUS = 7;
/** It keeps this far from the middle of the house (the stilts and stairs) (m). */
const HOUSE_CLEAR = 5.5;
/** Walking speed; quicker when coming to say hello (m/s). */
const WALK = 0.4;
const HURRY = 0.75;
/** Greeting: how near you must come (m), where it stops (m), how often (s). */
const GREET_RANGE = 6;
const GREET_STOP = 1.4;
const GREET_EVERY = 45;
/** "Lá Bay" on its own (gardening: flowers spring up where the leaves land), every this many seconds. */
const AUTO_SKILL = [35, 70] as const;
/** On command it throws at you when you stand this near (m). */
const AIM_PLAYER = 10;
/** Skill phases (s): wind-up, throwing, recovering. */
const WINDUP = 0.4;
const THROW = 1.8;
const RECOVER = 0.5;
/** Pollen from the sprout per second while the pointer rests on it; and in a pat's puff. */
const HOVER_SPORES = 16;
const PAT_SPORES = 40;
/** "Vũ Điệu Mầm Non": a longer dance in a rising spiral of pollen (s, motes per second). */
const DANCE = { time: 2.6, rate: 70 } as const;
/** "Gió Bồ Công Anh": dandelion seeds blown off the sprout (s, seeds per second, m/s up). */
const DANDELION = { time: 1.6, rate: 110, up: [0.6, 1.6] } as const;

/** Its skills, in the order Z cycles through them. */
export type BunnySkill = 'leaves' | 'dance' | 'dandelion';
const SKILLS: readonly BunnySkill[] = ['leaves', 'dance', 'dandelion'];

export interface BunnyWorld {
  heightAt(x: number, z: number): number;
  /** Where the house stands (it stays clear of it). */
  house: { x: number; z: number };
  leaves: LeafStorm;
  spores: EmberSink;
  /** Dandelion seeds, and the breeze (m/s, horizontal) they drift on. */
  fluff: EmberSink;
  breeze(): { x: number; z: number };
}

export interface BunnyEvents {
  /** Leaves start flying (s of throwing). */
  onThrow(duration: number): void;
  /** A squeak: `greet` (one) or `dance` (a happy run). */
  onVoice(kind: 'greet' | 'dance'): void;
}

/** You, as the bunny sees you: null when not walking about the island. */
export interface BunnyPlayer {
  x: number;
  z: number;
  /** Feet height (m). */
  y: number;
}

type State = 'idle' | 'wander' | 'approach' | 'greet' | 'hover' | 'turn' | 'windup' | 'throw' | 'recover' | 'dance' | 'blow';

/**
 * Mầm's behaviour: wanders the grass between the house and the beach, comes over to greet you,
 * and throws "Lá Bay", a spiral of leaves: on its own onto the ground ahead (flowers spring up
 * where they land), or on command at you (they swirl round you; the app grows a ring of flowers
 * at your feet). With the pointer resting on it, it turns to you, its bud opens and pollen
 * drifts out; a click is a leaf throw your way or a happy dance in a puff of pollen, at random.
 * Pure logic on (x, z, yaw); BunnyModel draws it. Facing is (sin yaw, cos yaw).
 */
export class GrassBunny {
  x: number;
  z: number;
  y = 0;
  yaw = 0;
  speed = 0;
  action: BunnyAction = 'idle';
  /** 0..1: how open its sprout is (excited, throwing, pointed at). */
  flare = 0;
  private state: State = 'idle';
  private timer = 2;
  private tx = 0;
  private tz = 0;
  private greetCooldown = 6;
  private autoSkill: number;
  private queued = false;
  private patQueued = false;
  /** The skill Z starts next, and the one queued; motes owed (the spiral, the seeds). */
  private nextSkill = 0;
  private skill: BunnySkill = 'leaves';
  private moteDebt = 0;
  /** A commanded dance (the pollen spiral), not a pat's. */
  private bigDance = false;
  private hovered = false;
  private viewX = 0;
  private viewZ = 0;
  private aimX = 0;
  private aimY = 0;
  private aimZ = 0;
  private atPlayer = false;
  private sporeDebt = 0;
  private voiceIn = 0;

  constructor(
    private readonly world: BunnyWorld,
    private readonly home: { x: number; z: number },
    private readonly events: BunnyEvents,
  ) {
    this.x = home.x;
    this.z = home.z;
    this.autoSkill = between(AUTO_SKILL);
  }

  /**
   * A grass skill, on command (Z): each press the next one ("Lá Bay", the dance, dandelions).
   * Ignored while one is under way; returns the one started (null: busy).
   */
  command(): BunnySkill | null {
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
    return s === 'turn' || s === 'windup' || s === 'throw' || s === 'recover' || s === 'blow' || (s === 'dance' && this.bigDance);
  }

  /** `bud`: the tip of its sprout (world), from the model's last frame. */
  update(dt: number, player: BunnyPlayer | null, bud: { x: number; y: number; z: number }): void {
    this.timer -= dt;
    this.greetCooldown -= dt;
    this.autoSkill -= dt;
    this.voiceIn -= dt;
    const toPlayer = player ? Math.hypot(player.x - this.x, player.z - this.z) : Infinity;

    // A pat: heads or tails. Leaves your way, or a happy dance in a puff of pollen.
    if (this.patQueued && !this.busy) {
      const r = Math.random();
      if (r < 0.25) {
        this.skill = 'dandelion';
        this.queued = true;
      } else if (r < 0.55) {
        this.events.onVoice('dance');
        this.go('dance', 1.6);
        this.puff(bud, PAT_SPORES, 0.9);
      } else {
        this.atPlayer = player !== null && toPlayer < AIM_PLAYER;
        if (this.atPlayer && player) this.aimAtPlayer(player);
        else this.aimToward(this.viewX, this.viewZ);
        this.go('turn', 0.8);
      }
    }
    this.patQueued = false;
    if (this.hovered && !this.busy && this.state !== 'dance' && this.state !== 'hover') {
      if (this.voiceIn <= 0) this.events.onVoice('greet');
      this.voiceIn = 4;
      this.go('hover', 0);
    }
    const quiet = this.state === 'idle' || this.state === 'wander';
    if (!this.busy && this.queued && this.skill !== 'leaves') {
      this.queued = false;
      this.autoSkill = between(AUTO_SKILL);
      this.events.onVoice('dance');
      if (this.skill === 'dance') {
        this.bigDance = true;
        this.go('dance', DANCE.time);
      } else {
        this.events.onThrow(DANDELION.time);
        this.go('blow', DANDELION.time);
      }
    }
    if (!this.busy && (this.queued || (this.autoSkill <= 0 && quiet))) {
      this.atPlayer = this.queued && player !== null && toPlayer < AIM_PLAYER;
      this.queued = false;
      this.autoSkill = between(AUTO_SKILL);
      if (this.atPlayer && player) this.aimAtPlayer(player);
      else this.aimGarden();
      this.go('turn', 1.2);
    }

    let speed = 0;
    let face: number | null = null;
    switch (this.state) {
      case 'idle':
        if (player && toPlayer < GREET_RANGE && this.greetCooldown <= 0) this.go('approach', 8);
        else if (this.timer <= 0) {
          this.pickWander();
          this.go('wander', 3 + Math.random() * 5);
        }
        break;
      case 'wander':
        speed = this.walkToward(this.tx, this.tz, WALK, dt);
        if (speed === 0 || this.timer <= 0) this.go('idle', 2 + Math.random() * 4);
        break;
      case 'approach': {
        if (!player || this.timer <= 0 || toPlayer > GREET_RANGE * 1.6) {
          this.go('idle', 2);
          break;
        }
        const k = Math.max(0, toPlayer - GREET_STOP) / (toPlayer || 1);
        speed = this.walkToward(this.x + (player.x - this.x) * k, this.z + (player.z - this.z) * k, HURRY, dt);
        if (toPlayer <= GREET_STOP + 0.15 || speed === 0) {
          this.greetCooldown = GREET_EVERY;
          this.events.onVoice('greet');
          this.go('greet', 2);
        }
        break;
      }
      case 'greet':
        if (player) face = Math.atan2(player.x - this.x, player.z - this.z);
        if (this.timer <= 0) this.go('idle', 3);
        break;
      case 'hover': {
        face = Math.atan2(this.viewX - this.x, this.viewZ - this.z);
        if (!this.hovered) {
          this.go('idle', 1.5);
          break;
        }
        this.sporeDebt += dt * HOVER_SPORES;
        const n = Math.floor(this.sporeDebt);
        this.sporeDebt -= n;
        if (n > 0) this.puff(bud, n, 0.35);
        break;
      }
      case 'turn':
        if (this.atPlayer && player) this.aimAtPlayer(player);
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        if (Math.abs(this.angleTo(face)) < 0.15 || this.timer <= 0) this.go('windup', WINDUP);
        break;
      case 'windup':
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        if (this.timer <= 0) {
          this.world.leaves.fire(this.aimX, this.aimY, this.aimZ, THROW, this.atPlayer);
          this.events.onThrow(THROW);
          this.go('throw', THROW);
        }
        break;
      case 'throw':
        if (this.atPlayer && player) {
          this.aimAtPlayer(player);
          this.world.leaves.aim(this.aimX, this.aimY, this.aimZ);
        }
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        if (this.timer <= 0) this.go('recover', RECOVER);
        break;
      case 'recover':
        if (this.timer <= 0) this.go('idle', 2 + Math.random() * 3);
        break;
      case 'dance':
        if (this.bigDance) this.spiral(dt, bud);
        if (this.timer <= 0) {
          this.bigDance = false;
          this.go(this.hovered ? 'hover' : 'idle', 3);
        }
        break;
      case 'blow':
        // Facing the way the breeze goes, seeds streaming off the sprout.
        this.blowSeeds(dt, bud);
        if (this.timer <= 0) this.go('idle', 2);
        break;
    }
    if (face !== null) this.turnToward(face, dt, 5);

    this.speed = speed;
    this.y = this.world.heightAt(this.x, this.z);
    const throwing = this.state === 'windup' || this.state === 'throw' || this.state === 'blow';
    this.action = speed > 0 ? 'move' : throwing ? 'skill' : this.state === 'greet' || this.state === 'hover' ? 'greet' : this.state === 'dance' ? 'dance' : 'idle';
    const want = throwing || this.state === 'dance' ? 1 : this.state === 'hover' ? 0.85 : this.state === 'greet' ? 0.4 : 0;
    this.flare += (want - this.flare) * (1 - Math.exp(-dt * 4));
  }

  private go(state: State, time: number): void {
    this.state = state;
    this.timer = time;
  }

  /** The big dance: pollen rising round it in a double spiral, gold and lime. */
  private spiral(dt: number, bud: { x: number; y: number; z: number }): void {
    this.moteDebt += dt * DANCE.rate;
    const t = DANCE.time - this.timer;
    for (; this.moteDebt >= 1; this.moteDebt -= 1) {
      for (const arm of [0, Math.PI]) {
        const a = t * 7 + arm;
        const r = 0.35 + t * 0.25;
        this.world.spores.emit(this.x + Math.cos(a) * r, this.y + 0.1, this.z + Math.sin(a) * r, -Math.sin(a) * 0.6, 0.9 + Math.random() * 0.5, Math.cos(a) * 0.6, 0.03 + Math.random() * 0.03);
      }
    }
    // A flourish from the sprout now and then.
    if (Math.random() < dt * 4) this.puff(bud, 8, 0.6);
  }

  /** "Gió Bồ Công Anh": seeds lifted off the sprout, carried away on the breeze, spreading. */
  private blowSeeds(dt: number, bud: { x: number; y: number; z: number }): void {
    const b = this.world.breeze();
    // Some breeze even on a still day (it blows them itself), always away from it.
    const bs = Math.hypot(b.x, b.z);
    const fx = bs > 0.2 ? b.x : Math.sin(this.yaw) * 0.6;
    const fz = bs > 0.2 ? b.z : Math.cos(this.yaw) * 0.6;
    this.moteDebt += dt * DANDELION.rate;
    for (; this.moteDebt >= 1; this.moteDebt -= 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.2 + Math.random() * 0.5;
      const up = DANDELION.up[0] + Math.random() * (DANDELION.up[1] - DANDELION.up[0]);
      this.world.fluff.emit(bud.x, bud.y + 0.03, bud.z, fx * (0.6 + Math.random() * 0.8) + Math.cos(a) * s, up, fz * (0.6 + Math.random() * 0.8) + Math.sin(a) * s, 0.11 + Math.random() * 0.07);
    }
  }

  /** `n` motes of pollen from the sprout, drifting out and up at about `speed` m/s. */
  private puff(bud: { x: number; y: number; z: number }, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      this.world.spores.emit(bud.x, bud.y, bud.z, Math.cos(a) * s, 0.2 + Math.random() * 0.5, Math.sin(a) * s, 0.025 + Math.random() * 0.03);
    }
  }

  /** Your chest, where you stand. */
  private aimAtPlayer(p: BunnyPlayer): void {
    this.aimX = p.x;
    this.aimY = p.y + 1.0;
    this.aimZ = p.z;
  }

  /** Gardening: the ground 3.5–5.5 m off in some direction it may face (dry land). */
  private aimGarden(): void {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3.5 + Math.random() * 2;
      const x = this.x + Math.sin(a) * r;
      const z = this.z + Math.cos(a) * r;
      const h = this.world.heightAt(x, z);
      if (h > 0.3) {
        this.aimX = x;
        this.aimY = h;
        this.aimZ = z;
        return;
      }
    }
    this.aimToward(this.x + Math.sin(this.yaw), this.z + Math.cos(this.yaw));
  }

  /** Toward a viewer at (vx, vz): onto the ground partway there, 2.5–6 m out. */
  private aimToward(vx: number, vz: number): void {
    const dx = vx - this.x;
    const dz = vz - this.z;
    const d = Math.hypot(dx, dz) || 1;
    const t = Math.max(2.5, Math.min(6, d * 0.6));
    this.aimX = this.x + (dx / d) * t;
    this.aimZ = this.z + (dz / d) * t;
    this.aimY = Math.max(0, this.world.heightAt(this.aimX, this.aimZ));
  }

  private allowed(x: number, z: number): boolean {
    const h = this.world.heightAt(x, z);
    return (
      h > BAND[0] &&
      h < BAND[1] &&
      Math.hypot(x - this.home.x, z - this.home.z) < HOME_RADIUS &&
      Math.hypot(x - this.world.house.x, z - this.world.house.z) > HOUSE_CLEAR
    );
  }

  private pickWander(): void {
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3;
      const x = this.x + Math.cos(a) * r;
      const z = this.z + Math.sin(a) * r;
      if (this.allowed(x, z)) {
        this.tx = x;
        this.tz = z;
        return;
      }
    }
    this.tx = this.home.x;
    this.tz = this.home.z;
  }

  /** Walks toward (x, z), turning first; returns the speed (0 when there or blocked). */
  private walkToward(x: number, z: number, speed: number, dt: number): number {
    const dx = x - this.x;
    const dz = z - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return 0;
    const want = Math.atan2(dx, dz);
    this.turnToward(want, dt, 4);
    if (Math.abs(this.angleTo(want)) > 0.8) return 0.0001;
    const step = Math.min(d, speed * dt);
    const nx = this.x + (dx / d) * step;
    const nz = this.z + (dz / d) * step;
    const h = this.world.heightAt(nx, nz);
    // Not into the sea, nor under the house; it may still come home from anywhere.
    if (h < 0.1 || Math.hypot(nx - this.world.house.x, nz - this.world.house.z) < HOUSE_CLEAR - 1) return 0;
    this.x = nx;
    this.z = nz;
    return speed;
  }

  private angleTo(yaw: number): number {
    const d = yaw - this.yaw;
    return Math.atan2(Math.sin(d), Math.cos(d));
  }

  private turnToward(yaw: number, dt: number, rate: number): void {
    this.yaw += this.angleTo(yaw) * (1 - Math.exp(-dt * rate));
  }
}

function between(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}
