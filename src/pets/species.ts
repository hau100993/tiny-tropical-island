/**
 * Every kind of Thú Cưng. The five originals live on the island from the start (one each, with
 * their own hand-made behaviour); more of the crab, dragon and bunny come from befriending wild
 * ones, and five new species hatch from eggs. Skill names are English (as the skill cards are);
 * everything else Vietnamese.
 */
export type SpeciesId = 'dog' | 'crab' | 'dragon' | 'bunny' | 'shark' | 'sparkfly' | 'jelly' | 'lava' | 'turtle' | 'owl';

/** Colours of the skill card and the recipe skills' effects (styles: .skill-card.<element>). */
export type PetElement = 'water' | 'fire' | 'grass' | 'spark' | 'moon';

/** The wild ones in the forest that can be befriended (activities/wildCreatures.ts). */
export type WildKind = 'crab' | 'dragon' | 'bunny';

export interface SpeciesInfo {
  /** Vietnamese species name ("Thỏ Cỏ"). */
  name: string;
  element: PetElement;
  emoji: string;
  /** Level 1's three skills, then Level 2's three (English). */
  skills: readonly [string, string, string, string, string, string];
  /** Automatic names for new individuals, in order of preference (never one in use). */
  names: readonly string[];
}

export const SPECIES: Readonly<Record<SpeciesId, SpeciesInfo>> = {
  dog: {
    name: 'Chó Shiba',
    element: 'spark',
    emoji: '🐕',
    skills: ['Shooting Star', 'Sonic Bark', 'Lightning Strike', 'Comet Dash', 'Thunder Howl', 'Storm Halo'],
    names: ['Mochi'],
  },
  crab: {
    name: 'Cua Nước',
    element: 'water',
    emoji: '🦀',
    skills: ['Aqua Jet', 'Bubble Burst', 'Rainbow Geyser', 'Tidal Crash', 'Bubble Dome', 'Coral Rain'],
    names: ['Bọt', 'Sóng', 'Ngọc', 'Sò', 'Bi', 'Thủy', 'Hến', 'Khơi'],
  },
  dragon: {
    name: 'Rồng Lửa',
    element: 'fire',
    emoji: '🐉',
    skills: ['Flame Breath', 'Inferno Ring', 'Meteor Storm', 'Solar Flare', 'Phoenix Dive', 'Ember Halo'],
    names: ['Hỏa Long', 'Than', 'Hồng', 'Đuốc', 'Ớt', 'Nắng', 'Lửa Nhỏ'],
  },
  bunny: {
    name: 'Thỏ Cỏ',
    element: 'grass',
    emoji: '🐰',
    skills: ['Leaf Blossom', 'Verdant Tornado', 'Dandelion Gale', 'Bloom Wave', 'Vine Spiral', 'Pollen Comet'],
    names: ['Mầm', 'Sương', 'Lá', 'Bông', 'Chồi', 'Cỏ May', 'Lộc', 'Nụ'],
  },
  shark: {
    name: 'Cá Mập Con',
    element: 'water',
    emoji: '🦈',
    skills: ['Breach Splash', 'Wave Bump', 'Whirlpool', 'Tsunami Leap', 'Deep Vortex', 'Rainbow Spout'],
    names: ['Bé Mập'],
  },
  sparkfly: {
    name: 'Đom Đóm Sét',
    element: 'spark',
    emoji: '✨',
    skills: ['Spark Flicker', 'Static Orbit', 'Chain Zap', 'Thunder Lantern', 'Plasma Swarm', 'Sky Bolt'],
    names: ['Lấp Lánh', 'Tia', 'Chớp', 'Đèn', 'Sao Nhỏ', 'Ánh'],
  },
  jelly: {
    name: 'Sứa Mây',
    element: 'water',
    emoji: '🪼',
    skills: ['Mist Pulse', 'Drizzle Veil', 'Tide Ring', 'Rain Bloom', 'Jelly Nova', 'Ocean Halo'],
    names: ['Mây', 'Bồng Bềnh', 'Giọt', 'Lam', 'Phao', 'Bọt Biển'],
  },
  lava: {
    name: 'Bé Dung Nham',
    element: 'fire',
    emoji: '🔥',
    skills: ['Magma Hop', 'Ember Spit', 'Heat Wave', 'Lava Fountain', 'Molten Quake', 'Sun Drop'],
    names: ['Lửa', 'Cam', 'Tro', 'Than Hồng', 'Ấm', 'Bếp'],
  },
  turtle: {
    name: 'Rùa Rêu',
    element: 'grass',
    emoji: '🐢',
    skills: ['Moss Shield', 'Seed Volley', 'Root Quake', 'Forest Crown', 'Thorn Garden', 'Ancient Bloom'],
    names: ['Rêu', 'Ông Già', 'Đá', 'Cổ Thụ', 'Lục', 'Chậm Rãi'],
  },
  owl: {
    name: 'Cú Trăng',
    element: 'moon',
    emoji: '🦉',
    skills: ['Moonbeam', 'Night Glide', 'Star Dust', 'Lunar Halo', 'Comet Rain', 'Eclipse'],
    names: ['Trăng', 'Đêm', 'Bạc', 'Mơ', 'Tinh Tú', 'Khuya'],
  },
};

/** The five who live on the island from the start: fixed ids, always owned. */
export const ORIGINALS: ReadonlyArray<{ id: string; species: SpeciesId }> = [
  { id: 'mochi', species: 'dog' },
  { id: 'bot', species: 'crab' },
  { id: 'hoalong', species: 'dragon' },
  { id: 'mam', species: 'bunny' },
  { id: 'bemap', species: 'shark' },
];

/** The species that hatch from eggs (hand-built in code, world/pets/). */
export const EGG_SPECIES: readonly SpeciesId[] = ['sparkfly', 'jelly', 'lava', 'turtle', 'owl'];

export type EggTier = 2 | 5 | 10;
export const EGG_TIERS: readonly EggTier[] = [2, 5, 10];

/** An egg: its price (🍅), what may hatch from it, and the chance it is shiny. */
export const EGGS: Readonly<Record<EggTier, { cost: number; pool: readonly SpeciesId[]; shiny: number }>> = {
  2: { cost: 5, pool: ['lava', 'turtle', 'jelly'], shiny: 1 / 30 },
  5: { cost: 10, pool: ['jelly', 'sparkfly', 'turtle', 'lava'], shiny: 1 / 20 },
  10: { cost: 20, pool: ['owl', 'sparkfly', 'owl', 'jelly'], shiny: 1 / 10 },
};

/** Tomatoes fed to wild ones of a kind (over any number of meetings) to befriend one. */
export const TRUST_NEEDED = 3;
export const WILD_SHINY = 1 / 100;

export function isSpecies(v: unknown): v is SpeciesId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPECIES, v);
}
