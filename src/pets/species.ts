/**
 * Every kind of Thú Cưng. The five originals live on the island from the start (one each, with
 * their own hand-made behaviour); more crabs, dragons and bunnies come from befriending wild
 * ones in the forest; ten more species hatch from eggs (and four of them also live wild). Skill
 * names are English (as the skill cards are); everything else Vietnamese.
 */
export type SpeciesId =
  | 'dog'
  | 'crab'
  | 'dragon'
  | 'bunny'
  | 'shark'
  | 'deer'
  | 'na'
  | 'frog'
  | 'tiger'
  | 'bee'
  | 'cloudDragon'
  | 'seahorse'
  | 'kind8'
  | 'spider'
  | 'kimquy';

/** Colours of the skill card and the recipe skills' effects (styles: .skill-card.<element>). */
export type PetElement = 'water' | 'fire' | 'grass' | 'spark' | 'moon';

export type Rarity = 'original' | 'common' | 'rare' | 'legendary';

/**
 * Wild ones that can be befriended: the forest's crab, dragon and bunny (activities/
 * wildCreatures.ts) and the four egg species that also live wild (world/pets/wildVisitors.ts).
 */
export type WildKind = 'crab' | 'dragon' | 'bunny' | 'frog' | 'bee' | 'spider' | 'deer';
export const WILD_KINDS: readonly WildKind[] = ['crab', 'dragon', 'bunny', 'frog', 'bee', 'spider', 'deer'];

export interface SpeciesInfo {
  /** Vietnamese species name at Level 1 and at Level 2 ("Ếch Xanh", "Ếch Vương"). */
  name: string;
  name2: string;
  element: PetElement;
  rarity: Rarity;
  emoji: string;
  /** Level 1's three skills, then Level 2's three (English). */
  skills: readonly [string, string, string, string, string, string];
  /** Automatic names for new individuals, in order of preference (never one in use). */
  names: readonly string[];
  /** Base of its Sức mạnh (strength) number. */
  base: number;
  /** Colour of its stand-in body while its model file is missing (and of its Level 2 glow). */
  color: number;
}

