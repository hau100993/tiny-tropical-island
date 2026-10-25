import * as THREE from 'three';
import type { SkillFxSink } from '../world/creatures/skillFx';
import type { EmberSink } from '../world/creatures/embers';
import type { SpraySink } from '../water/Spray';
import type { Lightning } from '../world/creatures/lightning';

/** Whose skill: Bọt (water), Hỏa Long (fire), Mầm (grass), Mochi (spark). */
export type Element = 'water' | 'fire' | 'grass' | 'spark';

/** Two skills of different elements this close in time (s) make a combo; not again for `cooldown` s. */
const WINDOW = 1.5;
const COOLDOWN = 6;
/** Starting a skill with another creature this near (m): it joins in this often. */
const JOIN = { reach: 12, chance: 0.3 } as const;

/** The combos, by their pair of elements (sorted), and their name-card keys (vi.creatures.skills). */
export type ComboId = 'steamRainbow' | 'fireBloom' | 'flowerRain' | 'stormColumn' | 'thunderFire' | 'glowMeadow';
const PAIRS: Record<string, ComboId> = {
  'fire+water': 'steamRainbow',
  'fire+grass': 'fireBloom',
  'grass+water': 'flowerRain',
  'spark+water': 'stormColumn',
  'fire+spark': 'thunderFire',
  'grass+spark': 'glowMeadow',
};

/** The combo for two elements (null: the same element). */
export function comboOf(a: Element, b: Element): ComboId | null {
  if (a === b) return null;
  return PAIRS[[a, b].sort().join('+')] ?? null;
}

/** A creature near enough to join in: its element, and a way to start one of its skills. */
export interface Partner {
  element: Element;
  x: number;
  z: number;
  start(): boolean;
}

export interface ComboHost {
  fx: SkillFxSink;
  lightning: Lightning;
  embers: EmberSink;
  steam: EmberSink;
  spores: EmberSink;
  rainbow: EmberSink;
  spray: SpraySink;
  heightAt(x: number, z: number): number;
  bloom(x: number, z: number, n: number): void;
  ripple(x: number, z: number, radius: number, strength: number): void;
  /** Where to set it off: in front of you when you are about (null: between the two). */
  stage(out: THREE.Vector3): THREE.Vector3 | null;
  /** Where the camera is (a rainbow stands facing it). */
  viewer(): { x: number; z: number };
  /** The other creatures within `r` m of (x, z) that could join in (not `except`). */
  partners(x: number, z: number, r: number, except: Element): Partner[];
  card(id: ComboId): void;
}

/** A combo under way: where, which, and its clock (s). */
interface Running {
  id: ComboId;
  x: number;
  y: number;
  z: number;
  t: number;
  /** Things owed per frame (bolts, flowers). */
  next: number;
}

/**
 * Two creatures' skills together: when skills of two different elements start within 1.5 s of
 * each other (two keys pressed one after the other, or one creature joining in another's skill
 * when they stand near), a combo goes off on top of them, with its own name card:
 * - Lửa + Nước, "Prism Steam": a white whirlwind of steam 8 m tall, a big rainbow over it.
 * - Lửa + Cỏ, "Blaze Bloom": a ring of fire that leaves a ring of flowers, petals of flame.
 * - Nước + Cỏ, "Petal Rain": a shower of drops all round and flowers springing up everywhere.
 * - Điện + Nước, "Thunder Spout": a water spout with lightning spiralling up it.
 * - Điện + Lửa, "Firestorm Strike": bolts from the sky, each blowing up in fire.
 * - Điện + Cỏ, "Glowing Meadow": the meadow lights up with glowing pollen, gold and green.
 */
export class Combos {
  private last: { element: Element; x: number; z: number; at: number } | null = null;
  private clock = 0;
  private cool = 0;
  private run: Running | null = null;
  private readonly at = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  constructor(private readonly host: ComboHost) {}

  /**
   * A skill you set off started (`element`, at x, z). Pairs it with one started just before,
   * else now and then calls a neighbour of another element to join in.
   */
  note(element: Element, x: number, z: number): void {
    const prev = this.last;
    this.last = { element, x, z, at: this.clock };
    if (this.run || this.cool > 0) return;
    if (prev && this.clock - prev.at < WINDOW) {
      const id = comboOf(prev.element, element);
      if (id) {
        this.fire(id, (prev.x + x) / 2, (prev.z + z) / 2);
        return;
      }
    }
    if (Math.random() < JOIN.chance) {
      const near = this.host.partners(x, z, JOIN.reach, element);
      if (near.length > 0) near[Math.floor(Math.random() * near.length)].start();
    }
  }

  update(dt: number): void {
    this.clock += dt;
    this.cool -= dt;
    const r = this.run;
    if (!r) return;
    const t0 = r.t;
    r.t += dt;
    this.step(r, t0, dt);
  }

