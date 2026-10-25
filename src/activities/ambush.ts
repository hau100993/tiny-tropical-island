import type { SkillFxSink } from '../world/creatures/skillFx';
import type { EmberSink } from '../world/creatures/embers';
import type { SpraySink } from '../water/Spray';
import type { BubbleSink } from '../world/creatures/airBubbles';
import { MAX_HP } from '../core/health';
import type { Attacker, WildKind } from './wildCreatures';

/** A shot's flight time (s), how near its landing still hits (m), and the damage to Mochi (range). */
const SHOT = { flight: 1.0, reach: 1.6, damage: [15, 25] } as const;
/** It throws again this often while fighting (s, random in the range). */
const SHOT_EVERY = [1.6, 2.2] as const;
/** It aims at Mochi this often when Mochi is about (else at you). */
const AT_DOG = 0.35;
/** Mochi standing guard takes a shot meant for you this often. */
const BLOCK = 0.5;
/** Mochi stands guard this far in front of you (m), toward the attacker. */
const GUARD = 1.5;
/** Mochi strikes first this long after the shot leaves (s), then again this often; each hit's damage. */
const COUNTER = { first: 0.6, every: [1.5, 2.0], damage: [35, 50] } as const;
/** Without Mochi, it gives up after this many shots. */
const SHOTS_ALONE = 3;

export interface AmbushHost {
  fx: SkillFxSink;
  embers: EmberSink;
  spores: EmberSink;
  fluff: EmberSink;
  spray: SpraySink;
  bubbles: BubbleSink;
  heightAt(x: number, z: number): number;
  /** You (feet) when walking on land, else null. */
  you(): { x: number; y: number; z: number } | null;
  /** Mochi (feet) when it is about and on its feet, else null. */
  dog(): { x: number; y: number; z: number } | null;
  /** Mochi runs to (x, z) and stands there facing (fx, fz); false if it can't now (busy, not there). */
  guard(x: number, z: number, fx: number, fz: number): boolean;
  /** A shot hit you (`kind`: whose): only splashes, you have no health. */
  splashYou(kind: WildKind): void;
  /** A shot hit Mochi for `amount`. */
  hitDog(kind: WildKind, amount: number): void;
  /** Mochi strikes at it; `hit` when it lands. False if it can't now. */
  counter(a: Attacker, hit: () => void): boolean;
}

/** One fight: the wild one, its health, its next shot and Mochi's next strike (s). */
export interface Fight {
  readonly a: Attacker;
  hp: number;
  shotIn: number;
  counterIn: number;
  shots: number;
  /** It has thrown its first shot (the wind-up is over); Mochi has been in this fight. */
  started: boolean;
  dogJoined: boolean;
}

interface Shot {
  kind: WildKind;
  at: 'you' | 'dog';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  t: number;
}

const between = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);

/**
 * Forest fights (WildCreatures winds them up): as a wild one gets ready, Mochi runs to stand
 * guard in front of you, between you and it. Then the two fight: it throws a shot of its element
 * every couple of seconds (a ball of water and bubbles, a fireball, a whirl of leaves) in an arc
 * at you or at Mochi, aimed where its target stood (running dodges it; Mochi on guard takes some
 * meant for you); a hit on you only splashes, a hit on Mochi costs it health. Mochi strikes back
 * again and again (DogSkills.counter) until the wild one's health is gone and it is driven off;
 * if Mochi goes down instead, it wins and slips away.
 */
export class Ambush {
  readonly fights: Fight[] = [];
  private readonly shots: Shot[] = [];

  constructor(private readonly host: AmbushHost) {}

  /** A wild one is about to attack (WildHost.windup): Mochi steps up. */
  windup(a: Attacker): void {
    if (this.fights.some((f) => f.a === a)) return;
    this.fights.push({ a, hp: MAX_HP, shotIn: Infinity, counterIn: Infinity, shots: 0, started: false, dogJoined: false });
  }

  /** Its first attack (WildHost.attack). */
  attack(a: Attacker): void {
    let f = this.fights.find((x) => x.a === a);
    if (!f) {
      this.windup(a);
      f = this.fights[this.fights.length - 1];
    }
    f.started = true;
    f.counterIn = COUNTER.first;
    this.shoot(f);
  }

  /** A fight is on (Mochi's bar and the wild ones' show). */
  get fighting(): boolean {
    return this.fights.length > 0;
  }

