import type { SkillFxSink, ShockStyle } from '../creatures/skillFx';
import type { EmberSink } from '../creatures/embers';
import type { SpraySink } from '../../water/Spray';
import type { BubbleSink } from '../creatures/airBubbles';
import type { PetElement } from '../../pets/species';
import { ELEMENT_COLOR } from './looks';
import { SkillShapes, type DomeStyle, type ShapeKind, type SigilPattern } from './skillShapes';

/**
 * Skills made from a recipe: a few timed beats (gather, burst, a shot, a shower, a whirlwind, a
 * halo, a leap, a beam, lightning, a sword from the sky, a sigil on the ground, a shield dome, a
 * swarm, a rain of shapes …) built from the shared skill effects (flash, shock wave, shake,
 * sounds: SkillFx), the particle pools (sparks, steam, pollen, seeds, rainbow motes, water drops,
 * bubbles) and the shader shapes (SkillShapes), in the element's colours or the skill's own
 * (SKILL_LOOK). Every Level 2 skill of the originals and all the egg species' skills are
 * recipes; the originals' first three are their own hand-made code.
 *
 * Tiers: skills 1–3 are short (≤ 1.5 s), 4–5 bigger, the sixth an ultimate (the camera widens
 * toward it, a big flash, several layers).
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

/** Moves the caster itself: a leap to (x, z) in `time` s, `height` m high at the top. */
export type LeapFn = (x: number, z: number, time: number, height: number) => void;

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
  | { at: number; kind: 'dash'; reach: number; time: number }
  // The caster really jumps or lunges (new pets; the originals keep their own moves), a trail behind.
  | { at: number; kind: 'leap'; reach: number; time: number; height: number }
  // A straight beam ahead at chest height; `retract`: shoots out and back (a tongue).
  | { at: number; kind: 'beam'; reach: number; time: number; radius: number; retract?: boolean }
  // Lightning from the sky `reach` m ahead (spread round it).
  | { at: number; kind: 'bolt'; reach: number; count: number; every: number; spread: number }
  // A giant blade slides down from the sky into the ground `reach` m ahead.
  | { at: number; kind: 'blade'; reach: number; length: number; time: number; impact: number }
  // A glowing pattern on the ground (at the caster, or `reach` m ahead).
  | { at: number; kind: 'sigil'; pattern: SigilPattern; radius: number; time: number; reach?: number }
  // A shield dome over the caster, popping at the end.
  | { at: number; kind: 'dome'; style: DomeStyle; radius: number; time: number }
  // Motes (or shapes) circling the caster, then flung out.
  | { at: number; kind: 'swarm'; count: number; radius: number; time: number; height: number; shape?: ShapeKind }
  // A rain of shapes over a spot `reach` m ahead; `drift`: carried forward (a breeze).
  | { at: number; kind: 'shapes'; shape: ShapeKind; reach: number; radius: number; time: number; rate: number; height?: number; drift?: number; tints?: readonly number[] }
  // A rainbow arching over a spot `reach` m ahead.
  | { at: number; kind: 'rainbow'; reach: number; radius: number }
  // A roar: a cone of the element ahead and shock rings along it.
  | { at: number; kind: 'cone'; reach: number; angle: number }
  // Claw slashes: arcs of the element just ahead.
  | { at: number; kind: 'slash'; count: number; radius: number; every: number }
  // Sound rings: flat shock rings one after another.
  | { at: number; kind: 'rings'; count: number; radius: number; every: number };

/** A skill's own colours: the flash and sigil colour, and the motes' hue ranges (rainbow motes). */
interface SkillLook {
  color?: number;
  hues?: ReadonlyArray<readonly [number, number]>;
  ultimate?: boolean;
}

const GOLD_JADE = { color: 0xffc94a, hues: [[0.11, 0.15], [0.38, 0.45]] } as const;
const PUMPKIN = { color: 0xff7a1a, hues: [[0.05, 0.09], [0.75, 0.82]] } as const;
const HONEY = { color: 0xffc21a, hues: [[0.1, 0.15]] } as const;
const GOLDEN_WOODS = { color: 0xffd25a, hues: [[0.12, 0.16], [0.25, 0.32]] } as const;

const SKILL_LOOK: Readonly<Record<string, SkillLook>> = {
  // Ultimates (the sixth skill of each).
  'Storm Halo': { ultimate: true },
  'Coral Rain': { ultimate: true },
  'Ring of Fire': { ultimate: true },
  'Pollen Comet': { ultimate: true },
  'Rainbow Spout': { ultimate: true },
  'Spirit of the Woods': { ...GOLDEN_WOODS, ultimate: true },
  'Harvest Feast': { ultimate: true },
  'Monsoon Call': { ultimate: true },
  "King's Roar": { ultimate: true },
  'Thunder Hive': { ...HONEY, ultimate: true },
  'Galaxy Storm': { ultimate: true },
  'Ocean Heart': { ultimate: true },
  'Sunfire Nova': { ultimate: true },
  'Haunted Night': { ...PUMPKIN, ultimate: true },
  'Thuận Thiên Light': { ...GOLD_JADE, ultimate: true },
  // Own colours.
  'Golden Leap': GOLDEN_WOODS,
  'Meadow Breeze': GOLDEN_WOODS,
  'Antler Bloom': GOLDEN_WOODS,
  'Sunlit Stampede': GOLDEN_WOODS,
  'Sweet Scent': { color: 0xff8fc8, hues: [[0.9, 0.97]] },
  'Honey Rain': HONEY,
  'Tongue Snap': { color: 0xff6f91 },
  'Buzz Sting': HONEY,
  'Pollen Spark': HONEY,
  'Honey Zap': HONEY,
  'Swarm Dance': HONEY,
  'Honey Fountain': HONEY,
  'Web Shot': { color: 0xe8e4ff, hues: [[0.72, 0.8]] },
  'Night Weave': { color: 0xd8c8ff, hues: [[0.72, 0.8]] },
  'Pumpkin Hex': PUMPKIN,
  'Silk Moon': { color: 0xe8e4ff, hues: [[0.6, 0.7]] },
  'Lantern Web': PUMPKIN,
  'Golden Shell': GOLD_JADE,
  'Lake Ripple': GOLD_JADE,
  'Ancient Script': GOLD_JADE,
  'Jade Wave': { color: 0x5fe0a8, hues: [[0.38, 0.46]] },
  "Heaven's Blade": GOLD_JADE,
};