  private fire(id: ComboId, x: number, z: number): void {
    const h = this.host;
    const stage = h.stage(this.at);
    const cx = stage ? stage.x : x;
    const cz = stage ? stage.z : z;
    this.run = { id, x: cx, y: Math.max(0, h.heightAt(cx, cz)), z: cz, t: 0, next: 0 };
    this.cool = COOLDOWN;
    h.card(id);
    h.fx.focus(cx, this.run.y + 2.5, cz, 3.5);
    h.fx.sound('charge', 1, cx, this.run.y, cz);
  }

  /** One frame of the running combo (`t0` → r.t s into it). */
  private step(r: Running, t0: number, dt: number): void {
    const h = this.host;
    const fx = h.fx;
    const { x, y, z } = r;
    const at = (s: number): boolean => t0 < s && r.t >= s;
    switch (r.id) {
      case 'steamRainbow':
        if (at(0.3)) {
          fx.vortex(x, y, z, 0xeaf4ff, 8, 3.2, 3.2);
          fx.flash(x, y + 3, z, 0xffffff, 90, 18, 0.6);
          fx.shock(x, y, z, 'water', 0xdff4ff, 9, 1.3, 1.6);
          fx.shake(x, y, z, 0.35, 0.6);
          fx.sound('whoosh', 1, x, y, z);
          fx.sound('splash', 0.6, x, y, z);
        }
        if (r.t > 0.3 && r.t < 3.3) {
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const hgt = Math.random() * 7;
            const rad = 0.5 + hgt * 0.35;
            h.steam.emit(x + Math.cos(a) * rad, y + hgt, z + Math.sin(a) * rad, -Math.sin(a) * 2, 0.6, Math.cos(a) * 2, 0.4 + Math.random() * 0.4);
          }
          // The rainbow: bands of motes on a half circle 12 m across, filling in, facing you.
          const v = h.viewer();
          const vd = Math.hypot(v.x - x, v.z - z) || 1;
          const px = -(v.z - z) / vd;
          const pz = (v.x - x) / vd;
          for (let i = 0; i < 3; i++) {
            const tt = Math.random() * Math.PI;
            for (let b = 0; b < 7; b++) {
              const rr = 6 + (3 - b) * 0.22;
              h.rainbow.emit(x + px * Math.cos(tt) * rr, y + 0.5 + Math.sin(tt) * rr, z + pz * Math.cos(tt) * rr, 0, 0.2, 0, 0.16 + Math.random() * 0.05, (b / 7) * 0.8);
            }
          }
        }
        break;
      case 'fireBloom':
        if (at(0.2)) {
          fx.flash(x, y + 1, z, 0xff8a3d, 110, 16, 0.7);
          fx.shock(x, y, z, 'fire', 0xff6a20, 7, 1.2, 1.8);
          fx.shock(x, y, z, 'leaf', 0x9cff6a, 9, 1.8, 0.8);
          fx.shake(x, y, z, 0.4, 0.6);
          fx.sound('boom', 0.7, x, y, z);
        }
        if (r.t > 0.2 && r.t < 1.8) {
          // Petals of flame thrown up in a ring, and flowers springing up behind the fire.
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            const rad = 7 * Math.min(1, (r.t - 0.2) / 1.2);
            h.embers.emit(x + Math.cos(a) * rad, y + 0.1, z + Math.sin(a) * rad, Math.cos(a) * 0.5, 1.5 + Math.random() * 2, Math.sin(a) * 0.5, 0.1 + Math.random() * 0.1);
          }
          r.next += dt * 24;
          for (; r.next >= 1; r.next -= 1) {
            const a = Math.random() * Math.PI * 2;
            const rad = Math.max(1, 7 * Math.min(1, (r.t - 0.4) / 1.2)) * (0.8 + Math.random() * 0.3);
            h.bloom(x + Math.cos(a) * rad, z + Math.sin(a) * rad, 1 + Math.floor(Math.random() * 2));
          }
        }
        break;
      case 'flowerRain':
        if (at(0.2)) {
          fx.flash(x, y + 4, z, 0xc8f0ff, 60, 18, 0.8);
          fx.shock(x, y, z, 'leaf', 0x9cff9a, 10, 1.6, 1.2);
          fx.sound('splash', 0.8, x, y, z);
        }
        if (r.t > 0.2 && r.t < 3) {
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2;
            const rad = Math.sqrt(Math.random()) * 9;
            h.spray.drop(x + Math.cos(a) * rad, y + 6 + Math.random() * 2, z + Math.sin(a) * rad, 0, -1, 0, 0.03 + Math.random() * 0.03);
          }
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2;
            const rad = Math.sqrt(Math.random()) * 8;
            h.rainbow.emit(x + Math.cos(a) * rad, y + 2 + Math.random() * 4, z + Math.sin(a) * rad, 0, -0.5, 0, 0.08 + Math.random() * 0.05);
          }
          r.next += dt * 18;
          for (; r.next >= 1; r.next -= 1) {
            const a = Math.random() * Math.PI * 2;
            const rad = Math.sqrt(Math.random()) * 9;
            const fx2 = x + Math.cos(a) * rad;
            const fz2 = z + Math.sin(a) * rad;
            if (h.heightAt(fx2, fz2) > 0.1) h.bloom(fx2, fz2, 1 + Math.floor(Math.random() * 3));
          }
        }
        break;
      case 'stormColumn':
        if (at(0.25)) {
          fx.vortex(x, y, z, 0x7fd8ff, 9, 2.2, 3);
          fx.flash(x, y + 4, z, 0xd0f0ff, 140, 20, 0.5);
          fx.shock(x, y, z, 'water', 0x6fd0ff, 8, 1.3, 2.4);
          fx.shake(x, y, z, 0.5, 0.8);
          fx.sound('splash', 1, x, y, z);
          fx.sound('thunder', 0.8, x, y, z);
        }
        if (r.t > 0.25 && r.t < 3.2) {
          for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2;
            const hgt = Math.random() * 8;
            const rad = 0.4 + hgt * 0.2;
            h.spray.drop(x + Math.cos(a) * rad, y + hgt, z + Math.sin(a) * rad, -Math.sin(a) * 3, 2, Math.cos(a) * 3, 0.03 + Math.random() * 0.04);
          }
          // Lightning spiralling up the spout.
          r.next += dt * 7;
          for (; r.next >= 1; r.next -= 1) {
            const a = r.t * 6 + Math.random();
            const h0 = Math.random() * 6;
            const rad = 0.6 + h0 * 0.2;
            this.from.set(x + Math.cos(a) * rad, y + h0, z + Math.sin(a) * rad);
            this.to.set(x + Math.cos(a + 1.4) * (rad + 0.4), y + h0 + 1.5 + Math.random() * 1.5, z + Math.sin(a + 1.4) * (rad + 0.4));
            h.lightning.strike(this.from, this.to, 0.2, 0.12);
            if (Math.random() < 0.5) fx.sound('zap', 0.3, x, y + h0, z);
          }
        }
        break;
      case 'thunderFire':
        if (at(0.1)) fx.sound('charge', 0.6, x, y, z);
        // Five bolts out of the sky, each blowing up in fire where it lands.
        for (let k = 0; k < 5; k++) {
          if (!at(0.4 + k * 0.4)) continue;
          const a = Math.random() * Math.PI * 2;
          const rad = 1 + Math.random() * 6;
          const bx = x + Math.cos(a) * rad;
          const bz = z + Math.sin(a) * rad;
          const g = Math.max(0, h.heightAt(bx, bz));
          this.from.set(bx + (Math.random() - 0.5) * 4, g + 18, bz + (Math.random() - 0.5) * 4);
          this.to.set(bx, g, bz);
          h.lightning.strike(this.from, this.to, 0.4, 0.35);
          fx.flash(bx, g + 2, bz, 0xffd080, 160, 18, 0.35);
          fx.shock(bx, g, bz, 'fire', 0xff6a20, 3.5, 0.9, 1.6);
          fx.shake(bx, g, bz, 0.45, 0.5);
          fx.sound('thunder', 0.9, bx, g, bz);
          fx.sound('boom', 0.6, bx, g, bz);
          if (g > 0) fx.mark(bx, g, bz, 1.3, 9);
          for (let i = 0; i < 60; i++) {
            const aa = Math.random() * Math.PI * 2;
            const v = 1.5 + Math.random() * 3;
            h.embers.emit(bx, g + 0.2, bz, Math.cos(aa) * v, 1 + Math.random() * 3, Math.sin(aa) * v, 0.08 + Math.random() * 0.1);
          }
          if (h.heightAt(bx, bz) < 0) h.ripple(bx, bz, 1.5, -0.8);
        }
        break;
      case 'glowMeadow':
        if (at(0.2)) {
          fx.flash(x, y + 1.5, z, 0xd8ff7a, 80, 16, 1);
          fx.shock(x, y, z, 'spark', 0xe8ff80, 9, 1.2, 0.6);
          fx.shock(x, y, z, 'leaf', 0x9cff6a, 10, 1.8, 1);
          fx.sound('zap', 0.6, x, y, z);
          fx.sound('whoosh', 0.7, x, y, z);
        }
        if (r.t > 0.2 && r.t < 3) {
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const rad = Math.sqrt(Math.random()) * 9;
            h.spores.emit(x + Math.cos(a) * rad, y + 0.1 + Math.random() * 0.5, z + Math.sin(a) * rad, 0, 0.6 + Math.random() * 0.8, 0, 0.06 + Math.random() * 0.06);
          }
          // Little arcs jumping between the grass tips.
          r.next += dt * 6;
          for (; r.next >= 1; r.next -= 1) {
            const a = Math.random() * Math.PI * 2;
            const rad = Math.random() * 7;
            this.from.set(x + Math.cos(a) * rad, y + 0.2, z + Math.sin(a) * rad);
            this.to.set(this.from.x + (Math.random() - 0.5) * 2, y + 0.3 + Math.random() * 0.8, this.from.z + (Math.random() - 0.5) * 2);
            h.lightning.strike(this.from, this.to, 0.15, 0.08);
          }
        }
        break;
    }
    if (r.t > 3.6) this.run = null;
  }
}
