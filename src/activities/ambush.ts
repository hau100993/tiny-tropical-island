import type { SkillFxSink } from '../world/creatures/skillFx';
import type { EmberSink } from '../world/creatures/embers';
import type { SpraySink } from '../water/Spray';
import type { BubbleSink } from '../world/creatures/airBubbles';
import type { Attacker, WildKind } from './wildCreatures';

/** A shot's flight time (s), how near its landing still hits (m), and the damage (range). */
const SHOT = { flight: 1.0, reach: 1.6, damage: [15, 25] } as const;
/** It goes for Mochi this often when Mochi is about (else for you). */
const AT_DOG = 0.35;
/** Mochi strikes back this long after the shot leaves (s). */
const COUNTER_AFTER = 0.6;

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
  /** A shot hit you / Mochi (`kind`: whose). */
  hitYou(kind: WildKind, amount: number): void;
  hitDog(kind: WildKind, amount: number): void;
  /** Mochi strikes back at it (true if it could). */
  counter(a: Attacker): boolean;
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
  attacker: Attacker;
  countered: boolean;
}

/**
 * Forest ambushes (WildCreatures winds them up): the wild one's attack, a shot of its element
 * arcing at you or at Mochi (a ball of water and bubbles, a fireball, a whirl of leaves), aimed
 * where its target stood when it left, so running away dodges it; it bursts where it lands and
 * hurts whoever is still near. Mochi strikes back at the attacker meanwhile (DogSkills.counter),
 * which drives it off.
 */
export class Ambush {
  private readonly shots: Shot[] = [];

  constructor(private readonly host: AmbushHost) {}

  /** A wild one attacks (WildHost.attack). */
  attack(a: Attacker): void {
    const h = this.host;
    const you = h.you();
    const dog = h.dog();
    const at: 'you' | 'dog' | null = dog && (!you || Math.random() < AT_DOG) ? 'dog' : you ? 'you' : null;
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
      attacker: a,
      countered: false,
    });
    h.fx.sound(a.kind === 'crab' ? 'splash' : a.kind === 'dragon' ? 'boom' : 'whoosh', 0.3, a.x, a.y, a.z);
  }

  /** Anything in flight. */
  get busy(): boolean {
    return this.shots.length > 0;
  }

  update(dt: number): void {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      s.vy -= 9.81 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      this.trail(s);
      if (!s.countered && s.t >= COUNTER_AFTER) {
        s.countered = true;
        if (!s.attacker.gone) this.host.counter(s.attacker);
      }
      if (s.t >= SHOT.flight) {
        this.land(s);
        this.shots.splice(i, 1);
      }
    }
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
    const amount = Math.round(SHOT.damage[0] + Math.random() * (SHOT.damage[1] - SHOT.damage[0]));
    if (s.at === 'dog') h.hitDog(s.kind, amount);
    else {
      fx.shake(s.x, s.y, s.z, 0.45, 0.4);
      h.hitYou(s.kind, amount);
    }
  }
}