  update(dt: number): void {
    const h = this.host;
    for (let i = this.fights.length - 1; i >= 0; i--) {
      const f = this.fights[i];
      const a = f.a;
      if (a.gone) {
        this.fights.splice(i, 1);
        continue;
      }
      const dog = h.dog();
      const you = h.you();
      // Mochi went down: the wild one has won. No Mochi at all: it gives up after a few shots.
      if (!dog && (f.dogJoined || f.shots >= SHOTS_ALONE)) {
        a.leave();
        this.fights.splice(i, 1);
        continue;
      }
      if (dog) f.dogJoined = true;
      // Mochi on guard: in front of you, toward it.
      if (dog && you) {
        const dx = a.x - you.x;
        const dz = a.z - you.z;
        const d = Math.hypot(dx, dz) || 1;
        h.guard(you.x + (dx / d) * GUARD, you.z + (dz / d) * GUARD, a.x, a.z);
      }
      if (!f.started) continue;
      f.shotIn -= dt;
      if (f.shotIn <= 0) {
        a.cast();
        this.shoot(f);
      }
      f.counterIn -= dt;
      if (dog && f.counterIn <= 0) {
        f.counterIn = h.counter(a, () => this.strike(f)) ? between(COUNTER.every) : 0.3;
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      s.vy -= 9.81 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      this.trail(s);
      if (s.t >= SHOT.flight) {
        this.land(s);
        this.shots.splice(i, 1);
      }
    }
  }

  /** Mochi's strike lands on it: health down; at 0 it is driven off. */
  private strike(f: Fight): void {
    f.hp = Math.max(0, f.hp - between(COUNTER.damage));
    if (f.hp <= 0) f.a.banish();
  }

  /** It throws: at Mochi or at you; Mochi on guard may take the one meant for you. */
  private shoot(f: Fight): void {
    const h = this.host;
    const a = f.a;
    f.shots++;
    f.shotIn = between(SHOT_EVERY);
    const you = h.you();
    const dog = h.dog();
    let at: 'you' | 'dog' | null = dog && (!you || Math.random() < AT_DOG) ? 'dog' : you ? 'you' : null;
    if (at === 'you' && dog && you && Math.random() < BLOCK && this.onLine(a, dog, you)) at = 'dog';
    if (!at) return;
    const t = (at === 'dog' ? dog : you) as { x: number; y: number; z: number };
    const ty = t.y + (at === 'dog' ? 0.35 : 1.0);
    const T = SHOT.flight;
    this.shots.push({
      kind: a.kind,
      at,
      x: a.x,
      y: a.y,
      z: a.z,
      vx: (t.x - a.x) / T,
      vy: (ty - a.y) / T + (9.81 * T) / 2,
      vz: (t.z - a.z) / T,
      t: 0,
    });
    h.fx.sound(a.kind === 'crab' ? 'splash' : a.kind === 'dragon' ? 'boom' : 'whoosh', 0.3, a.x, a.y, a.z);
  }

  /** Mochi stands near the line from it to you (within 1.2 m, between the two). */
  private onLine(a: { x: number; z: number }, dog: { x: number; z: number }, you: { x: number; z: number }): boolean {
    const vx = you.x - a.x;
    const vz = you.z - a.z;
    const len2 = vx * vx + vz * vz || 1;
    const k = ((dog.x - a.x) * vx + (dog.z - a.z) * vz) / len2;
    if (k < 0 || k > 1) return false;
    return Math.hypot(a.x + vx * k - dog.x, a.z + vz * k - dog.z) < 1.2;
  }

  /** The shot in flight, one frame: its element round a bright core. */
  private trail(s: Shot): void {
    const h = this.host;
    const j = (): number => (Math.random() - 0.5) * 0.25;
    if (s.kind === 'crab') {
      for (let k = 0; k < 4; k++) h.spray.drop(s.x + j(), s.y + j(), s.z + j(), j(), j(), j(), 0.04 + Math.random() * 0.04);
      h.bubbles.blow(s.x, s.y, s.z, j(), 0.2, j(), 0.1 + Math.random() * 0.08);
    } else if (s.kind === 'dragon') {
      h.embers.emit(s.x, s.y, s.z, 0, 0, 0, 0.42);
      for (let k = 0; k < 4; k++) h.embers.emit(s.x + j(), s.y + j(), s.z + j(), -s.vx * 0.15 + j() * 4, -s.vy * 0.15 + j() * 4, -s.vz * 0.15 + j() * 4, 0.07 + Math.random() * 0.07);
    } else {
      for (let k = 0; k < 5; k++) {
        const a = s.t * 25 + k * 1.26;
        h.spores.emit(s.x + Math.cos(a) * 0.25, s.y + Math.sin(a * 0.7) * 0.15, s.z + Math.sin(a) * 0.25, 0, 0.2, 0, 0.06 + Math.random() * 0.04);
      }
      if (Math.random() < 0.5) h.fluff.emit(s.x, s.y, s.z, j(), 0.3, j(), 0.08);
    }
  }

  /** It lands: a burst of its element, and whoever is still near is hit. */
  private land(s: Shot): void {
    const h = this.host;
    const fx = h.fx;
    const g = Math.max(0, h.heightAt(s.x, s.z));
    const color = s.kind === 'crab' ? 0x6fd0ff : s.kind === 'dragon' ? 0xff6a20 : 0x8cff7a;
    fx.shock(s.x, g, s.z, s.kind === 'crab' ? 'water' : s.kind === 'dragon' ? 'fire' : 'leaf', color, 2.6, 0.7, 0.9);
    if (s.kind === 'dragon') {
      fx.flash(s.x, s.y + 0.5, s.z, 0xff8a3d, 50, 9, 0.35);
      fx.mark(s.x, g, s.z, 0.9, 7);
      fx.sound('boom', 0.4, s.x, s.y, s.z);
    } else {
      fx.sound(s.kind === 'crab' ? 'splash' : 'whoosh', 0.5, s.x, s.y, s.z);
    }
    for (let k = 0; k < 50; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * 2.5;
      const vx = Math.cos(a) * v;
      const vz = Math.sin(a) * v;
      const vy = 1 + Math.random() * 2.5;
      if (s.kind === 'crab') h.spray.drop(s.x, s.y, s.z, vx, vy, vz, 0.03 + Math.random() * 0.04);
      else if (s.kind === 'dragon') h.embers.emit(s.x, s.y, s.z, vx, vy, vz, 0.06 + Math.random() * 0.08);
      else h.spores.emit(s.x, s.y, s.z, vx, vy * 0.5, vz, 0.05 + Math.random() * 0.05);
    }
    const t = s.at === 'dog' ? h.dog() : h.you();
    if (!t) return;
    const ty = t.y + (s.at === 'dog' ? 0.35 : 1.0);
    if (Math.hypot(t.x - s.x, ty - s.y, t.z - s.z) > SHOT.reach) return;
    if (s.at === 'dog') h.hitDog(s.kind, Math.round(between(SHOT.damage)));
    else {
      fx.shake(s.x, s.y, s.z, 0.35, 0.35);
      h.splashYou(s.kind);
    }
  }
}
