import type { CrabAction } from './crabModel';
import { WaterJet } from './waterJet';
import type { StreamState } from './jetStream';
import type { BubbleSink } from './airBubbles';
import type { SpraySink } from '../../water/Spray';
import type { EmberSink } from './embers';
import type { SkillFxSink } from './skillFx';
import type { BigBubbleSink } from './bigBubble';

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
/**
 * "Bubble Burst": it blows one giant soap bubble (to `radius` m in `blow` s), which floats up
 * `rise` m in `float` s and bursts: a flash, a shock wave, `burst` bubbles and a shower of
 * glittering drops all round (soaking you within `soak` m).
 */
const BIG = { blow: 1.4, radius: 1.15, float: 1.5, rise: 3.2, burst: 300, drops: 450, glitter: 320, soak: 3.5, blast: 5, blastTime: 0.45 } as const;
/**
 * "Rainbow Geyser": the sand trembles and pulses for `windup` s, then a geyser bursts from
 * it (under you when you are near, else in front of it) for `time` s, ~10 m high, with a crown
 * of spray and a shock wave; in daylight a rainbow arches over it (radius m).
 */
const GEYSER = { windup: 1.0, time: 2.8, drops: 900, speed: [11.5, 14.5], rainbow: 4.2, soak: 2.2 } as const;

/**
 * A show for you at the desk (`setStage`): it keeps to a patch of sand seen from the chair and
 * every SHOW_EVERY s (random in the range) blows a giant bubble, raises a rainbow geyser or
 * dances in a cloud of bubbles. No water jets and no name cards: something nice to glance at
 * while working. The first show comes FIRST_SHOW s after you sit down.
 */
const SHOW_EVERY = [40, 80] as const;
const FIRST_SHOW = 8;
const STAGE_RADIUS = 1.5;

/** Where it performs, and where you watch from (it faces you there). */
export interface CrabStage {
  x: number;
  z: number;
  viewX: number;
  viewZ: number;
}

/** Its skills, in the order R cycles through them. */
export type CrabSkill = 'jet' | 'bubbles' | 'geyser';
const SKILLS: readonly CrabSkill[] = ['jet', 'bubbles', 'geyser'];

/** What the crab needs from the island. */
export interface CrabWorld {
  heightAt(x: number, z: number): number;
  /** Distance from the island centre to open water along `angle` (rad). */
  seaRadius(angle: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  spray: SpraySink;
  bubbles: BubbleSink;
  /** Rainbow motes (the geyser's rainbow), and how bright the day is (0 night … 1 day). */
  rainbow: EmberSink;
  daylight(): number;
  /** Flashes, shock waves, shake and big sounds; the giant bubble. */
  fx: SkillFxSink;
  big: BigBubbleSink;
}

export interface CrabEvents {
  /** The jet starts (s of firing), at the crab. */
  onSquirt(duration: number): void;
  /** A happy sound: `greet` when saying hello, `dance` after a hit. */
  onVoice(kind: 'greet' | 'dance'): void;
  /** The water hit you. */
  onHitPlayer(): void;
  /** A skill you set off (a key or a click) starts (for its name card). */
  onSkill(skill: CrabSkill): void;
}

/** You, as the crab sees you: null when not walking about the island. */
export interface CrabPlayer {
  x: number;
  z: number;
  /** Feet height (m). */
  y: number;
}

type State =
  | 'idle' | 'wander' | 'approach' | 'greet' | 'turn' | 'windup' | 'fire' | 'recover' | 'dance' | 'hover'
  | 'geyserUp' | 'geyser' | 'blowBig' | 'floatBig';

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
  /** The skill R starts next, and the one queued. */
  private nextSkill = 0;
  private skill: CrabSkill = 'jet';
  /** The geyser's base (world) and its drops / rainbow rows owed. */
  private gx = 0;
  private gz = 0;
  private gy = 0;
  private dropDebt = 0;
  private bowDebt = 0;
  /** The geyser's wind-up: the next pulse of the sand in (s). */
  private pulseIn = 0;
  /** The giant bubble: where it is and how big (m). */
  private bx = 0;
  private by = 0;
  private bz = 0;
  private br = 0;
  /** After the burst: the film flying apart (s since; < 0: none). */
  private blastAge = -1;
  /** The geyser's column of water (a JetStream shot straight up), and how long it has run (s). */
  readonly column: StreamState = { ox: 0, oy: 0, oz: 0, vx: 0, vy: 0, vz: 0, tail: 0, head: 0, flight: 1, opacity: 0 };
  private columnAge = -1;
  /** The desk show (null: its usual life), the next show in (s), a skill started without its card. */
  private stage: CrabStage | null = null;
  private showIn = 0;
  private silent = false;

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