/** Each recipe skill by its (English) name. */
const RECIPES: Readonly<Record<string, readonly Beat[]>> = {
  // ---- Mochi, Level 2 (spark) ----
  'Comet Dash': [
    { at: 0, kind: 'gather', time: 0.4, radius: 1.2 },
    { at: 0.4, kind: 'leap', reach: 8, time: 0.6, height: 1.2 },
    { at: 1.0, kind: 'burst', radius: 4, size: 1 },
    { at: 1.0, kind: 'shapes', shape: 'star', reach: 8, radius: 2, time: 0.4, rate: 40, height: 2, tints: [0xfff2a0] },
  ],
  'Thunder Howl': [
    { at: 0, kind: 'gather', time: 0.5, radius: 2 },
    { at: 0.5, kind: 'rings', count: 3, radius: 6, every: 0.15 },
    { at: 0.6, kind: 'bolt', reach: 3, count: 5, every: 0.12, spread: 3 },
  ],
  'Storm Halo': [
    { at: 0, kind: 'halo', radius: 1.6, time: 2.4 },
    { at: 0, kind: 'sigil', pattern: 'sun', radius: 3.5, time: 2.6 },
    { at: 0.4, kind: 'bolt', reach: 0, count: 6, every: 0.3, spread: 3.5 },
    { at: 2.2, kind: 'nova', radius: 5, wall: 1 },
  ],
  // ---- Bọt, Level 2 (water) ----
  'Tidal Crash': [
    { at: 0, kind: 'gather', time: 0.5, radius: 2 },
    { at: 0.5, kind: 'nova', radius: 8, wall: 2.2 },
    { at: 0.6, kind: 'shower', reach: 0, radius: 4, time: 1.2, rate: 160 },
  ],
  'Bubble Dome': [
    { at: 0, kind: 'dome', style: 'bubble', radius: 2.4, time: 2.6 },
    { at: 0.2, kind: 'fountain', height: 2.5, time: 1.6 },
    { at: 2.5, kind: 'burst', radius: 3, size: 1 },
  ],
  'Coral Rain': [
    { at: 0, kind: 'fountain', height: 5, time: 0.6 },
    { at: 0.6, kind: 'shower', reach: 4, radius: 3.5, time: 2, rate: 120 },
    { at: 0.8, kind: 'rainbow', reach: 4, radius: 3.5 },
    { at: 1.2, kind: 'bloom', radius: 3, count: 8 },
  ],
  // ---- Hỏa Long, Level 2 (fire) ----
  'Solar Flare': [
    { at: 0, kind: 'sigil', pattern: 'sun', radius: 4, time: 2 },
    { at: 0, kind: 'gather', time: 0.8, radius: 2.5 },
    { at: 0.8, kind: 'nova', radius: 9, wall: 2 },
    { at: 0.8, kind: 'burst', radius: 5, size: 1.4 },
  ],
  'Phoenix Dive': [
    { at: 0, kind: 'leap', reach: 10, time: 0.8, height: 3 },
    { at: 0.8, kind: 'burst', radius: 5, size: 1.2 },
    { at: 0.8, kind: 'sigil', pattern: 'sun', radius: 3, time: 1.5, reach: 10 },
    { at: 0.9, kind: 'whirl', height: 5, time: 1.4 },
  ],
  'Ring of Fire': [
    { at: 0, kind: 'halo', radius: 2, time: 2.2 },
    { at: 0, kind: 'sigil', pattern: 'sun', radius: 4.5, time: 2.4 },
    { at: 0.2, kind: 'ring', radius: 4, count: 10, every: 0.12 },
  ],
  // ---- Mầm, Level 2 (grass) ----
  'Bloom Wave': [
    { at: 0, kind: 'gather', time: 0.5, radius: 1.5 },
    { at: 0.5, kind: 'nova', radius: 7, wall: 0.8 },
    { at: 0.5, kind: 'sigil', pattern: 'leaves', radius: 5, time: 1.8 },
    { at: 0.6, kind: 'bloom', radius: 6, count: 16 },
  ],
  'Vine Spiral': [
    { at: 0, kind: 'whirl', height: 4, time: 2 },
    { at: 0, kind: 'swarm', count: 10, radius: 2, time: 2, height: 3, shape: 'leaf' },
    { at: 1.6, kind: 'bloom', radius: 3, count: 8 },
  ],
  'Pollen Comet': [
    { at: 0, kind: 'gather', time: 0.4, radius: 1 },
    { at: 0.4, kind: 'shot', reach: 10, speed: 12, size: 1.2 },
    { at: 1.3, kind: 'sigil', pattern: 'leaves', radius: 2.5, time: 1.5, reach: 10 },
    { at: 1.3, kind: 'bloom', radius: 2.5, count: 10 },
  ],
  // ---- Bé Mập, Level 2 (water) ----
  'Tsunami Leap': [
    { at: 0, kind: 'leap', reach: 3, time: 0.6, height: 2 },
    { at: 0, kind: 'fountain', height: 3, time: 0.5 },
    { at: 0.6, kind: 'nova', radius: 9, wall: 2.5 },
  ],
  'Deep Vortex': [
    { at: 0, kind: 'whirl', height: 3, time: 2.2 },
    { at: 0, kind: 'rings', count: 4, radius: 3, every: 0.4 },
    { at: 0.2, kind: 'halo', radius: 2.5, time: 2 },
  ],
  'Rainbow Spout': [
    { at: 0, kind: 'fountain', height: 6, time: 1.6 },
    { at: 0.6, kind: 'rainbow', reach: 0, radius: 4 },
    { at: 0.8, kind: 'shower', reach: 0, radius: 3, time: 1.4, rate: 90 },
  ],
  // ---- Nai Vàng (grass, golden) ----
  'Golden Leap': [
    { at: 0, kind: 'leap', reach: 4, time: 0.45, height: 1.2 },
    { at: 0.45, kind: 'burst', radius: 2, size: 0.7 },
  ],
  'Meadow Breeze': [
    { at: 0, kind: 'cone', reach: 5, angle: 0.5 },
    { at: 0, kind: 'shapes', shape: 'leaf', reach: 0, radius: 1, time: 1.2, rate: 40, height: 1, drift: 5, tints: [0xe8c34a, 0xd9a032, 0x9ccf4a] },
  ],
  'Forest Call': [
    { at: 0, kind: 'gather', time: 0.5, radius: 1.5 },
    { at: 0.5, kind: 'rings', count: 3, radius: 3, every: 0.15 },
    { at: 1.0, kind: 'bloom', radius: 2.5, count: 8 },
  ],
  'Antler Bloom': [
    { at: 0, kind: 'fountain', height: 3, time: 0.8 },
    { at: 0.3, kind: 'shapes', shape: 'leaf', reach: 0, radius: 2, time: 0.8, rate: 30, height: 3, tints: [0xff9ccf, 0xffd6ea] },
    { at: 0.5, kind: 'bloom', radius: 3.5, count: 12 },
  ],
  'Sunlit Stampede': [
    { at: 0, kind: 'leap', reach: 8, time: 0.7, height: 0.6 },
    { at: 0.05, kind: 'dash', reach: 8, time: 0.7 },
    { at: 0.15, kind: 'dash', reach: 7, time: 0.7 },
    { at: 0.8, kind: 'nova', radius: 5, wall: 0.8 },
  ],
  'Spirit of the Woods': [
    { at: 0, kind: 'sigil', pattern: 'leaves', radius: 6, time: 3 },
    { at: 0, kind: 'gather', time: 0.9, radius: 3 },
    { at: 0.9, kind: 'fountain', height: 6, time: 1.4 },
    { at: 0.9, kind: 'whirl', height: 5, time: 1.6 },
    { at: 1.0, kind: 'shapes', shape: 'leaf', reach: 0, radius: 4, time: 1.5, rate: 50, height: 6, tints: [0xe8c34a, 0xffe08a, 0x9ccf4a] },
    { at: 1.1, kind: 'nova', radius: 8, wall: 1.4 },
    { at: 1.3, kind: 'bloom', radius: 7, count: 22 },
  ],
  // ---- Bé Na (grass) ----
  'Seed Pop': [
    { at: 0, kind: 'shot', reach: 4, speed: 9, size: 0.5 },
    { at: 0.15, kind: 'shot', reach: 5, speed: 9, size: 0.5 },
  ],
  'Sweet Scent': [
    { at: 0, kind: 'halo', radius: 1.4, time: 1.8 },
    { at: 0, kind: 'rings', count: 3, radius: 1.8, every: 0.35 },
  ],
  'Rolling Fruit': [
    { at: 0, kind: 'leap', reach: 6, time: 0.8, height: 0.3 },
    { at: 0, kind: 'dash', reach: 6, time: 0.8 },
    { at: 0.8, kind: 'burst', radius: 2.5, size: 0.8 },
  ],
  'Ripe Burst': [
    { at: 0, kind: 'gather', time: 0.5, radius: 1.5 },
    { at: 0.5, kind: 'burst', radius: 3.5, size: 1.1 },
    { at: 0.5, kind: 'shapes', shape: 'fruit', reach: 0, radius: 1, time: 0.25, rate: 40, height: 1.2, tints: [0x9fd65a, 0xc8e26a] },
    { at: 0.6, kind: 'bloom', radius: 2.5, count: 8 },
  ],
  'Honey Rain': [
    { at: 0, kind: 'fountain', height: 4, time: 0.5 },
    { at: 0.5, kind: 'sigil', pattern: 'hive', radius: 3, time: 2, reach: 2 },
    { at: 0.5, kind: 'shower', reach: 2, radius: 3, time: 1.8, rate: 100 },
  ],
  'Harvest Feast': [
    { at: 0, kind: 'halo', radius: 2.2, time: 1.6 },
    { at: 0.3, kind: 'shapes', shape: 'fruit', reach: 0, radius: 3.5, time: 2, rate: 30, height: 6, tints: [0x9fd65a, 0xff8a3d, 0xffd34d, 0xe8445a] },
    { at: 1.2, kind: 'nova', radius: 7, wall: 1 },
    { at: 1.3, kind: 'bloom', radius: 6, count: 18 },
  ],
  // ---- Ếch Xanh (water) ----
  'Lily Hop': [
    { at: 0, kind: 'leap', reach: 3, time: 0.5, height: 1.2 },
    { at: 0.5, kind: 'sigil', pattern: 'lotus', radius: 1.6, time: 1.2, reach: 3 },
    { at: 0.5, kind: 'burst', radius: 2, size: 0.6 },
  ],
  'Tongue Snap': [{ at: 0, kind: 'beam', reach: 5, time: 0.45, radius: 0.06, retract: true }],
  'Croak Wave': [
    { at: 0, kind: 'gather', time: 0.3, radius: 1 },
    { at: 0.3, kind: 'rings', count: 3, radius: 4.5, every: 0.12 },
  ],
  'Rain Song': [
    { at: 0, kind: 'halo', radius: 1.6, time: 0.8 },
    { at: 0.6, kind: 'shower', reach: 0, radius: 3.5, time: 2, rate: 130 },
    { at: 0.8, kind: 'rings', count: 4, radius: 1.5, every: 0.4 },
  ],
  'Lotus Shield': [
    { at: 0, kind: 'sigil', pattern: 'lotus', radius: 2.4, time: 2.4 },
    { at: 0.1, kind: 'dome', style: 'bubble', radius: 2, time: 2.2 },
    { at: 0.3, kind: 'bloom', radius: 2, count: 8 },
  ],
  'Monsoon Call': [
    { at: 0, kind: 'gather', time: 0.8, radius: 2.5 },
    { at: 0.8, kind: 'shower', reach: 2, radius: 5, time: 2.4, rate: 220 },
    { at: 1.0, kind: 'nova', radius: 8, wall: 1.8 },
    { at: 1.0, kind: 'bolt', reach: 2, count: 3, every: 0.5, spread: 4 },
  ],
  // ---- Hổ Báo (fire) ----
  Pounce: [
    { at: 0, kind: 'leap', reach: 4, time: 0.4, height: 1 },
    { at: 0.4, kind: 'burst', radius: 2, size: 0.8 },
    { at: 0.4, kind: 'slash', count: 1, radius: 1.2, every: 0 },
  ],
  'Tiger Roar': [
    { at: 0, kind: 'cone', reach: 6, angle: 0.6 },
    { at: 0, kind: 'rings', count: 2, radius: 3, every: 0.15 },
  ],
  'Blaze Claw': [{ at: 0, kind: 'slash', count: 3, radius: 1.4, every: 0.12 }],
  'Inferno Dash': [
    { at: 0, kind: 'leap', reach: 10, time: 0.7, height: 0.4 },
    { at: 0, kind: 'dash', reach: 10, time: 0.7 },
    { at: 0.7, kind: 'burst', radius: 4, size: 1.2 },
  ],
  'Burning Stripes': [
    { at: 0, kind: 'halo', radius: 1.8, time: 1.6 },
    { at: 0, kind: 'sigil', pattern: 'sun', radius: 3.5, time: 1.8 },
    { at: 0.3, kind: 'ring', radius: 3.5, count: 8, every: 0.12 },
  ],
  "King's Roar": [
    { at: 0, kind: 'gather', time: 0.8, radius: 2.5 },
    { at: 0.8, kind: 'cone', reach: 10, angle: 0.7 },
    { at: 0.8, kind: 'nova', radius: 10, wall: 2.2 },
    { at: 0.9, kind: 'meteors', reach: 4, count: 4, every: 0.2 },
  ],
  // ---- Ong Vàng (spark, honey) ----
  'Buzz Sting': [{ at: 0, kind: 'beam', reach: 5, time: 0.35, radius: 0.05 }],
  'Pollen Spark': [
    { at: 0, kind: 'burst', radius: 2, size: 0.6 },
    { at: 0, kind: 'shapes', shape: 'star', reach: 0, radius: 1.5, time: 0.4, rate: 30, height: 2, tints: [0xffe066] },
  ],
  'Honey Zap': [
    { at: 0, kind: 'gather', time: 0.4, radius: 1.2 },
    { at: 0.4, kind: 'bolt', reach: 4, count: 1, every: 0, spread: 0 },
  ],
  'Swarm Dance': [
    { at: 0, kind: 'swarm', count: 12, radius: 2, time: 1.8, height: 1.5 },
    { at: 0.9, kind: 'ring', radius: 2.5, count: 6, every: 0.1 },
  ],
  'Honey Fountain': [
    { at: 0, kind: 'fountain', height: 3, time: 1 },
    { at: 0.3, kind: 'sigil', pattern: 'hive', radius: 2.5, time: 1.6 },
    { at: 0.6, kind: 'shower', reach: 0, radius: 2.5, time: 1.2, rate: 80 },
  ],
  'Thunder Hive': [
    { at: 0, kind: 'sigil', pattern: 'hive', radius: 5, time: 2.6 },
    { at: 0, kind: 'gather', time: 0.7, radius: 2 },
    { at: 0.7, kind: 'bolt', reach: 3, count: 6, every: 0.15, spread: 3.5 },
    { at: 1.6, kind: 'nova', radius: 7, wall: 1.5 },
  ],
  // ---- Rồng Mây (moon) ----
  'Cloud Puff': [
    { at: 0, kind: 'burst', radius: 2.2, size: 0.7 },
    { at: 0.1, kind: 'halo', radius: 1.2, time: 0.8 },
  ],
  'Moon Breath': [{ at: 0, kind: 'beam', reach: 7, time: 0.8, radius: 0.25 }],
  'Star Glide': [
    { at: 0, kind: 'leap', reach: 7, time: 0.6, height: 0.8 },
    { at: 0, kind: 'shapes', shape: 'star', reach: 3.5, radius: 3, time: 0.6, rate: 50, height: 1.2, tints: [0xcfe0ff, 0xfff2c0] },
  ],
  'Nebula Wings': [
    { at: 0, kind: 'whirl', height: 4, time: 1.6 },
    { at: 0, kind: 'swarm', count: 10, radius: 2.5, time: 1.6, height: 2.5, shape: 'star' },
    { at: 0.2, kind: 'halo', radius: 2.2, time: 1.6 },
  ],
  'Lunar Roar': [
    { at: 0, kind: 'sigil', pattern: 'crescent', radius: 4, time: 2 },
    { at: 0, kind: 'gather', time: 0.6, radius: 2 },
    { at: 0.6, kind: 'nova', radius: 8, wall: 1.8 },
  ],
  'Galaxy Storm': [
    { at: 0, kind: 'sigil', pattern: 'crescent', radius: 6, time: 3 },
    { at: 0, kind: 'gather', time: 0.8, radius: 3 },
    { at: 0.8, kind: 'whirl', height: 6, time: 2 },
    { at: 0.8, kind: 'shapes', shape: 'star', reach: 5, radius: 4, time: 1.6, rate: 40, height: 8, tints: [0xcfe0ff, 0xfff2c0, 0xd8b8ff] },
    { at: 0.8, kind: 'meteors', reach: 5, count: 8, every: 0.15 },
    { at: 2.1, kind: 'nova', radius: 9, wall: 2 },
  ],
  // ---- Cá Ngựa (seahorse, water) ----
  'Splash Dash': [
    { at: 0, kind: 'leap', reach: 5, time: 0.5, height: 0.8 },
    { at: 0.5, kind: 'burst', radius: 2, size: 0.7 },
  ],
  'Bubble Ring': [
    { at: 0, kind: 'ring', radius: 2.2, count: 6, every: 0.1 },
    { at: 0.1, kind: 'fountain', height: 1.5, time: 0.8 },
  ],
  'Tide Spin': [
    { at: 0, kind: 'whirl', height: 2.5, time: 1.4 },
    { at: 0.2, kind: 'rings', count: 3, radius: 2.5, every: 0.3 },
  ],
  'Wave Crown': [
    { at: 0, kind: 'ring', radius: 2.5, count: 8, every: 0.06 },
    { at: 0, kind: 'fountain', height: 3.5, time: 1 },
    { at: 0.8, kind: 'nova', radius: 6, wall: 1.2 },
  ],
  'Deep Pulse': [
    { at: 0, kind: 'gather', time: 0.6, radius: 2 },
    { at: 0.6, kind: 'rings', count: 3, radius: 7, every: 0.15 },
    { at: 0.6, kind: 'nova', radius: 7, wall: 1.5 },
  ],
  'Ocean Heart': [
    { at: 0, kind: 'dome', style: 'bubble', radius: 2.6, time: 2 },
    { at: 0.6, kind: 'shower', reach: 0, radius: 3.5, time: 1.6, rate: 140 },
    { at: 1.6, kind: 'rainbow', reach: 0, radius: 4 },
    { at: 2, kind: 'burst', radius: 4, size: 1.2 },
  ],
  // ---- Chồn Lửa (kind 8, fire) ----
  'Flame Hop': [
    { at: 0, kind: 'leap', reach: 2.5, time: 0.4, height: 1.3 },
    { at: 0.4, kind: 'burst', radius: 1.8, size: 0.6 },
  ],
  'Ember Twirl': [
    { at: 0, kind: 'whirl', height: 2.2, time: 1.2 },
    { at: 0, kind: 'swarm', count: 8, radius: 1.2, time: 1.2, height: 1.5 },
  ],
  'Flame Burst': [
    { at: 0, kind: 'gather', time: 0.4, radius: 1.2 },
    { at: 0.4, kind: 'burst', radius: 3, size: 1 },
    { at: 0.4, kind: 'sigil', pattern: 'sun', radius: 2.5, time: 1 },
  ],
  'Sun Crown': [
    { at: 0, kind: 'halo', radius: 1.8, time: 1.6 },
    { at: 0, kind: 'sigil', pattern: 'sun', radius: 2, time: 1.8 },
    { at: 1.2, kind: 'fountain', height: 4, time: 0.8 },
  ],
  'Blaze Spiral': [
    { at: 0, kind: 'whirl', height: 4.5, time: 1.6 },
    { at: 0.4, kind: 'ring', radius: 3.5, count: 8, every: 0.12 },
  ],
  'Sunfire Nova': [
    { at: 0, kind: 'gather', time: 0.9, radius: 2.5 },
    { at: 0.9, kind: 'fountain', height: 7, time: 1 },
    { at: 0.9, kind: 'rings', count: 3, radius: 6, every: 0.12 },
    { at: 1.0, kind: 'nova', radius: 9, wall: 2 },
  ],
  // ---- Nhện Halloween (moon, pumpkin colours) ----
  'Web Shot': [
    { at: 0, kind: 'beam', reach: 6, time: 0.5, radius: 0.04 },
    { at: 0.35, kind: 'sigil', pattern: 'web', radius: 1.8, time: 2, reach: 6 },
  ],
  'Night Weave': [
    { at: 0, kind: 'sigil', pattern: 'web', radius: 3.5, time: 2.4 },
    { at: 0.2, kind: 'ring', radius: 2.5, count: 8, every: 0.08 },
  ],
  'Pumpkin Hex': [
    { at: 0, kind: 'gather', time: 0.5, radius: 1.5 },
    { at: 0.5, kind: 'burst', radius: 3, size: 1 },
    { at: 0.5, kind: 'shapes', shape: 'pumpkin', reach: 0, radius: 0.6, time: 0.3, rate: 30, height: 1.5 },
    { at: 0.6, kind: 'halo', radius: 1.5, time: 1 },
  ],
  'Silk Moon': [
    { at: 0, kind: 'sigil', pattern: 'crescent', radius: 2.5, time: 2 },
    { at: 0, kind: 'fountain', height: 4, time: 1 },
    { at: 0.8, kind: 'shower', reach: 0, radius: 3, time: 1.4, rate: 90 },
  ],
  'Lantern Web': [
    { at: 0, kind: 'sigil', pattern: 'web', radius: 4, time: 2.6 },
    { at: 0.2, kind: 'shapes', shape: 'pumpkin', reach: 0, radius: 3.5, time: 1, rate: 12, height: 3 },
    { at: 1.1, kind: 'nova', radius: 5, wall: 1 },
  ],
  'Haunted Night': [
    { at: 0, kind: 'gather', time: 0.8, radius: 3 },
    { at: 0.3, kind: 'swarm', count: 12, radius: 2.5, time: 2.4, height: 2, shape: 'bat' },
    { at: 0.8, kind: 'whirl', height: 5, time: 1.6 },
    { at: 1.0, kind: 'shapes', shape: 'pumpkin', reach: 3, radius: 3.5, time: 1.2, rate: 15, height: 6 },
    { at: 1.0, kind: 'meteors', reach: 4, count: 5, every: 0.2 },
  ],
  // ---- Kim Quy (water, legendary; gold and jade) ----
  'Golden Shell': [
    { at: 0, kind: 'dome', style: 'shell', radius: 1.8, time: 2.2 },
    { at: 0, kind: 'sigil', pattern: 'hive', radius: 2, time: 2.2 },
  ],
  'Lake Ripple': [
    { at: 0, kind: 'sigil', pattern: 'lotus', radius: 2.5, time: 1.6 },
    { at: 0, kind: 'rings', count: 4, radius: 3, every: 0.2 },
    { at: 0.9, kind: 'nova', radius: 5, wall: 0.8 },
  ],
  'Ancient Script': [
    { at: 0, kind: 'sigil', pattern: 'trigrams', radius: 3.5, time: 2.6 },
    { at: 0, kind: 'gather', time: 1, radius: 3 },
    { at: 1, kind: 'burst', radius: 4, size: 1.2 },
    { at: 1.1, kind: 'fountain', height: 4, time: 1 },
  ],
  'Jade Wave': [
    { at: 0, kind: 'gather', time: 0.6, radius: 2 },
    { at: 0.6, kind: 'nova', radius: 10, wall: 2.6 },
    { at: 0.6, kind: 'rings', count: 2, radius: 8, every: 0.2 },
  ],
  "Heaven's Blade": [
    { at: 0, kind: 'gather', time: 0.8, radius: 2 },
    { at: 0.5, kind: 'blade', reach: 4, length: 5, time: 2.2, impact: 6 },
    { at: 1.3, kind: 'sigil', pattern: 'trigrams', radius: 3, time: 1.6, reach: 4 },
  ],
  'Thuận Thiên Light': [
    { at: 0, kind: 'sigil', pattern: 'trigrams', radius: 6, time: 3.4 },
    { at: 0, kind: 'gather', time: 1.2, radius: 3.5 },
    { at: 0.6, kind: 'blade', reach: 2.5, length: 8, time: 2.6, impact: 10 },
    { at: 1.2, kind: 'fountain', height: 8, time: 1.4 },
    { at: 1.7, kind: 'nova', radius: 12, wall: 3 },
    { at: 1.8, kind: 'burst', radius: 6, size: 1.6 },
  ],
};

