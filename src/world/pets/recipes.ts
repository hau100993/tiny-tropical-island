import type { SkillFxSink, ShockStyle } from '../creatures/skillFx';
import type { EmberSink } from '../creatures/embers';
import type { SpraySink } from '../../water/Spray';
import type { BubbleSink } from '../creatures/airBubbles';
import type { PetElement } from '../../pets/species';
import { ELEMENT_COLOR } from './looks';

/**
 * Skills made from a recipe: a few timed beats (gather, burst, a shot, a shower, a whirlwind, a
 * halo …) built from the shared skill effects (flash, shock wave, shake, sounds: SkillFx) and
 * the particle pools (sparks, steam, pollen, seeds, rainbow motes, water drops, bubbles), in the
 * element's colours. Every Level 2 skill of the originals and all the egg species' skills are
 * recipes; the originals' first three are their own hand-made code.
 *
 * Nothing here allocates per frame beyond the few small objects a cast starts with.
 */

export interface RecipePools {
  embers: EmberSink;
  steam: EmberSink;
  spores: EmberSink;
  fluff: EmberSink;
  rainbow: EmberSink;
  spray: SpraySink;
  bubbles: BubbleSink;
  /** Flowers at (x, z) (once Mầm is loaded; otherwise nothing). */
  bloom(x: number, z: number, n: number): void;
}