  /** You sat down at the desk (a stage to perform on) or got up (null). */
  setStage(stage: CrabStage | null): void {
    if (stage && !this.stage) this.showIn = FIRST_SHOW;
    this.stage = stage;
    if (stage) {
      this.viewX = stage.viewX;
      this.viewZ = stage.viewZ;
    }
  }

  /** Clicked: a dance with a burst of bubbles, or a water jet your way, at random (not mid-jet). */
  pat(): void {
    this.patQueued = true;
  }

  private get busy(): boolean {
    const s = this.state;
    return s === 'turn' || s === 'windup' || s === 'fire' || s === 'recover' || s === 'geyserUp' || s === 'geyser' || s === 'blowBig' || s === 'floatBig';
  }

  /**
   * A water skill, on command (R): each press the next one (jet, bubble shower, geyser).
   * Ignored while one is under way; returns the one started (null: busy).
   */
  command(): CrabSkill | null {
    if (this.busy || this.queued) return null;
    this.skill = SKILLS[this.nextSkill];
    this.nextSkill = (this.nextSkill + 1) % SKILLS.length;
    this.queued = true;
    return this.skill;
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
      const r = Math.random();
      if (r < 0.25) {
        this.events.onVoice('dance');
        this.go('dance', 1.7);
        this.blowBubbles(mouth, PAT_BURST, 1.3);
      } else if (r < 0.5) {
        this.skill = 'bubbles';
        this.queued = true;
      } else if (r < 0.75) {
        this.skill = 'geyser';
        this.queued = true;
      } else {
        this.atPlayer = player !== null && toPlayer < AIM_PLAYER;
        this.hit = false;
        if (this.atPlayer && player) this.aimAtPlayer(player);
        else this.aimToward(this.viewX, this.viewZ);
        this.events.onSkill('jet');
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
    if (this.stage) this.stageShow(dt, quiet, mouth);
    if (!this.busy && this.queued && this.skill !== 'jet') {
      // The bubble shower and the geyser.
      this.queued = false;
      this.autoSkill = this.between(AUTO_SKILL);
      this.hit = false;
      if (!this.silent) this.events.onSkill(this.skill);
      this.silent = false;
      if (this.skill === 'bubbles') {
        this.events.onVoice('greet');
        this.br = 0;
        this.world.fx.sound('charge', 0.6, this.x, this.y, this.z);
        this.go('blowBig', BIG.blow);
      } else {
        this.startGeyser(player, toPlayer);
      }
    }
    if (!this.busy && (this.queued || (this.autoSkill <= 0 && quiet && !this.stage))) {
      if (this.queued) this.events.onSkill('jet');
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
        // Hurrying back to its stage when you sit down; else pottering.
        speed = this.walkToward(this.tx, this.tz, this.stage && this.offStage() ? HURRY : WALK, dt);
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
      case 'geyserUp': {
        // Claws up, calling the water: the sand at the spot trembles, spits drops and pulses
        // with rings, quicker and quicker.
        face = Math.atan2(this.gx - this.x, this.gz - this.z);
        const w = this.world;
        const k = 1 - this.timer / GEYSER.windup;
        for (let i = 0; i < 2; i++) {
          if (Math.random() < dt * (30 + 90 * k)) w.spray.drop(this.gx + (Math.random() - 0.5) * 0.6, this.gy + 0.02, this.gz + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.8, 1 + Math.random() * (1 + 2 * k), (Math.random() - 0.5) * 0.8, 0.02 + Math.random() * 0.02);
        }
        this.pulseIn -= dt;
        if (this.pulseIn <= 0) {
          this.pulseIn = 0.36 - 0.2 * k;
          w.fx.shock(this.gx, this.gy, this.gz, 'water', 0x7fd8ff, 1.2 + 0.8 * k, 0.45);
        }
        if (this.timer <= 0) this.burstGeyser();
        break;
      }
      case 'geyser':
        face = Math.atan2(this.gx - this.x, this.gz - this.z);
        this.geyser(dt, player);
        if (this.timer <= 0) {
          this.events.onVoice('dance');
          this.go('dance', 1.7);
        }
        break;
      case 'blowBig':
        // Puffing up the giant bubble at its mouth, facing you; sparkles drawn into it.
        face = Math.atan2(this.viewX - this.x, this.viewZ - this.z);
        this.blowBig(dt, mouth);
        if (this.timer <= 0) {
          this.events.onVoice('dance');
          this.go('floatBig', BIG.float);
        }
        break;
      case 'floatBig': {
        // It lets go: the bubble floats up, wobbling, then bursts.
        const k = 1 - this.timer / BIG.float;
        this.by += (BIG.rise / BIG.float) * dt * (1.2 - 0.4 * k);
        this.bx += Math.sin(k * 9) * 0.15 * dt;
        this.world.big.set(this.bx, this.by, this.bz, this.br * (1 + 0.04 * Math.sin(k * 30)));
        if (this.timer <= 0) {
          this.popBig(player);
          this.go('dance', 1.7);
        }
        break;
      }
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
        : this.state === 'windup' || this.state === 'fire' || this.state === 'geyserUp' || this.state === 'geyser' || this.state === 'blowBig'
          ? 'skill'
          : this.state === 'greet' || this.state === 'hover'
            ? 'greet'
            : this.state === 'dance'
              ? 'dance'
              : 'idle';
    this.jet.update(dt, mouth.x, mouth.y, mouth.z);
    this.updateColumn(dt);
    if (this.blastAge >= 0) {
      // The burst film: a sphere racing out and fading.
      this.blastAge += dt;
      const k = Math.min(1, this.blastAge / BIG.blastTime);
      const r = this.br + (BIG.blast - this.br) * (1 - (1 - k) * (1 - k));
      this.world.big.set(this.bx, this.by, this.bz, r, (1 - k) * (1 - k) * 1.6);
      if (k >= 1) {
        this.blastAge = -1;
        this.world.big.set(0, 0, 0, 0);
      }
    }
  }

  /**
   * The column: its top shoots up to the peak in a quarter second and stays, swaying in height;
   * when the geyser stops, its foot rises after the top and it falls apart.
   */
  private updateColumn(dt: number): void {
    const c = this.column;
    if (this.columnAge < 0) return;
    this.columnAge += dt;
    const t = this.columnAge;
    const end = GEYSER.time;
    c.head = c.flight * Math.min(0.97, t / 0.25) * (t < end ? 0.9 + 0.08 * Math.sin(t * 9) : 0.97);
    c.tail = t < end ? 0 : Math.min(c.head, (t - end) * 2.2);
    c.opacity = t < end ? Math.min(1, t * 6) : Math.max(0, 1 - (t - end) / 0.6);
    if (c.opacity <= 0) {
      this.columnAge = -1;
      c.opacity = 0;
    }
  }

  /** The giant bubble grows at the mouth (eased), sparkles swirling into it. */
  private blowBig(dt: number, mouth: { x: number; y: number; z: number }): void {
    const k = Math.min(1, 1 - this.timer / BIG.blow);
    this.br = BIG.radius * (1 - (1 - k) * (1 - k));
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    // It sits on the mouth, in front, its bottom just off the sand.
    this.bx = mouth.x + fx * this.br * 0.9;
    this.bz = mouth.z + fz * this.br * 0.9;
    this.by = Math.max(mouth.y, this.y + 0.1 + this.br);
    this.world.big.set(this.bx, this.by, this.bz, this.br);
    // Sparkles from all round, pulled in (they slow as they come: drag).
    if (Math.random() < dt * 60) {
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = (Math.random() - 0.3) * 1.2;
        const d = 1.6 + Math.random();
        const dx = Math.cos(a) * Math.cos(e);
        const dy = Math.sin(e);
        const dz = Math.sin(a) * Math.cos(e);
        this.world.rainbow.emit(this.bx + dx * d, this.by + dy * d, this.bz + dz * d, -dx * d * 1.7, -dy * d * 1.7 + 1, -dz * d * 1.7, 0.05 + Math.random() * 0.04, 0.45 + Math.random() * 0.25);
      }
    }
  }

  /** It bursts: a flash, a shock wave on the ground and one in the air, bubbles and drops everywhere. */
  private popBig(player: CrabPlayer | null): void {
    const w = this.world;
    const { bx, by, bz, br } = this;
    this.blastAge = 0;
    const ground = Math.max(0, w.heightAt(bx, bz));
    w.fx.flash(bx, by, bz, 0x9fe8ff, 90, 16, 0.6);
    w.fx.shock(bx, ground, bz, 'water', 0x6fd0ff, 8, 1.4, 1.4);
    w.fx.shock(bx, by, bz, 'energy', 0xbfefff, 5, 0.9);
    w.fx.shake(bx, by, bz, 0.3, 0.6);
    w.fx.sound('splash', 0.7, bx, by, bz);
    w.fx.sound('boom', 0.25, bx, by, bz);
    w.fx.focus(bx, by - 0.5, bz, 1.6);
    for (let i = 0; i < BIG.burst; i++) {
      const [dx, dy, dz] = this.sphere();
      const s = 0.6 + Math.random() * 2.4;
      w.bubbles.blow(bx + dx * br, by + dy * br, bz + dz * br, dx * s, dy * s + 0.6, dz * s, 0.06 + Math.random() * 0.2);
    }
    for (let i = 0; i < BIG.drops; i++) {
      const [dx, dy, dz] = this.sphere();
      const s = 2 + Math.random() * 4;
      w.spray.drop(bx + dx * br, by + dy * br, bz + dz * br, dx * s, dy * s + 1.5, dz * s, 0.03 + Math.random() * 0.05);
    }
    for (let i = 0; i < BIG.glitter; i++) {
      const [dx, dy, dz] = this.sphere();
      const s = 1.5 + Math.random() * 3;
      w.rainbow.emit(bx + dx * br, by + dy * br, bz + dz * br, dx * s, dy * s + 0.5, dz * s, 0.07 + Math.random() * 0.08);
    }
    if (w.heightAt(bx, bz) < 0) w.ripple(bx, bz, 2.5, -0.8);
    if (player && Math.hypot(player.x - bx, player.z - bz) < BIG.soak) this.events.onHitPlayer();
  }

  /** A random direction (unit). */
  private sphere(): [number, number, number] {
    const a = Math.random() * Math.PI * 2;
    const c = Math.random() * 2 - 1;
    const s = Math.sqrt(1 - c * c);
    return [Math.cos(a) * s, c, Math.sin(a) * s];
  }

  /** The geyser's spot: right under you when you stand near, else in front, toward the viewer. */
  private startGeyser(player: CrabPlayer | null, toPlayer: number): void {
    if (player && toPlayer < AIM_PLAYER) {
      this.gx = player.x;
      this.gz = player.z;
    } else {
      const dx = this.viewX - this.x;
      const dz = this.viewZ - this.z;
      const d = Math.hypot(dx, dz) || 1;
      this.gx = this.x + (dx / d) * 1.8;
      this.gz = this.z + (dz / d) * 1.8;
    }
    this.gy = Math.max(0, this.world.heightAt(this.gx, this.gz));
    this.events.onVoice('greet');
    this.pulseIn = 0;
    this.world.fx.sound('charge', 0.8, this.gx, this.gy, this.gz);
    this.go('geyserUp', GEYSER.windup);
  }

  /** The geyser breaks out: a flash, a crown of spray, a shock wave, the ground shaking. */
  private burstGeyser(): void {
    const fx = this.world.fx;
    const { gx, gy, gz } = this;
    fx.flash(gx, gy + 2, gz, 0xd8f4ff, 110, 18, 0.7);
    fx.shock(gx, gy, gz, 'water', 0x6fd0ff, 9, 1.5, 2.6);
    fx.shake(gx, gy, gz, 0.55, 1);
    fx.sound('splash', 1, gx, gy, gz);
    fx.sound('boom', 0.6, gx, gy, gz);
    fx.focus(gx, gy + 4, gz, GEYSER.time + 1);
    const c = this.column;
    c.ox = gx;
    c.oy = gy;
    c.oz = gz;
    c.vy = GEYSER.speed[1];
    c.flight = c.vy / 9.81;
    this.columnAge = 0;
    this.events.onSquirt(GEYSER.time);
    this.go('geyser', GEYSER.time);
  }

  /**
   * One frame of the geyser: a column of water drops thrown up (falling back as rain round it),
   * and in daylight a rainbow arching over it, facing the viewer (bands of rainbow motes on a
   * half circle). Standing in it soaks you.
   */
  private geyser(dt: number, player: CrabPlayer | null): void {
    const w = this.world;
    // Strongest in the middle of its time.
    const k = Math.sin(Math.PI * Math.min(1, 1 - this.timer / GEYSER.time));
    this.dropDebt += dt * GEYSER.drops * (0.4 + 0.6 * k);
    for (; this.dropDebt >= 1; this.dropDebt -= 1) {
      const a = Math.random() * Math.PI * 2;
      if (Math.random() < 0.25) {
        // The skirt: low, wide splashes all round the foot.
        const s = 1.5 + Math.random() * 2.5;
        w.spray.drop(this.gx + Math.cos(a) * 0.3, this.gy + 0.05, this.gz + Math.sin(a) * 0.3, Math.cos(a) * s, 2 + Math.random() * 3, Math.sin(a) * s, 0.025 + Math.random() * 0.04);
        continue;
      }
      // The column: thick, fast, fanning out a little at the top.
      const r = Math.random() * 0.35;
      const up = GEYSER.speed[0] + Math.random() * (GEYSER.speed[1] - GEYSER.speed[0]) * (0.5 + 0.5 * k);
      const spread = 0.2 + Math.random() * 0.9;
      w.spray.drop(this.gx + Math.cos(a) * r, this.gy + 0.05, this.gz + Math.sin(a) * r, Math.cos(a) * spread, up, Math.sin(a) * spread, 0.035 + Math.random() * 0.05);
    }
    // A pulse of the crown now and then, while it is strongest.
    if (k > 0.5 && Math.random() < dt * 2) w.fx.shock(this.gx, this.gy, this.gz, 'water', 0x8fdcff, 3.5, 0.8, 1.2);
    const day = w.daylight();
    if (day > 0.25) {
      // Across the line of sight: the arch stands facing the viewer.
      const vx = this.viewX - this.gx;
      const vz = this.viewZ - this.gz;
      const vd = Math.hypot(vx, vz) || 1;
      const px = -vz / vd;
      const pz = vx / vd;
      this.bowDebt += dt * 230;
      for (; this.bowDebt >= 1; this.bowDebt -= 1) {
        const t = Math.random() * Math.PI;
        for (let b = 0; b < 7; b++) {
          const rr = GEYSER.rainbow + (3 - b) * 0.17;
          w.rainbow.emit(this.gx + px * Math.cos(t) * rr, this.gy + 0.3 + Math.sin(t) * rr, this.gz + pz * Math.cos(t) * rr, 0, 0.3, 0, 0.13 + Math.random() * 0.05, (b / 7) * 0.8);
        }
      }
    }
    if (player && !this.hit && Math.hypot(player.x - this.gx, player.z - this.gz) < GEYSER.soak && k > 0.3) {
      this.hit = true;
      this.events.onHitPlayer();
    }
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

  private offStage(): boolean {
    const st = this.stage;
    return st !== null && Math.hypot(this.x - st.x, this.z - st.z) > STAGE_RADIUS * 2;
  }

  /**
   * The desk show: on its stage, now and then a giant bubble, a rainbow geyser (in front of it,
   * toward you) or a dance in a cloud of bubbles; none of them with a name card.
   */
  private stageShow(dt: number, quiet: boolean, mouth: { x: number; y: number; z: number }): void {
    this.showIn -= dt;
    if (this.showIn > 0 || this.busy || this.queued || !quiet || this.offStage()) return;
    this.showIn = this.between(SHOW_EVERY);
    const r = Math.random();
    if (r < 0.4) {
      this.skill = 'bubbles';
      this.queued = true;
      this.silent = true;
    } else if (r < 0.75) {
      this.skill = 'geyser';
      this.queued = true;
      this.silent = true;
    } else {
      this.events.onVoice('dance');
      this.go('dance', 2.4);
      this.blowBubbles(mouth, PAT_BURST * 2, 1.3);
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
    const st = this.stage;
    if (st) {
      // At the desk show: back to the stage if it strayed, else a step about on it.
      const a = Math.random() * Math.PI * 2;
      const r = this.offStage() ? 0 : Math.random() * STAGE_RADIUS;
      this.tx = st.x + Math.cos(a) * r;
      this.tz = st.z + Math.sin(a) * r;
      return;
    }
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