export const SPECIES: Readonly<Record<SpeciesId, SpeciesInfo>> = {
  dog: {
    name: 'Chó Shiba',
    name2: 'Chó Shiba',
    element: 'spark',
    rarity: 'original',
    emoji: '🐕',
    skills: ['Shooting Star', 'Sonic Bark', 'Lightning Strike', 'Comet Dash', 'Thunder Howl', 'Storm Halo'],
    names: ['Mochi'],
    base: 120,
    color: 0xd98a3c,
  },
  crab: {
    name: 'Cua Nước',
    name2: 'Cua Nước',
    element: 'water',
    rarity: 'original',
    emoji: '🦀',
    skills: ['Aqua Jet', 'Bubble Burst', 'Rainbow Geyser', 'Tidal Crash', 'Bubble Dome', 'Coral Rain'],
    names: ['Bọt', 'Sóng', 'Ngọc', 'Sò', 'Bi', 'Thủy', 'Hến', 'Khơi'],
    base: 110,
    color: 0x3d9ad4,
  },
  dragon: {
    name: 'Rồng Lửa',
    name2: 'Rồng Lửa',
    element: 'fire',
    rarity: 'original',
    emoji: '🐉',
    skills: ['Flame Breath', 'Inferno Ring', 'Meteor Storm', 'Solar Flare', 'Phoenix Dive', 'Ring of Fire'],
    names: ['Hỏa Long', 'Than', 'Hồng', 'Đuốc', 'Ớt', 'Nắng', 'Lửa Nhỏ'],
    base: 130,
    color: 0xe0522a,
  },
  bunny: {
    name: 'Thỏ Cỏ',
    name2: 'Thỏ Cỏ',
    element: 'grass',
    rarity: 'original',
    emoji: '🐰',
    skills: ['Leaf Blossom', 'Verdant Tornado', 'Dandelion Gale', 'Bloom Wave', 'Vine Spiral', 'Pollen Comet'],
    names: ['Mầm', 'Sương', 'Lá', 'Bông', 'Chồi', 'Cỏ May', 'Lộc', 'Nụ'],
    base: 105,
    color: 0x8fcf6e,
  },
  shark: {
    name: 'Cá Mập Con',
    name2: 'Cá Mập Con',
    element: 'water',
    rarity: 'original',
    emoji: '🦈',
    skills: ['Breach Splash', 'Wave Bump', 'Whirlpool', 'Tsunami Leap', 'Deep Vortex', 'Rainbow Spout'],
    names: ['Bé Mập'],
    base: 125,
    color: 0x6f8fa8,
  },
  deer: {
    name: 'Nai Vàng',
    name2: 'Nai Thần Rừng',
    element: 'grass',
    rarity: 'common',
    emoji: '🦌',
    skills: ['Golden Leap', 'Meadow Breeze', 'Forest Call', 'Antler Bloom', 'Sunlit Stampede', 'Spirit of the Woods'],
    names: ['Nắng Mai', 'Hươu Con', 'Lộc Vàng', 'Gạc Nhỏ', 'Thu', 'Rừng'],
    base: 100,
    color: 0xd9a441,
  },
  na: {
    name: 'Bé Na',
    name2: 'Na Chín',
    element: 'grass',
    rarity: 'common',
    emoji: '🍈',
    skills: ['Seed Pop', 'Sweet Scent', 'Rolling Fruit', 'Ripe Burst', 'Honey Rain', 'Harvest Feast'],
    names: ['Na Na', 'Mắt Na', 'Ngọt', 'Tròn', 'Múi', 'Bé Xanh'],
    base: 95,
    color: 0x8cc66a,
  },
  frog: {
    name: 'Ếch Xanh',
    name2: 'Ếch Vương',
    element: 'water',
    rarity: 'common',
    emoji: '🐸',
    skills: ['Lily Hop', 'Tongue Snap', 'Croak Wave', 'Rain Song', 'Lotus Shield', 'Monsoon Call'],
    names: ['Ộp Ộp', 'Mưa', 'Sen', 'Nhái Bén', 'Xanh Lè', 'Chẫu'],
    base: 100,
    color: 0x5cbf4a,
  },
  tiger: {
    name: 'Hổ Báo',
    name2: 'Hổ Lửa',
    element: 'fire',
    rarity: 'rare',
    emoji: '🐯',
    skills: ['Pounce', 'Tiger Roar', 'Blaze Claw', 'Inferno Dash', 'Burning Stripes', "King's Roar"],
    names: ['Vằn', 'Cọp Con', 'Báo Đốm', 'Hùm', 'Mướp', 'Dũng'],
    base: 130,
    color: 0xf08a24,
  },
  bee: {
    name: 'Ong Vàng',
    name2: 'Ong Chúa',
    element: 'spark',
    rarity: 'common',
    emoji: '🐝',
    skills: ['Buzz Sting', 'Pollen Spark', 'Honey Zap', 'Swarm Dance', 'Honey Fountain', 'Thunder Hive'],
    names: ['Vo Ve', 'Mật', 'Vàng Ươm', 'Ong Nhí', 'Phấn Hoa', 'Chăm'],
    base: 95,
    color: 0xf5c518,
  },
  cloudDragon: {
    name: 'Rồng Mây',
    name2: 'Rồng Mây Lớn',
    element: 'moon',
    rarity: 'rare',
    emoji: '🐲',
    skills: ['Cloud Puff', 'Moon Breath', 'Star Glide', 'Nebula Wings', 'Lunar Roar', 'Galaxy Storm'],
    names: ['Mây Trắng', 'Tinh Vân', 'Gió', 'Bồng', 'Sao Băng', 'Mộng'],
    base: 135,
    color: 0xa9b8ff,
  },
  seahorse: {
    // Named by the user (2026-10-29); it floats a little above the ground, as if under water.
    name: 'Cá Ngựa',
    name2: 'Long Mã',
    element: 'water',
    rarity: 'rare',
    emoji: '🐠',
    skills: ['Splash Dash', 'Bubble Ring', 'Tide Spin', 'Wave Crown', 'Deep Pulse', 'Ocean Heart'],
    names: ['San Hô', 'Xoắn', 'Rong', 'Ngọc Trai', 'Sóng Nhỏ', 'Hải Mã'],
    base: 125,
    color: 0xe0533a,
  },
  kind8: {
    // Named by the user (2026-10-30): a fire mongoose ("Monkroose" model).
    name: 'Chồn Lửa',
    name2: 'Hỏa Hồ Vương',
    element: 'fire',
    rarity: 'rare',
    emoji: '🦊',
    skills: ['Flame Hop', 'Ember Twirl', 'Flame Burst', 'Sun Crown', 'Blaze Spiral', 'Sunfire Nova'],
    names: ['Lửa Nhỏ', 'Tía', 'Bom', 'Xíu', 'Than Hồng', 'Đuôi Đỏ'],
    base: 125,
    color: 0xe86a4a,
  },
  spider: {
    name: 'Nhện Halloween',
    name2: 'Nhện Bí Ngô',
    element: 'moon',
    rarity: 'rare',
    emoji: '🕷️',
    skills: ['Web Shot', 'Night Weave', 'Pumpkin Hex', 'Silk Moon', 'Lantern Web', 'Haunted Night'],
    names: ['Tơ', 'Bí Ngô', 'Đêm', 'Tám Chân', 'Ma Lem', 'Kẹo'],
    base: 125,
    color: 0x7b4fa8,
  },
  kimquy: {
    name: 'Kim Quy',
    name2: 'Thần Kim Quy',
    element: 'water',
    rarity: 'legendary',
    emoji: '🐢',
    skills: ['Golden Shell', 'Lake Ripple', 'Ancient Script', 'Jade Wave', "Heaven's Blade", 'Thuận Thiên Light'],
    names: ['Kim Quy'],
    base: 180,
    color: 0xe0b83a,
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

/** The species that hatch from eggs. */
export const EGG_SPECIES: readonly SpeciesId[] = ['deer', 'na', 'frog', 'tiger', 'bee', 'cloudDragon', 'seahorse', 'kind8', 'spider', 'kimquy'];
export const COMMON: readonly SpeciesId[] = ['deer', 'na', 'frog', 'bee'];
export const RARE: readonly SpeciesId[] = ['tiger', 'cloudDragon', 'seahorse', 'kind8', 'spider'];
/** The legendary one: from 10-session eggs only, at this chance, and one per player. */
export const LEGEND: SpeciesId = 'kimquy';
export const LEGEND_CHANCE = 1 / 15;

export type EggTier = 2 | 5 | 10;
export const EGG_TIERS: readonly EggTier[] = [2, 5, 10];

/**
 * An egg: its price (🍅), the chance a rare species hatches from it (the rest are common; the
 * 10-session egg is all rare, with its chance of the legend), and the chance it is shiny.
 */
export const EGGS: Readonly<Record<EggTier, { cost: number; rare: number; shiny: number }>> = {
  2: { cost: 5, rare: 0, shiny: 1 / 30 },
  5: { cost: 10, rare: 0.25, shiny: 1 / 20 },
  10: { cost: 20, rare: 1, shiny: 1 / 10 },
};

/** Tomatoes fed to wild ones of a kind (over any number of meetings) to befriend one. */
export const TRUST_NEEDED = 3;
export const WILD_SHINY = 1 / 100;

/** What a befriended wild one becomes. */
export const WILD_SPECIES: Readonly<Record<WildKind, SpeciesId>> = {
  crab: 'crab',
  dragon: 'dragon',
  bunny: 'bunny',
  frog: 'frog',
  bee: 'bee',
  spider: 'spider',
  deer: 'deer',
};

/**
 * Where each species' models come from (Poly Pizza model ids, chosen by the user on
 * 2026-10-29), saved as src/assets/creatures/pets/<species>-<l1|l2|shiny>.glb. A missing file:
 * Level 2 and shiny fall back to the Level 1 model with a new look made in code; a missing
 * Level 1 model to a stand-in body.
 */
export const MODEL_SOURCES: Readonly<Partial<Record<SpeciesId, { l1: string; l2?: string; shiny?: string }>>> = {
  deer: { l1: 'T6Cs7tmMHJ', l2: 'tQdzbZ1Cmw' },
  na: { l1: 'x9x0viZs8V' },
  frog: { l1: '9Z2V8fpazF', l2: '0D54W8yfrA', shiny: '37wofOCOzG' },
  tiger: { l1: '2f54vbV0In' },
  bee: { l1: '42djT5zJnx' },
  cloudDragon: { l1: '54QyRcsogk', l2: 'Mo2ky6vkf8' },
  seahorse: { l1: '2i8WB9jqzdc' },
  kind8: { l1: 'j4rVPvxyLg' },
  spider: { l1: 'yRYJiAJyiM' },
  kimquy: { l1: '2LCcq8vhqJ3' },
};

export function isSpecies(v: unknown): v is SpeciesId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPECIES, v);
}

export function speciesName(id: SpeciesId, level: 1 | 2): string {
  return level === 2 ? SPECIES[id].name2 : SPECIES[id].name;
}