export interface RecipeHost {
  fx: SkillFxSink;
  pools: RecipePools;
  heightAt(x: number, z: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
}

/** Where the caster is now (it may move during the skill) and which way it faces. */
export interface Caster {
  x: number;
  y: number;
  z: number;
  /** Heading (rad, 0 = +z). */
  yaw: number;
}

type Beat =
  | { at: number; kind: 'gather'; time: number; radius: number }
  | { at: number; kind: 'burst'; radius: number; size: number }
  | { at: number; kind: 'nova'; radius: number; wall: number }
  | { at: number; kind: 'shot'; reach: number; speed: number; size: number }
  | { at: number; kind: 'shower'; reach: number; radius: number; time: number; rate: number }
  | { at: number; kind: 'whirl'; height: number; time: number }
  | { at: number; kind: 'fountain'; height: number; time: number }
  | { at: number; kind: 'halo'; radius: number; time: number }
  | { at: number; kind: 'meteors'; reach: number; count: number; every: number }
  | { at: number; kind: 'ring'; radius: number; count: number; every: number }
  | { at: number; kind: 'bloom'; radius: number; count: number }
  | { at: number; kind: 'dash'; reach: number; time: number };

/** Each recipe skill by its (English) name. */
const RECIPES: Readonly<Record<string, readonly Beat[]>> = {
  // ---- Mochi, Level 2 ----
  'Comet Dash': [
    { at: 0, kind: 'gather', time: 0.5, radius: 1.5 },
    { at: 0.5, kind: 'dash', reach: 9, time: 0.6 },
    { at: 1.1, kind: 'burst', radius: 4, size: 1 },
  ],
  'Thunder Howl': [
    { at: 0, kind: 'gather', time: 0.6, radius: 2 },
    { at: 0.6, kind: 'nova', radius: 7, wall: 1.5 },
    { at: 0.7, kind: 'meteors', reach: 4, count: 5, every: 0.15 },
  ],
  'Storm Halo': [
    { at: 0, kind: 'halo', radius: 1.6, time: 2.4 },
    { at: 0.4, kind: 'ring', radius: 3.5, count: 6, every: 0.25 },
    { at: 2.0, kind: 'nova', radius: 5, wall: 1 },
  ],
  // ---- Bọt, Level 2 ----
  'Tidal Crash': [
    { at: 0, kind: 'gather', time: 0.5, radius: 2 },
    { at: 0.5, kind: 'nova', radius: 8, wall: 2.2 },
    { at: 0.6, kind: 'shower', reach: 0, radius: 4, time: 1.2, rate: 160 },
  ],
  'Bubble Dome': [
    { at: 0, kind: 'halo', radius: 2.2, time: 2.5 },
    { at: 0.2, kind: 'fountain', height: 2.5, time: 1.8 },
    { at: 2.3, kind: 'burst', radius: 3, size: 1 },
  ],
  'Coral Rain': [
    { at: 0, kind: 'fountain', height: 5, time: 0.6 },
    { at: 0.6, kind: 'shower', reach: 4, radius: 3.5, time: 2, rate: 120 },
    { at: 1.2, kind: 'bloom', radius: 3, count: 8 },
  ],
  // ---- Hỏa Long, Level 2 ----
  'Solar Flare': [
    { at: 0, kind: 'gather', time: 0.8, radius: 2.5 },
    { at: 0.8, kind: 'nova', radius: 9, wall: 2 },
    { at: 0.8, kind: 'burst', radius: 5, size: 1.4 },
  ],
  'Phoenix Dive': [
    { at: 0, kind: 'dash', reach: 10, time: 0.8 },
    { at: 0.8, kind: 'burst', radius: 5, size: 1.2 },
    { at: 0.9, kind: 'whirl', height: 5, time: 1.4 },
  ],
  'Ember Halo': [
    { at: 0, kind: 'halo', radius: 2, time: 2.2 },
    { at: 0.3, kind: 'ring', radius: 4, count: 8, every: 0.2 },
  ],
  // ---- Mầm, Level 2 ----
  'Bloom Wave': [
    { at: 0, kind: 'gather', time: 0.5, radius: 1.5 },
    { at: 0.5, kind: 'nova', radius: 7, wall: 0.8 },
    { at: 0.6, kind: 'bloom', radius: 6, count: 16 },
  ],
  'Vine Spiral': [
    { at: 0, kind: 'whirl', height: 4, time: 2 },
    { at: 0.3, kind: 'ring', radius: 3, count: 6, every: 0.25 },
    { at: 1.6, kind: 'bloom', radius: 3, count: 8 },
  ],
  'Pollen Comet': [
    { at: 0, kind: 'gather', time: 0.4, radius: 1 },
    { at: 0.4, kind: 'shot', reach: 10, speed: 12, size: 1.2 },
    { at: 1.3, kind: 'bloom', radius: 2.5, count: 10 },
  ],
  // ---- Bé Mập, Level 2 ----
  'Tsunami Leap': [
    { at: 0, kind: 'fountain', height: 3, time: 0.5 },
    { at: 0.5, kind: 'nova', radius: 9, wall: 2.5 },
  ],
  'Deep Vortex': [
    { at: 0, kind: 'whirl', height: 3, time: 2.2 },
    { at: 0.2, kind: 'halo', radius: 2.5, time: 2 },
  ],
  'Rainbow Spout': [
    { at: 0, kind: 'fountain', height: 6, time: 1.6 },
    { at: 0.8, kind: 'shower', reach: 0, radius: 3, time: 1.4, rate: 90 },
  ],
  // ---- Đom Đóm Sét ----
  'Spark Flicker': [{ at: 0, kind: 'burst', radius: 1.5, size: 0.6 }],
  'Static Orbit': [{ at: 0, kind: 'halo', radius: 1.2, time: 1.8 }],
  'Chain Zap': [
    { at: 0, kind: 'shot', reach: 6, speed: 16, size: 0.6 },
    { at: 0.25, kind: 'ring', radius: 2, count: 3, every: 0.15 },
  ],
  'Thunder Lantern': [
    { at: 0, kind: 'gather', time: 0.7, radius: 2 },
    { at: 0.7, kind: 'burst', radius: 4, size: 1.1 },
    { at: 0.8, kind: 'fountain', height: 4, time: 0.8 },
  ],
  'Plasma Swarm': [
    { at: 0, kind: 'halo', radius: 2, time: 1.5 },
    { at: 0.3, kind: 'meteors', reach: 3, count: 6, every: 0.18 },
  ],
  'Sky Bolt': [
    { at: 0, kind: 'gather', time: 0.6, radius: 1.5 },
    { at: 0.6, kind: 'meteors', reach: 5, count: 1, every: 0 },
    { at: 0.7, kind: 'nova', radius: 6, wall: 2 },
  ],
  // ---- Sứa Mây ----
  'Mist Pulse': [{ at: 0, kind: 'nova', radius: 3, wall: 0.6 }],
  'Drizzle Veil': [
    { at: 0, kind: 'burst', radius: 1.5, size: 0.5 },
    { at: 0.1, kind: 'shower', reach: 0, radius: 2.2, time: 1.8, rate: 70 },
  ],
  'Tide Ring': [{ at: 0, kind: 'ring', radius: 2.5, count: 6, every: 0.12 }],
  'Rain Bloom': [
    { at: 0, kind: 'gather', time: 0.4, radius: 1.5 },
    { at: 0.4, kind: 'shower', reach: 2, radius: 3, time: 1.6, rate: 110 },
    { at: 1, kind: 'bloom', radius: 2.5, count: 8 },
  ],
  'Jelly Nova': [
    { at: 0, kind: 'gather', time: 0.6, radius: 2 },
    { at: 0.6, kind: 'nova', radius: 7, wall: 1.6 },
    { at: 0.6, kind: 'burst', radius: 3, size: 1 },
  ],
  'Ocean Halo': [
    { at: 0, kind: 'halo', radius: 2.4, time: 2.4 },
    { at: 0.5, kind: 'fountain', height: 3, time: 1.4 },
  ],
  // ---- Bé Dung Nham ----
  'Magma Hop': [{ at: 0.2, kind: 'burst', radius: 2, size: 0.7 }],
  'Ember Spit': [{ at: 0, kind: 'shot', reach: 6, speed: 9, size: 0.7 }],
  'Heat Wave': [{ at: 0, kind: 'nova', radius: 4, wall: 0.9 }],
  'Lava Fountain': [
    { at: 0, kind: 'fountain', height: 4, time: 1.5 },
    { at: 0.6, kind: 'shower', reach: 0, radius: 2.5, time: 1, rate: 60 },
  ],
  'Molten Quake': [
    { at: 0, kind: 'gather', time: 0.5, radius: 1.5 },
    { at: 0.5, kind: 'nova', radius: 7, wall: 1.2 },
    { at: 0.6, kind: 'ring', radius: 3.5, count: 6, every: 0.12 },
  ],
  'Sun Drop': [
    { at: 0, kind: 'gather', time: 0.8, radius: 2.5 },
    { at: 0.8, kind: 'meteors', reach: 4, count: 4, every: 0.25 },
  ],
  // ---- Rùa Rêu ----
  'Moss Shield': [{ at: 0, kind: 'halo', radius: 1.3, time: 2 }],
  'Seed Volley': [
    { at: 0, kind: 'shot', reach: 5, speed: 10, size: 0.6 },
    { at: 0.2, kind: 'shot', reach: 6, speed: 10, size: 0.6 },
    { at: 0.4, kind: 'shot', reach: 7, speed: 10, size: 0.6 },
  ],
  'Root Quake': [
    { at: 0, kind: 'nova', radius: 4.5, wall: 0.7 },
    { at: 0.2, kind: 'bloom', radius: 3, count: 6 },
  ],
  'Forest Crown': [
    { at: 0, kind: 'gather', time: 0.6, radius: 2 },
    { at: 0.6, kind: 'fountain', height: 4, time: 1 },
    { at: 1, kind: 'bloom', radius: 4, count: 14 },
  ],
  'Thorn Garden': [
    { at: 0, kind: 'ring', radius: 3, count: 8, every: 0.1 },
    { at: 0.9, kind: 'bloom', radius: 3, count: 10 },
  ],
  'Ancient Bloom': [
    { at: 0, kind: 'whirl', height: 5, time: 1.8 },
    { at: 1.2, kind: 'nova', radius: 8, wall: 1.4 },
    { at: 1.3, kind: 'bloom', radius: 7, count: 20 },
  ],
  // ---- Cú Trăng ----
  Moonbeam: [{ at: 0, kind: 'shot', reach: 8, speed: 14, size: 0.8 }],
  'Night Glide': [{ at: 0, kind: 'dash', reach: 6, time: 0.6 }],
  'Star Dust': [
    { at: 0, kind: 'burst', radius: 1.5, size: 0.5 },
    { at: 0.1, kind: 'shower', reach: 0, radius: 2.5, time: 1.6, rate: 80 },
  ],
  'Lunar Halo': [
    { at: 0, kind: 'halo', radius: 2.2, time: 2.2 },
    { at: 1.8, kind: 'nova', radius: 5, wall: 1.2 },
  ],
  'Comet Rain': [{ at: 0, kind: 'meteors', reach: 5, count: 7, every: 0.18 }],
  Eclipse: [
    { at: 0, kind: 'gather', time: 1, radius: 3 },
    { at: 1, kind: 'nova', radius: 10, wall: 2.5 },
    { at: 1, kind: 'burst', radius: 5, size: 1.4 },
  ],
};

export function hasRecipe(skill: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, skill);
}

