import type { CrabAction } from './crabModel';
import { WaterJet } from './waterJet';
import type { StreamState } from './jetStream';
import type { BubbleSink } from './airBubbles';
import type { SpraySink } from '../../water/Spray';

/** Sand band it lives on (ground height, m), and how far it strays from home (m). */
const BAND = [0.12, 1.6] as const;
const HOME_RADIUS = 9;
/** Walking speed; a little quicker when coming to say hello (m/s). */
const WALK = 0.3;
const HURRY = 0.6;
/** Greeting: how near you must come (m), where it stops (m), how often (s). */
const GREET_RANGE = 6;
const GREET_STOP = 1.3;
const GREET_EVERY = 45;
/** Water jet on its own, toward the sea: every this many seconds (random in the range). */
const AUTO_SKILL = [30, 60] as const;
/** On command it aims at you when you stand this near (m); farther, at the sea. */
const AIM_PLAYER = 10;
/** Skill phases (s): wind-up before the water comes, firing, recovering. */
const WINDUP = 0.35;
const FIRE = 1.4;
const RECOVER = 0.5;
/** Bubbles blown from the mouth per second while the pointer rests on it; and in a pat's burst. */
const HOVER_BUBBLES = 12;
const PAT_BURST = 30;

/** What the crab needs from the island. */
export interface CrabWorld {
  heightAt(x: number, z: number): number;
  /** Distance from the island centre to open water along `angle` (rad). */
  seaRadius(angle: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  spray: SpraySink;
  bubbles: BubbleSink;
}

export interface CrabEvents {
  /** The jet starts (s of firing), at the crab. */
  onSquirt(duration: number): void;
  /** A happy sound: `greet` when saying hello, `dance` after a hit. */
  onVoice(kind: 'greet' | 'dance'): void;
  /** The water hit you. */
  onHitPlayer(): void;
}

/** You, as the crab sees you: null when not walking about the island. */
export interface CrabPlayer {
  x: number;
  z: number;
  /** Feet height (m). */
  y: number;
}

type State = 'idle' | 'wander' | 'approach' | 'greet' | 'turn' | 'windup' | 'fire' | 'recover' | 'dance' | 'hover';

/**
 * Bọt's behaviour: potters about its stretch of beach, comes over to greet you now and then,
 * and fires a water jet: on its own toward the sea, or on command (at you when you are near).
 * With the pointer resting on it, it turns to you and blows bubbles; a click is a pat (a dance
 * and a burst of bubbles). Pure logic on (x, z, yaw); CrabModel draws it. Facing is
 * (sin yaw, cos yaw), like the dog.
 */
export class BubbleCrab {
  x: number;
  z: number;
  y = 0;
  yaw = 0;
  speed = 0;
  action: CrabAction = 'idle';
  private state: State = 'idle';
  private timer = 2;
  private tx = 0;
  private tz = 0;
  private greetCooldown = 5;
  private autoSkill: number;
  private queued = false;
  /** Where the jet goes (world); `atPlayer`: it follows you while firing. */
  private aimX = 0;
  private aimY = 0;
  private aimZ = 0;
  private atPlayer = false;
  private hit = false;
  private readonly jet: WaterJet;
  /** The pointer rests on it, seen from (viewX, viewZ); a pat waiting for its burst. */
  private hovered = false;
  private viewX = 0;
  private viewZ = 0;
  private patQueued = false;
  private bubbleDebt = 0;
  private voiceIn = 0;

  constructor(
    private readonly world: CrabWorld,
    private readonly home: { x: number; z: number },
    private readonly events: CrabEvents,
  ) {
    this.x = home.x;
    this.z = home.z;
    this.autoSkill = this.between(AUTO_SKILL);
    this.jet = new WaterJet(world.spray, world.bubbles, world.ripple, () => {
      if (!this.atPlayer) return;
      this.hit = true;
      events.onHitPlayer();
    });
  }

  /** The jet's arc, for JetStream. */
  get stream(): StreamState {
    return this.jet.stream;
  }

  /** Is the pointer resting on it (from a viewer at x, z, where it turns to)? */
  setHover(on: boolean, viewX: number, viewZ: number): void {
    this.hovered = on;
    this.viewX = viewX;
    this.viewZ = viewZ;
  }

  /** Clicked: a dance with a burst of bubbles, or a water jet your way, at random (not mid-jet). */
  pat(): void {
    this.patQueued = true;
  }