export function hasRecipe(skill: string): boolean {
  return Object.prototype.hasOwnProperty.call(RECIPES, skill);
}

/** Is it the species' ultimate (the camera frames it)? */
export function isUltimate(skill: string): boolean {
  return SKILL_LOOK[skill]?.ultimate === true;
}

/** How long a recipe runs (s), for "busy" checks. */
export function recipeLength(skill: string): number {
  let end = 0;
  for (const b of RECIPES[skill] ?? []) {
    let len: number;
    if ('time' in b) len = b.time;
    else if (b.kind === 'meteors' || b.kind === 'ring' || b.kind === 'bolt' || b.kind === 'rings' || b.kind === 'slash') len = b.count * b.every + 0.6;
    else if (b.kind === 'shot') len = b.reach / b.speed;
    else if (b.kind === 'rainbow') len = 1.6;
    else len = 0.5;
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
  look: SkillLook;
  leap?: LeapFn;
  /** Where the skill aims: fixed at the start, `reach` m ahead along this direction. */
  dirX: number;
  dirZ: number;
}

export class RecipeRunner {
  /** The shader shapes (beams, sigils, domes, shape rain): its group goes in the scene. */
  readonly shapes: SkillShapes;
  private readonly casts: Cast[] = [];
  private readonly running: Running[] = [];

  constructor(private readonly host: RecipeHost) {
    this.shapes = new SkillShapes(host.heightAt);
  }

  /**
   * Starts a recipe skill from `caster` (read live while it runs); false if unknown. `leap`
   * lets the skill move the caster (a new pet); without it a leap is only its trail.
   */
  cast(skill: string, caster: Caster, element: PetElement, power: number, leap?: LeapFn): boolean {
    const beats = RECIPES[skill];
    if (!beats) return false;
    const look = SKILL_LOOK[skill] ?? {};
    this.casts.push({ beats, next: 0, t: 0, caster, element, power, look, leap, dirX: Math.sin(caster.yaw), dirZ: Math.cos(caster.yaw) });
    if (look.ultimate) {
      // The ultimate: the view widens toward it for the whole skill, a flash to open it.
      const y = this.ground(caster.x, caster.z);
      this.host.fx.focus(caster.x, y + 1, caster.z, recipeLength(skill));
      this.host.fx.flash(caster.x, y + 1.5, caster.z, look.color ?? ELEMENT_COLOR[element], 120 * power, 10 * power, 0.5);
    }
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
    this.shapes.update(dt);
  }

  // ---- Particles by element ----

  /** One mote of the cast's colours at (x, y, z) moving (vx, vy, vz). */
  private mote(c: Cast, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const p = this.host.pools;
    const hues = c.look.hues;
    if (hues) {
      const [h0, h1] = hues[Math.floor(Math.random() * hues.length)];
      p.rainbow.emit(x, y, z, vx, vy, vz, size, h0 + Math.random() * (h1 - h0));
      return;
    }
    switch (c.element) {
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

  private colorOf(c: Cast): number {
    return c.look.color ?? ELEMENT_COLOR[c.element];
  }

  private beat(c: Cast, b: Beat): void {
    const { fx } = this.host;
    const el = c.element;
    const color = this.colorOf(c);
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
              this.mote(c, sx, sy, sz, (at.x - sx) * s, (at.y + 0.3 - sy) * s, (at.z - sz) * s, 0.04);
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
          this.mote(c, at.x, y + 0.4, at.z, Math.cos(a) * s * v, Math.abs(cz) * v + 0.8, Math.sin(a) * s * v, 0.04 + Math.random() * 0.04);
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
          this.mote(c, at.x, y + 0.2, at.z, Math.cos(a) * v, 0.6 + Math.random() * 1.2, Math.sin(a) * v, 0.05);
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
            for (let i = 0; i < 6; i++) this.mote(c, x, y, z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.06 * b.size);
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
              this.mote(c, x, this.ground(x, z) + 3 + Math.random(), z, 0, -2.5 - Math.random() * 2, 0, 0.04);
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
              this.mote(c, at.x + Math.cos(a) * rr, y + h, at.z + Math.sin(a) * rr, -Math.sin(a) * 3, 1.2, Math.cos(a) * 3, 0.045);
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
              this.mote(c, at.x, this.ground(at.x, at.z) + 0.3, at.z, Math.cos(a) * s, v * (0.8 + Math.random() * 0.25), Math.sin(a) * s, 0.05);
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
              this.mote(c, at.x + Math.cos(a) * r, at.y + 0.4 + Math.sin(t * 2 + i) * 0.25, at.z + Math.sin(a) * r, -Math.sin(a) * 0.5, 0.2, Math.cos(a) * 0.5, 0.05);
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
              for (let j = 0; j < 5; j++) this.mote(c, m.x + (Math.random() - 0.5) * 0.3, m.y + Math.random() * 0.6, m.z + (Math.random() - 0.5) * 0.3, 0, 2, 0, 0.07);
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
            for (let i = 0; i < 10; i++) this.mote(c, x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.5, z + (Math.random() - 0.5) * 0.5, -c.dirX * 2, 0.6, -c.dirZ * 2, 0.06);
            return q < 1;
          },
        });
        break;
      }
      case 'leap': {
        // The pet itself jumps (when it can be moved); a trail follows its live position.
        const reach = b.reach * Math.sqrt(k);
        if (c.leap) c.leap(at.x + c.dirX * reach, at.z + c.dirZ * reach, b.time, b.height);
        this.sound(el, false, at.x, at.y, at.z, 0.6);
        let t = 0;
        const sx = at.x;
        const sz = at.z;
        this.running.push({
          update: (dt) => {
            t += dt;
            const q = Math.min(1, t / b.time);
            // A pet that can't be moved: the trail runs the way alone.
            const x = c.leap ? at.x : sx + c.dirX * reach * q;
            const z = c.leap ? at.z : sz + c.dirZ * reach * q;
            const y = c.leap ? at.y : this.ground(x, z) + 0.4 + Math.sin(q * Math.PI) * b.height;
            for (let i = 0; i < 8; i++) this.mote(c, x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.3) * 0.4, z + (Math.random() - 0.5) * 0.4, -c.dirX * 1.5, 0.4, -c.dirZ * 1.5, 0.055);
            return q < 1;
          },
        });
        break;
      }
      case 'beam': {
        const reach = b.reach * k;
        const y = at.y + 0.1;
        this.shapes.beam({ x: at.x, y, z: at.z, dx: c.dirX, dy: -0.04, dz: c.dirZ, length: reach, radius: b.radius * Math.sqrt(k), color, time: b.time, retract: b.retract });
        this.sound(el, false, at.x, y, at.z, 0.5);
        const tx = at.x + c.dirX * reach;
        const tz = at.z + c.dirZ * reach;
        // The tip: a small hit (a tongue at the far point, a beam where it ends).
        const hitAt = b.retract ? b.time * 0.5 : b.time * 0.25;
        let t = 0;
        this.running.push({
          update: (dt) => {
            t += dt;
            if (t < hitAt) return true;
            this.beat({ ...c, power: c.power * 0.7, caster: { x: tx, y: this.ground(tx, tz), z: tz, yaw: at.yaw } }, { at: 0, kind: 'burst', radius: 1.5, size: 0.5 });
            return false;
          },
        });
        break;
      }
      case 'bolt': {
        const cx = at.x + c.dirX * b.reach * k;
        const cz = at.z + c.dirZ * b.reach * k;
        let fired = 0;
        let t = 0;
        this.running.push({
          update: (dt) => {
            t += dt;
            while (fired < b.count && t >= fired * b.every) {
              const a = Math.random() * Math.PI * 2;
              const d = b.spread === 0 ? 0 : (0.4 + Math.random() * 0.6) * b.spread * k;
              const x = cx + Math.cos(a) * d;
              const z = cz + Math.sin(a) * d;
              const g = this.ground(x, z);
              // A bolt is a thin beam from the ground up into the sky, there for a blink.
              this.shapes.beam({ x, y: g, z, dx: (Math.random() - 0.5) * 0.15, dy: 1, dz: (Math.random() - 0.5) * 0.15, length: 14, radius: 0.09, color: 0xf4f0ff, time: 0.3 });
              fx.flash(x, g + 3, z, 0xe8ecff, 160, 14, 0.25);
              fx.mark(x, g, z, 0.7, 3);
              fx.shake(x, g, z, 0.3, 0.25);
              fx.sound('thunder', 0.8, x, g, z);
              this.beat({ ...c, power: c.power * 0.8, caster: { x, y: g, z, yaw: at.yaw } }, { at: 0, kind: 'burst', radius: 2, size: 0.7 });
              fired++;
            }
            return fired < b.count;
          },
        });
        break;
      }
      case 'blade': {
        // The sword: hilt up, point down, sliding out of the sky into the ground ahead; a blast
        // when it strikes (40 % in), then it stands there glowing and fades.
        const tx = at.x + c.dirX * b.reach * k;
        const tz = at.z + c.dirZ * b.reach * k;
        const g = this.ground(tx, tz);
        const len = b.length * Math.sqrt(k);
        const w = len * 0.14;
        this.shapes.beam({ x: tx, y: g + len - 0.4, z: tz, dx: 0, dy: -1, dz: 0, length: len, radius: w, color, time: b.time, blade: true, drop: 12 });
        // The crossguard: two short bars across the hilt, square to each other, so it reads as a
        // sword from any side.
        this.shapes.beam({ x: tx - c.dirZ * w * 2.6, y: g + len - 0.4, z: tz + c.dirX * w * 2.6, dx: c.dirZ, dy: 0, dz: -c.dirX, length: w * 5.2, radius: w * 0.35, color, time: b.time, drop: 12 });
        this.shapes.beam({ x: tx - c.dirX * w * 2.6, y: g + len - 0.4, z: tz - c.dirZ * w * 2.6, dx: c.dirX, dy: 0, dz: c.dirZ, length: w * 5.2, radius: w * 0.35, color, time: b.time, drop: 12 });
        let t = 0;
        this.running.push({
          update: (dt) => {
            t += dt;
            if (t < b.time * 0.4) return true;
            fx.flash(tx, g + 2, tz, color, 200 * k, 16 * k, 0.6);
            fx.shock(tx, g, tz, 'energy', color, b.impact * k, 0.6, 1.6 * k);
            fx.shake(tx, g, tz, Math.min(1, 0.5 * k), 0.6);
            fx.mark(tx, g, tz, 1.4, 6);
            fx.sound('thunder', 1, tx, g, tz);
            this.beat({ ...c, caster: { x: tx, y: g, z: tz, yaw: at.yaw } }, { at: 0, kind: 'burst', radius: 3, size: 1.1 });
            return false;
          },
        });
        break;
      }
      case 'sigil': {
        const reach = (b.reach ?? 0) * k;
        this.shapes.sigil(at.x + c.dirX * reach, at.z + c.dirZ * reach, b.pattern, b.radius * k, color, b.time);
        break;
      }
      case 'dome': {
        const r = b.radius * k;
        this.shapes.dome(at.x, at.z, b.style, r, color, b.time);
        this.sound(el, false, at.x, at.y, at.z, 0.5);
        break;
      }
      case 'swarm': {
        const n = b.count;
        const r = b.radius * k;
        const y0 = this.ground(at.x, at.z);
        if (b.shape) {
          // Shapes on their own orbits (bats, leaves, stars), rising and widening.
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const rr = r * (0.6 + Math.random() * 0.4);
            const tint = b.shape === 'leaf' ? 0x7fd65a : b.shape === 'star' ? 0xdfe6ff : 0xffffff;
            this.shapes.shape(b.shape, at.x + Math.cos(a) * rr, y0 + 0.5 + Math.random() * b.height, at.z + Math.sin(a) * rr, 0, 0.5, 0, b.shape === 'bat' ? 0.8 : 0.35, tint, b.time, { x: at.x, z: at.z, speed: 2.4 + Math.random() });
          }
          break;
        }
        // Motes: each orbiter leaves a short trail, then all fly outward.
        let t = 0;
        this.running.push({
          update: (dt) => {
            t += dt;
            for (let i = 0; i < n; i++) {
              const a = (i / n) * Math.PI * 2 + t * (2.5 + (i % 3) * 0.5);
              const h = y0 + 0.5 + (0.5 + 0.5 * Math.sin(i * 1.7 + t * 4)) * b.height;
              const rr = r * (0.7 + 0.3 * Math.sin(i + t * 3));
              this.mote(c, at.x + Math.cos(a) * rr, h, at.z + Math.sin(a) * rr, -Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4, 0.05);
            }
            if (t < b.time) return true;
            for (let i = 0; i < n * 6; i++) {
              const a = Math.random() * Math.PI * 2;
              this.mote(c, at.x + Math.cos(a) * r, y0 + 1, at.z + Math.sin(a) * r, Math.cos(a) * 6, 1 + Math.random(), Math.sin(a) * 6, 0.05);
            }
            return false;
          },
        });
        break;
      }
      case 'shapes': {
        const cx = at.x + c.dirX * b.reach * k;
        const cz = at.z + c.dirZ * b.reach * k;
        const r = b.radius * k;
        const tints = b.tints ?? [0xffffff];
        let left = b.time;
        let debt = 0;
        this.running.push({
          update: (dt) => {
            left -= dt;
            debt += b.rate * dt;
            while (debt >= 1) {
              debt -= 1;
              const a = Math.random() * Math.PI * 2;
              const d = Math.sqrt(Math.random()) * r;
              const x = cx + Math.cos(a) * d;
              const z = cz + Math.sin(a) * d;
              const drift = b.drift ?? 0;
              const tint = tints[Math.floor(Math.random() * tints.length)];
              const size = b.shape === 'pumpkin' ? 0.45 : b.shape === 'fruit' ? 0.3 : b.shape === 'star' ? 0.32 : 0.28;
              this.shapes.shape(
                b.shape,
                x,
                this.ground(x, z) + (b.height ?? 5) + Math.random(),
                z,
                c.dirX * drift + (Math.random() - 0.5) * 1.5,
                drift > 0 ? 1 + Math.random() : -0.5 - Math.random(),
                c.dirZ * drift + (Math.random() - 0.5) * 1.5,
                size,
                tint,
                2.5,
              );
            }
            return left > 0;
          },
        });
        break;
      }
      case 'rainbow': {
        // An arch across the way the caster faces, seven bands from red outside to violet in.
        const cx = at.x + c.dirX * b.reach * k;
        const cz = at.z + c.dirZ * b.reach * k;
        const g = this.ground(cx, cz);
        const rx = c.dirZ;
        const rz = -c.dirX;
        let t = 0;
        this.running.push({
          update: (dt) => {
            t += dt;
            for (let band = 0; band < 7; band++) {
              const rb = b.radius * k * (1 - band * 0.05);
              for (let i = 0; i < 3; i++) {
                const th = Math.random() * Math.PI;
                this.host.pools.rainbow.emit(cx + rx * Math.cos(th) * rb, g + Math.sin(th) * rb, cz + rz * Math.cos(th) * rb, 0, 0.05, 0, 0.07, band / 7.5);
              }
            }
            return t < 1.6;
          },
        });
        break;
      }
      case 'cone': {
        const reach = b.reach * k;
        const y = this.ground(at.x, at.z) + 0.6;
        this.host.fx.sound('sonic', 0.8, at.x, y, at.z);
        fx.shake(at.x, y, at.z, Math.min(1, 0.3 * k), 0.4);
        for (let i = 0; i < 160 * k; i++) {
          const a = Math.atan2(c.dirX, c.dirZ) + (Math.random() - 0.5) * 2 * b.angle;
          const v = (reach / 0.7) * (0.6 + Math.random() * 0.4);
          this.mote(c, at.x, y, at.z, Math.sin(a) * v, (Math.random() - 0.3) * 1.5, Math.cos(a) * v, 0.05);
        }
        for (let i = 1; i <= 3; i++) {
          const d = (reach * i) / 3.5;
          const x = at.x + c.dirX * d;
          const z = at.z + c.dirZ * d;
          fx.shock(x, this.ground(x, z), z, STYLE[el], color, 0.6 + i * 0.5, 0.35);
        }
        break;
      }
      case 'slash': {
        // Each claw: an arc of the element just ahead, slanted, left to right then back.
        const rx = c.dirZ;
        const rz = -c.dirX;
        let fired = 0;
        let t = 0;
        this.running.push({
          update: (dt) => {
            t += dt;
            while (fired < b.count && t >= fired * b.every) {
              const side = fired % 2 === 0 ? 1 : -1;
              const cx = at.x + c.dirX * 1.1;
              const cz = at.z + c.dirZ * 1.1;
              const cy = at.y + 0.3;
              const r = b.radius * Math.sqrt(k);
              for (let i = 0; i < 28; i++) {
                const th = -Math.PI / 2 + (i / 27) * Math.PI;
                const x = cx + rx * Math.sin(th) * r * side;
                const z = cz + rz * Math.sin(th) * r * side;
                const y = cy + Math.cos(th) * r * 0.6 * side * 0.5;
                this.mote(c, x, y, z, c.dirX * 2, 0.3, c.dirZ * 2, 0.06);
              }
              fx.flash(cx, cy, cz, color, 40 * k, 4, 0.2);
              this.sound(el, false, cx, cy, cz, 0.4);
              fired++;
            }
            return fired < b.count;
          },
        });
        break;
      }
      case 'rings': {
        let fired = 0;
        let t = 0;
        const y = this.ground(at.x, at.z);
        this.running.push({
          update: (dt) => {
            t += dt;
            while (fired < b.count && t >= fired * b.every) {
              const k2 = b.count > 1 ? fired / (b.count - 1) : 1;
              fx.shock(at.x, y, at.z, STYLE[el], color, b.radius * k * (0.6 + 0.4 * k2), 0.5);
              if (fired === 0) this.sound(el, b.radius > 4, at.x, y, at.z, 0.6);
              if (el === 'water') this.host.ripple(at.x, at.z, b.radius * 0.3, 0.3);
              fired++;
            }
            return fired < b.count;
          },
        });
        break;
      }
    }
  }
}