/** How long a recipe runs (s), for "busy" checks. */
export function recipeLength(skill: string): number {
  let end = 0;
  for (const b of RECIPES[skill] ?? []) {
    const len = 'time' in b ? b.time : b.kind === 'meteors' || b.kind === 'ring' ? b.count * b.every + 0.6 : b.kind === 'shot' ? b.reach / b.speed : 0.5;
    end = Math.max(end, b.at + len);
  }
  return end;
}

const STYLE: Readonly<Record<PetElement, ShockStyle>> = { water: 'water', fire: 'fire', grass: 'leaf', spark: 'spark', moon: 'energy' };

/** A running piece of a cast (a shot in flight, a shower, a halo …): false when done. */
interface Running {
  update(dt: number): boolean;
}

interface Cast {
  beats: readonly Beat[];
  next: number;
  t: number;
  caster: Caster;
  element: PetElement;
  power: number;
  /** Where the skill aims: fixed at the start, `reach` m ahead along this direction. */
  dirX: number;
  dirZ: number;
}

export class RecipeRunner {
  private readonly casts: Cast[] = [];
  private readonly running: Running[] = [];

  constructor(private readonly host: RecipeHost) {}

  /** Starts a recipe skill from `caster` (read live while it runs); false if unknown. */
  cast(skill: string, caster: Caster, element: PetElement, power: number): boolean {
    const beats = RECIPES[skill];
    if (!beats) return false;
    this.casts.push({ beats, next: 0, t: 0, caster, element, power, dirX: Math.sin(caster.yaw), dirZ: Math.cos(caster.yaw) });
    return true;
  }