  private get busy(): boolean {
    return this.state === 'turn' || this.state === 'windup' || this.state === 'fire' || this.state === 'recover';
  }

  /** The water skill, on command (R). Ignored while one is under way. */
  command(): void {
    if (this.state === 'turn' || this.state === 'windup' || this.state === 'fire') return;
    this.queued = true;
  }

  /** `mouth`: where the jet leaves (world), from the model's last frame. */
  update(dt: number, player: CrabPlayer | null, mouth: { x: number; y: number; z: number }): void {
    this.timer -= dt;
    this.greetCooldown -= dt;
    this.autoSkill -= dt;
    const toPlayer = player ? Math.hypot(player.x - this.x, player.z - this.z) : Infinity;

    // A pat: heads or tails. A dance with a burst of bubbles from the mouth, or a water jet your
    // way (at you when you stand near, else onto the ground between it and the camera).
    if (this.patQueued && !this.busy) {
      this.patQueued = false;
      if (Math.random() < 0.5) {
        this.events.onVoice('dance');
        this.go('dance', 1.7);
        this.blowBubbles(mouth, PAT_BURST, 1.3);
      } else {
        this.atPlayer = player !== null && toPlayer < AIM_PLAYER;
        this.hit = false;
        if (this.atPlayer && player) this.aimAtPlayer(player);
        else this.aimToward(this.viewX, this.viewZ);
        this.go('turn', 0.8);
      }
    }
    this.patQueued = false;
    // The pointer on it: it stops what it was doing (not a jet) and blows bubbles at you.
    this.voiceIn -= dt;
    if (this.hovered && !this.busy && this.state !== 'dance' && this.state !== 'hover') {
      // A hello as the pointer arrives (not again for each flick on and off).
      if (this.state !== 'greet' && this.voiceIn <= 0) this.events.onVoice('greet');
      this.voiceIn = 4;
      this.go('hover', 0);
    }
    // Start a skill: queued by you, or now and then on its own (not mid-greeting or hovered).
    const quiet = this.state !== 'approach' && this.state !== 'greet' && this.state !== 'hover' && this.state !== 'dance';
    if (!this.busy && (this.queued || (this.autoSkill <= 0 && quiet))) {
      this.atPlayer = this.queued && player !== null && toPlayer < AIM_PLAYER;
      this.queued = false;
      this.autoSkill = this.between(AUTO_SKILL);
      this.hit = false;
      if (this.atPlayer && player) this.aimAtPlayer(player);
      else this.aimAtSea();
      this.go('turn', 1.5);
    }

    let speed = 0;
    let face: number | null = null;
    switch (this.state) {
      case 'idle':
        if (player && toPlayer < GREET_RANGE && this.greetCooldown <= 0) {
          this.go('approach', 8);
        } else if (this.timer <= 0) {
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
        // Stop a little short of you, on the line between.
        const k = Math.max(0, toPlayer - GREET_STOP) / (toPlayer || 1);
        speed = this.walkToward(this.x + (player.x - this.x) * k, this.z + (player.z - this.z) * k, HURRY, dt);
        if (toPlayer <= GREET_STOP + 0.15 || speed === 0) {
          this.greetCooldown = GREET_EVERY;
          this.events.onVoice('greet');
          this.go('greet', 1.6);
        }
        break;
      }
      case 'greet':
        if (player) face = Math.atan2(player.x - this.x, player.z - this.z);
        if (this.timer <= 0) this.go('idle', 3);
        break;
      case 'turn':
        if (this.atPlayer && player) this.aimAtPlayer(player);
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        if (Math.abs(this.angleTo(face)) < 0.12 || this.timer <= 0) this.go('windup', WINDUP);
        break;
      case 'windup':
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        if (this.timer <= 0) {
          this.jet.fire(this.aimX, this.aimY, this.aimZ, FIRE);
          this.events.onSquirt(FIRE);
          this.go('fire', FIRE);
        }
        break;
      case 'fire':
        if (this.atPlayer && player) {
          this.aimAtPlayer(player);
          this.jet.aim(this.aimX, this.aimY, this.aimZ);
        }
        face = Math.atan2(this.aimX - this.x, this.aimZ - this.z);
        if (this.timer <= 0) this.go('recover', RECOVER);
        break;
      case 'recover':
        // Landings still in the air may yet hit you: the dance waits for them.
        if (this.timer <= 0) {
          if (this.hit) {
            this.events.onVoice('dance');
            this.go('dance', 1.7);
          } else {
            this.go('idle', 2 + Math.random() * 3);
          }
        }
        break;
      case 'dance':
        if (this.timer <= 0) this.go(this.hovered ? 'hover' : 'idle', 3);
        break;
      case 'hover': {
        face = Math.atan2(this.viewX - this.x, this.viewZ - this.z);
        if (!this.hovered) {
          this.go('idle', 1.5);
          break;
        }
        this.bubbleDebt += dt * HOVER_BUBBLES;
        const n = Math.floor(this.bubbleDebt);
        this.bubbleDebt -= n;
        if (n > 0) this.blowBubbles(mouth, n, 0.7);
        break;
      }
    }
    if (face !== null) this.turnToward(face, dt, 5);

    this.speed = speed;
    this.y = this.world.heightAt(this.x, this.z);
    this.action =
      speed > 0
        ? 'move'
        : this.state === 'windup' || this.state === 'fire'
          ? 'skill'
          : this.state === 'greet' || this.state === 'hover'
            ? 'greet'
            : this.state === 'dance'
              ? 'dance'
              : 'idle';
    this.jet.update(dt, mouth.x, mouth.y, mouth.z);
  }

  /** `n` bubbles from the mouth, puffed forward (and a little up) at about `speed` m/s. */
  private blowBubbles(mouth: { x: number; y: number; z: number }, n: number, speed: number): void {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    for (let i = 0; i < n; i++) {
      const s = speed * (0.6 + Math.random() * 0.8);
      const side = (Math.random() - 0.5) * 0.9;
      this.world.bubbles.blow(
        mouth.x + (Math.random() - 0.5) * 0.04,
        mouth.y + (Math.random() - 0.5) * 0.04,
        mouth.z + (Math.random() - 0.5) * 0.04,
        (fx + fz * side) * s,
        0.15 + Math.random() * 0.45,
        (fz - fx * side) * s,
        0.045 + Math.random() * 0.075,
      );
    }
  }

  private go(state: State, time: number): void {
    this.state = state;
    this.timer = time;
  }

  private between(range: readonly [number, number]): number {
    return range[0] + Math.random() * (range[1] - range[0]);
  }

  /** Your chest, where you stand. */
  private aimAtPlayer(p: CrabPlayer): void {
    this.aimX = p.x;
    this.aimY = p.y + 1.1;
    this.aimZ = p.z;
  }

  /** Out to sea, well past the water's edge, roughly the way it faces seaward. */
  private aimAtSea(): void {
    const a = Math.atan2(this.z, this.x) + (Math.random() - 0.5) * 0.3;
    const here = Math.hypot(this.x, this.z);
    const r = Math.max(here + 3.5, Math.min(here + 9, this.world.seaRadius(a) + 3));
    this.aimX = Math.cos(a) * r;
    this.aimY = 0;
    this.aimZ = Math.sin(a) * r;
  }

  /** Toward a viewer at (vx, vz): onto the ground (or water) partway there, 2.5–7 m out. */
  private aimToward(vx: number, vz: number): void {
    const dx = vx - this.x;
    const dz = vz - this.z;
    const d = Math.hypot(dx, dz) || 1;
    const t = Math.max(2.5, Math.min(7, d * 0.6));
    this.aimX = this.x + (dx / d) * t;
    this.aimZ = this.z + (dz / d) * t;
    this.aimY = Math.max(0, this.world.heightAt(this.aimX, this.aimZ));
  }

  private onSand(x: number, z: number): boolean {
    const h = this.world.heightAt(x, z);
    return h > BAND[0] && h < BAND[1] && Math.hypot(x - this.home.x, z - this.home.z) < HOME_RADIUS;
  }

  private pickWander(): void {
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1 + Math.random() * 3;
      const x = this.x + Math.cos(a) * r;
      const z = this.z + Math.sin(a) * r;
      if (this.onSand(x, z)) {
        this.tx = x;
        this.tz = z;
        return;
      }
    }
    // Strayed off its sand: head home.
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
    // Walk only once roughly facing the way (a crab model walks forward here).
    if (Math.abs(this.angleTo(want)) > 0.8) return 0.0001;
    const step = Math.min(d, speed * dt);
    const nx = this.x + (dx / d) * step;
    const nz = this.z + (dz / d) * step;
    const h = this.world.heightAt(nx, nz);
    // Never into the sea or up the dry dunes; it may still come home from anywhere.
    if (h < BAND[0] || h > BAND[1] + 0.6) return 0;
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