  get busy(): boolean {
    return this.casts.length > 0 || this.running.length > 0;
  }

  update(dt: number): void {
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const c = this.casts[i];
      c.t += dt;
      while (c.next < c.beats.length && c.beats[c.next].at <= c.t) this.beat(c, c.beats[c.next++]);
      if (c.next >= c.beats.length) this.casts.splice(i, 1);
    }
    for (let i = this.running.length - 1; i >= 0; i--) if (!this.running[i].update(dt)) this.running.splice(i, 1);
  }

  // ---- Particles by element ----

  /** One mote of the element at (x, y, z) moving (vx, vy, vz). */
  private mote(el: PetElement, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const p = this.host.pools;
    switch (el) {
      case 'water':
        if (Math.random() < 0.25) p.bubbles.blow(x, y, z, vx * 0.5, vy * 0.5, vz * 0.5, size * 0.9);
        else p.spray.drop(x, y, z, vx, vy, vz, size * 0.7);
        break;
      case 'fire':
        if (Math.random() < 0.2) p.steam.emit(x, y, z, vx * 0.3, vy * 0.3 + 0.4, vz * 0.3, size * 1.6);
        else p.embers.emit(x, y, z, vx, vy, vz, size);
        break;
      case 'grass':
        if (Math.random() < 0.3) p.fluff.emit(x, y, z, vx * 0.6, vy * 0.6, vz * 0.6, size * 1.2);
        else p.spores.emit(x, y, z, vx, vy, vz, size * 0.8);
        break;
      case 'spark':
        // Rainbow motes in yellow-white.
        p.rainbow.emit(x, y, z, vx, vy, vz, size, 0.13 + Math.random() * 0.05);
        break;
      case 'moon':
        if (Math.random() < 0.3) p.fluff.emit(x, y, z, vx * 0.5, vy * 0.5, vz * 0.5, size);
        else p.rainbow.emit(x, y, z, vx, vy, vz, size, 0.6 + Math.random() * 0.15);
        break;
    }
  }

  private sound(el: PetElement, big: boolean, x: number, y: number, z: number, size: number): void {
    const kind = el === 'water' ? 'splash' : el === 'fire' ? 'boom' : el === 'grass' ? 'whoosh' : el === 'spark' ? (big ? 'thunder' : 'zap') : big ? 'sonic' : 'charge';
    this.host.fx.sound(kind, Math.min(1, size), x, y, z);
  }

  private ground(x: number, z: number): number {
    return Math.max(0, this.host.heightAt(x, z));
  }

  private beat(c: Cast, b: Beat): void {
    const { fx } = this.host;
    const el = c.element;
    const color = ELEMENT_COLOR[el];
    const k = c.power;
    const at = c.caster;
    switch (b.kind) {
      case 'gather': {
        const r = b.radius * k;
        let left = b.time;
        this.sound(el, false, at.x, at.y, at.z, 0.4);
        this.running.push({
          update: (dt) => {
            left -= dt;
            for (let i = 0; i < Math.ceil(90 * dt * k); i++) {
              const a = Math.random() * Math.PI * 2;
              const h = (Math.random() - 0.3) * r;
              const sx = at.x + Math.cos(a) * r;
              const sz = at.z + Math.sin(a) * r;
              const sy = at.y + h;
              const s = 1 / 0.45;
              this.mote(el, sx, sy, sz, (at.x - sx) * s, (at.y + 0.3 - sy) * s, (at.z - sz) * s, 0.04);
            }
            return left > 0;
          },
        });
        break;
      }
      case 'burst': {
        const r = b.radius * k;
        const y = Math.max(at.y, this.ground(at.x, at.z));
        fx.flash(at.x, y + 0.5, at.z, color, 60 * b.size * k, 6 * k, 0.35);
        fx.shock(at.x, this.ground(at.x, at.z), at.z, STYLE[el], color, r, 0.45);
        this.sound(el, b.size > 0.9, at.x, y, at.z, b.size);
        const n = Math.round(70 * b.size * k);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const cz = Math.random() * 2 - 1;
          const s = Math.sqrt(1 - cz * cz);
          const v = (1.5 + Math.random() * 3) * Math.sqrt(k);
          this.mote(el, at.x, y + 0.4, at.z, Math.cos(a) * s * v, Math.abs(cz) * v + 0.8, Math.sin(a) * s * v, 0.04 + Math.random() * 0.04);
        }
        if (el === 'water') this.host.ripple(at.x, at.z, r * 0.5, 0.4);
        break;
      }
      case 'nova': {
        const r = b.radius * k;
        const y = this.ground(at.x, at.z);
        fx.shock(at.x, y, at.z, STYLE[el], color, r, 0.7, b.wall * k);
        fx.flash(at.x, y + 1, at.z, color, 90 * k, 8 * k, 0.45);
        fx.shake(at.x, y, at.z, Math.min(1, 0.35 * k), 0.5);
        fx.focus(at.x, y + 1, at.z, 0.8);
        this.sound(el, true, at.x, y, at.z, 0.9);
        for (let i = 0; i < 120 * k; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = (3 + Math.random() * 4) * Math.sqrt(k);
          this.mote(el, at.x, y + 0.2, at.z, Math.cos(a) * v, 0.6 + Math.random() * 1.2, Math.sin(a) * v, 0.05);
        }
        if (el === 'water' || el === 'moon') this.host.ripple(at.x, at.z, r * 0.4, 0.6);
        break;
      }
      case 'shot': {
        const reach = b.reach * k;
        let t = 0;
        const time = reach / b.speed;
        const sx = at.x;
        const sy = at.y + 0.4;
        const sz = at.z;
        const tx = sx + c.dirX * reach;
        const tz = sz + c.dirZ * reach;
        const ty = this.ground(tx, tz) + 0.3;
        this.sound(el, false, sx, sy, sz, 0.5);
        this.running.push({
          update: (dt) => {
            t += dt;
            const q = Math.min(1, t / time);
            const x = sx + (tx - sx) * q;
            const z = sz + (tz - sz) * q;
            const y = sy + (ty - sy) * q + Math.sin(q * Math.PI) * 0.6;
            for (let i = 0; i < 6; i++) this.mote(el, x, y, z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.06 * b.size);
            if (q >= 1) {
              this.beat({ ...c, caster: { x: tx, y: ty, z: tz, yaw: at.yaw } }, { at: 0, kind: 'burst', radius: 2.5 * b.size, size: b.size });
              return false;
            }
            return true;
          },
        });
        break;
      }
      case 'shower': {
        const cx = at.x + c.dirX * b.reach * k;
        const cz = at.z + c.dirZ * b.reach * k;
        const r = b.radius * k;
        let left = b.time;
        this.running.push({
          update: (dt) => {
            left -= dt;
            const n = Math.ceil(b.rate * dt * k);
            for (let i = 0; i < n; i++) {
              const a = Math.random() * Math.PI * 2;
              const d = Math.sqrt(Math.random()) * r;
              const x = cx + Math.cos(a) * d;
              const z = cz + Math.sin(a) * d;
              this.mote(el, x, this.ground(x, z) + 3 + Math.random(), z, 0, -2.5 - Math.random() * 2, 0, 0.04);
            }
            if (el === 'water' && Math.random() < dt * 8) this.host.ripple(cx + (Math.random() - 0.5) * r, cz + (Math.random() - 0.5) * r, 0.5, 0.1);
            return left > 0;
          },
        });
        break;
      }
      case 'whirl': {
        const y = this.ground(at.x, at.z);
        fx.vortex(at.x, y, at.z, color, b.height * k, 1.6 * k, b.time);
        this.sound(el, true, at.x, y, at.z, 0.7);
        let t = 0;
        this.running.push({
          update: (dt) => {
            t += dt;
            for (let i = 0; i < Math.ceil(80 * dt * k); i++) {
              const a = t * 6 + Math.random() * Math.PI * 2;
              const h = Math.random() * b.height * k;
              const rr = 0.3 + (h / (b.height * k)) * 1.4 * k;
              this.mote(el, at.x + Math.cos(a) * rr, y + h, at.z + Math.sin(a) * rr, -Math.sin(a) * 3, 1.2, Math.cos(a) * 3, 0.045);
            }
            return t < b.time;
          },
        });
        break;
      }
      case 'fountain': {
        let t = 0;
        this.sound(el, false, at.x, at.y, at.z, 0.6);
        this.running.push({
          update: (dt) => {
            t += dt;
            const v = Math.sqrt(2 * 9.81 * b.height * k);
            for (let i = 0; i < Math.ceil(140 * dt * k); i++) {
              const a = Math.random() * Math.PI * 2;
              const s = Math.random() * 0.9;
              this.mote(el, at.x, this.ground(at.x, at.z) + 0.3, at.z, Math.cos(a) * s, v * (0.8 + Math.random() * 0.25), Math.sin(a) * s, 0.05);
            }
            return t < b.time;
          },
        });
        break;
      }
      case 'halo': {
        let t = 0;
        this.sound(el, false, at.x, at.y, at.z, 0.4);
        this.running.push({
          update: (dt) => {
            t += dt;
            const r = b.radius * k;
            for (let i = 0; i < 6; i++) {
              const a = t * 3.2 + (i / 6) * Math.PI * 2;
              this.mote(el, at.x + Math.cos(a) * r, at.y + 0.4 + Math.sin(t * 2 + i) * 0.25, at.z + Math.sin(a) * r, -Math.sin(a) * 0.5, 0.2, Math.cos(a) * 0.5, 0.05);
            }
            return t < b.time;
          },
        });
        break;
      }
      case 'meteors': {
        let fired = 0;
        let next = 0;
        let t = 0;
        const cx = at.x + c.dirX * b.reach * k;
        const cz = at.z + c.dirZ * b.reach * k;
        const falling: Array<{ x: number; z: number; y: number; vy: number }> = [];
        this.running.push({
          update: (dt) => {
            t += dt;
            while (fired < b.count && t >= next) {
              const a = Math.random() * Math.PI * 2;
              const d = b.count === 1 ? 0 : Math.random() * 3 * k;
              const x = cx + Math.cos(a) * d;
              const z = cz + Math.sin(a) * d;
              falling.push({ x, z, y: this.ground(x, z) + 12, vy: -18 });
              fired++;
              next += b.every;
            }
            for (let i = falling.length - 1; i >= 0; i--) {
              const m = falling[i];
              m.y += m.vy * dt;
              for (let j = 0; j < 5; j++) this.mote(el, m.x + (Math.random() - 0.5) * 0.3, m.y + Math.random() * 0.6, m.z + (Math.random() - 0.5) * 0.3, 0, 2, 0, 0.07);
              const g = this.ground(m.x, m.z);
              if (m.y <= g) {
                falling.splice(i, 1);
                this.beat({ ...c, caster: { x: m.x, y: g, z: m.z, yaw: at.yaw } }, { at: 0, kind: 'burst', radius: 2.2, size: 0.8 });
                fx.mark(m.x, g, m.z, 0.8, 4);
                fx.shake(m.x, g, m.z, 0.25, 0.25);
              }
            }
            return fired < b.count || falling.length > 0;
          },
        });
        break;
      }
      case 'ring': {
        let fired = 0;
        let t = 0;
        const r = b.radius * k;
        const yaw0 = Math.random() * Math.PI * 2;
        this.running.push({
          update: (dt) => {
            t += dt;
            while (fired < b.count && t >= fired * b.every) {
              const a = yaw0 + (fired / b.count) * Math.PI * 2;
              const x = at.x + Math.cos(a) * r;
              const z = at.z + Math.sin(a) * r;
              this.beat({ ...c, power: c.power * 0.6, caster: { x, y: this.ground(x, z), z, yaw: at.yaw } }, { at: 0, kind: 'burst', radius: 1.6, size: 0.55 });
              fired++;
            }
            return fired < b.count;
          },
        });
        break;
      }
      case 'bloom': {
        const n = Math.round(b.count * k);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
          const d = b.radius * k * (0.4 + Math.random() * 0.6);
          this.host.pools.bloom(at.x + Math.cos(a) * d, at.z + Math.sin(a) * d, 1 + Math.floor(Math.random() * 2));
        }
        break;
      }
      case 'dash': {
        // A streak of the element along the way ahead (the caster's own animation runs meanwhile).
        let t = 0;
        const sx = at.x;
        const sz = at.z;
        const reach = b.reach * k;
        this.sound(el, false, sx, at.y, sz, 0.6);
        this.running.push({
          update: (dt) => {
            t += dt;
            const q = Math.min(1, t / b.time);
            const x = sx + c.dirX * reach * q;
            const z = sz + c.dirZ * reach * q;
            const y = this.ground(x, z) + 0.4;
            for (let i = 0; i < 10; i++) this.mote(el, x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.5, z + (Math.random() - 0.5) * 0.5, -c.dirX * 2, 0.6, -c.dirZ * 2, 0.06);
            return q < 1;
          },
        });
        break;
      }
    }
  }
}
