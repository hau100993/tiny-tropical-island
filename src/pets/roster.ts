import { createRng } from '../core/rng';
import { tomatoBalance, withEvent, type Ledger, type PetEvent } from './ledger';
import {
  COMMON,
  EGGS,
  EGG_TIERS,
  LEGEND,
  LEGEND_CHANCE,
  ORIGINALS,
  RARE,
  SPECIES,
  TRUST_NEEDED,
  WILD_KINDS,
  WILD_SHINY,
  WILD_SPECIES,
  type EggTier,
  type SpeciesId,
  type WildKind,
} from './species';

/**
 * Everything about the Thú Cưng worked out from the event log: who you have, their Levels,
 * Ranks and names, eggs and how far they are, trust of the wild ones, who is out on the island.
 * Pure (no storage, no DOM): the same log gives the same roster on every device.
 */

/** Rank cap at Level 1 (where it may evolve) and at Level 2. */
export const EVOLVE_RANK = 15;
export const MAX_RANK = 30;
export const EVOLVE_COST = 20;
/** New pets out on the island at once (the originals live there anyway). */
export const TEAM_MAX = 5;
/** The Rank each skill opens at: new species learn theirs as they grow; Level 2's three after evolving. */
const SKILL_RANKS_NEW = [1, 5, 10, 15, 20, 25] as const;
const SKILL_RANKS_ORIGINAL = [1, 1, 1, 15, 20, 25] as const;
export const MAX_NAME = 24;

export type PetOrigin = 'original' | 'egg' | 'wild';
export type Gender = 'm' | 'f';
/** Most are normal; 1 in 20 is tiny ("Bé tí"), 1 in 20 huge ("Khổng lồ"). */
export type SizeClass = 'normal' | 'tiny' | 'huge';

/** Born with: looks only (gender, size class) and Tiềm năng (1–3 ★: skills up to +15 %). */
export interface Traits {
  gender: Gender;
  size: SizeClass;
  stars: 1 | 2 | 3;
}

export function traitsOf(id: string, origin: PetOrigin): Traits {
  const rng = createRng(hashString(`${id}#traits`));
  const gender: Gender = rng() < 0.5 ? 'f' : 'm';
  const s = rng();
  const st = rng();
  if (origin === 'original') return { gender, size: 'normal', stars: 2 };
  return { gender, size: s < 0.05 ? 'tiny' : s > 0.95 ? 'huge' : 'normal', stars: st < 0.5 ? 1 : st < 0.85 ? 2 : 3 };
}

export const SIZE_SCALE: Readonly<Record<SizeClass, number>> = { normal: 1, tiny: 0.7, huge: 1.35 };

export interface Pet {
  id: string;
  species: SpeciesId;
  name: string;
  level: 1 | 2;
  /** Tomatoes fed, all told. */
  exp: number;
  rank: number;
  /** EXP into the current Rank, and what the next Rank needs (0 at a cap). */
  into: number;
  need: number;
  /** Look: size, hue and accessory come from this. */
  seed: number;
  shiny: boolean;
  origin: PetOrigin;
  /** When it joined (ms; 0 for the originals). */
  since: number;
  traits: Traits;
  /** Sức mạnh: one number for how strong it is (species, Level, Rank, ★). */
  power: number;
}

export interface Egg {
  id: string;
  tier: EggTier;
  boughtAt: number;
  /** Focus sessions it has had, of `tier`. */
  progress: number;
  ready: boolean;
  /** What it will be (decided by its id, so every device agrees). */
  species: SpeciesId;
  shiny: boolean;
}

export interface Roster {
  /** Tomatoes on hand (can be below 0 after two devices spent the same ones offline). */
  balance: number;
  pets: Pet[];
  /** Not hatched yet, in the order they incubate (one at a time, the first one). */
  eggs: Egg[];
  /** Tomatoes fed to wild ones of each kind since the last befriended. */
  trust: Record<WildKind, number>;
  /** Ids of the new pets out on the island (≤ TEAM_MAX). */
  team: string[];
}

/** EXP for Rank r → r + 1. */
export function rankCost(r: number): number {
  return 1 + Math.floor(r / 4);
}

export function rankOf(exp: number, level: 1 | 2): { rank: number; into: number; need: number } {
  const cap = level === 1 ? EVOLVE_RANK : MAX_RANK;
  let rank = 1;
  let left = Math.max(0, exp);
  while (rank < cap && left >= rankCost(rank)) {
    left -= rankCost(rank);
    rank++;
  }
  return rank >= cap ? { rank, into: 0, need: 0 } : { rank, into: left, need: rankCost(rank) };
}

/** How much bigger a Rank (and Tiềm năng) makes its skills: 1 at Rank 1, ~1.7 at Rank 30, +7.5 % per ★ above one. */
export function skillPower(rank: number, stars = 1): number {
  return (1 + 0.025 * (Math.max(1, rank) - 1)) * (1 + 0.075 * (stars - 1));
}

/** Sức mạnh (strength), like a combat-power number: grows with Rank, Level 2 and ★. */
export function powerOf(species: SpeciesId, level: 1 | 2, rank: number, stars: number): number {
  return Math.round(SPECIES[species].base * (1 + 0.06 * (rank - 1)) * (level === 2 ? 1.3 : 1) * (1 + 0.075 * (stars - 1)));
}

/** The Rank each of the species' six skills opens at (Level 2's need Level 2 too). */
export function skillRank(pet: Readonly<Pet>, index: number): number {
  return (pet.origin === 'original' ? SKILL_RANKS_ORIGINAL : SKILL_RANKS_NEW)[index] ?? 99;
}

export function skillOpen(pet: Readonly<Pet>, index: number): boolean {
  return (index < 3 || pet.level === 2) && pet.rank >= skillRank(pet, index);
}

/** Indices of the skills the pet can use now, in order. */
export function openSkills(pet: Readonly<Pet>): number[] {
  const out: number[] = [];
  for (let i = 0; i < 6; i++) if (skillOpen(pet, i)) out.push(i);
  return out;
}

/** FNV-1a: a stable 32-bit number from a string (egg and pet ids → species, looks, shiny). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * What hatches from an egg, decided by its id (so every device agrees). The 10-session egg may
 * hold the legend, unless the player has it already (`legendTaken`): one per player.
 */
export function eggContents(id: string, tier: EggTier, legendTaken = false): { species: SpeciesId; shiny: boolean } {
  const rng = createRng(hashString(id));
  const r = rng();
  const pick = (list: readonly SpeciesId[], u: number): SpeciesId => list[Math.min(list.length - 1, Math.floor(u * list.length))];
  let species: SpeciesId;
  if (tier === 10) {
    if (!legendTaken && r < LEGEND_CHANCE) species = LEGEND;
    else species = pick(RARE, legendTaken ? r : (r - LEGEND_CHANCE) / (1 - LEGEND_CHANCE));
  } else {
    const rare = EGGS[tier].rare;
    species = r < rare ? pick(RARE, r / rare) : pick(COMMON, (r - rare) / (1 - rare));
  }
  return { species, shiny: rng() < EGGS[tier].shiny };
}

function isTier(v: unknown): v is EggTier {
  return EGG_TIERS.includes(Number(v) as EggTier);
}

function isWild(v: unknown): v is WildKind {
  return (WILD_KINDS as readonly unknown[]).includes(v);
}

export function buildRoster(l: Readonly<Ledger>): Roster {
  type Raw = Omit<Pet, 'rank' | 'into' | 'need' | 'traits' | 'power'>;
  const pets = new Map<string, Raw>();
  for (const o of ORIGINALS) {
    pets.set(o.id, { id: o.id, species: o.species, name: SPECIES[o.species].names[0], level: 1, exp: 0, seed: hashString(o.id), shiny: false, origin: 'original', since: 0 });
  }
  const eggs: Array<Egg & { hatched: boolean }> = [];
  const trust = Object.fromEntries(WILD_KINDS.map((k) => [k, 0])) as Record<WildKind, number>;
  let team: string[] | null = null;
  const joined: string[] = [];
  const renamed = new Set<string>();

  const addPet = (id: string, species: SpeciesId, shiny: boolean, origin: PetOrigin, t: number): void => {
    if (pets.has(id)) return;
    pets.set(id, { id, species, name: '', level: 1, exp: 0, seed: hashString(id), shiny, origin, since: t });
    joined.push(id);
  };

  for (const e of l.events) {
    switch (e.kind) {
      case 'focus': {
        const egg = eggs.find((g) => !g.ready);
        if (egg) {
          egg.progress++;
          egg.ready = egg.progress >= egg.tier;
        }
        break;
      }
      case 'feed': {
        const p = e.pet ? pets.get(e.pet) : undefined;
        if (p) p.exp += e.n;
        break;
      }
      case 'evolve': {
        const p = e.pet ? pets.get(e.pet) : undefined;
        if (p) p.level = 2;
        break;
      }
      case 'name': {
        const p = e.pet ? pets.get(e.pet) : undefined;
        const name = cleanName(e.s ?? '');
        if (p && name) {
          p.name = name;
          renamed.add(p.id);
        }
        break;
      }
      case 'egg': {
        const tier = Number(e.s);
        if (!isTier(tier) || eggs.some((g) => g.id === e.id)) break;
        const legendTaken = [...pets.values()].some((p) => p.species === LEGEND) || eggs.some((g) => !g.hatched && g.species === LEGEND);
        eggs.push({ id: e.id, tier, boughtAt: e.t, progress: 0, ready: false, hatched: false, ...eggContents(e.id, tier, legendTaken) });
        break;
      }
      case 'hatch': {
        const egg = eggs.find((g) => g.id === e.s);
        if (!egg || !egg.ready || egg.hatched) break;
        egg.hatched = true;
        addPet(hatchedId(egg.id), egg.species, egg.shiny, 'egg', e.t);
        break;
      }
      case 'trust': {
        if (isWild(e.s)) trust[e.s] += e.n;
        break;
      }
      case 'befriend': {
        if (!isWild(e.s) || !e.pet || trust[e.s] < TRUST_NEEDED) break;
        trust[e.s] -= TRUST_NEEDED;
        const rng = createRng(hashString(e.pet));
        addPet(e.pet, WILD_SPECIES[e.s], rng() < WILD_SHINY, 'wild', e.t);
        break;
      }
      case 'team': {
        team = (e.s ?? '').split(',').filter((id) => id.length > 0);
        // Those who joined before this choice were part of it.
        joined.length = 0;
        break;
      }
    }
  }

  // Automatic names for those not renamed, in joining order, never a name in use.
  const used = new Set<string>();
  for (const p of pets.values()) if (p.origin === 'original' || renamed.has(p.id)) used.add(p.name);
  for (const p of pets.values()) {
    if (p.origin === 'original' || renamed.has(p.id)) continue;
    p.name = freeName(p.species, p.seed, used);
    used.add(p.name);
  }

  const owned = (id: string): boolean => {
    const p = pets.get(id);
    return p !== undefined && p.origin !== 'original';
  };
  const chosen = (team ?? []).filter(owned);
  // New arrivals since the last choice join while there is room.
  for (const id of joined) if (chosen.length < TEAM_MAX && owned(id) && !chosen.includes(id)) chosen.push(id);

  return {
    balance: tomatoBalance(l),
    pets: [...pets.values()].map((p) => {
      const r = rankOf(p.exp, p.level);
      const traits = traitsOf(p.id, p.origin);
      return { ...p, ...r, traits, power: powerOf(p.species, p.level, r.rank, traits.stars) };
    }),
    eggs: eggs.filter((g) => !g.hatched).map(({ hatched: _h, ...g }) => g),
    trust,
    team: [...new Set(chosen)].slice(0, TEAM_MAX),
  };
}

export function hatchedId(eggId: string): string {
  return `h${eggId}`.slice(0, 40);
}

function freeName(species: SpeciesId, seed: number, used: ReadonlySet<string>): string {
  const list = SPECIES[species].names;
  const start = seed % list.length;
  for (let i = 0; i < list.length; i++) {
    const n = list[(start + i) % list.length];
    if (!used.has(n)) return n;
  }
  for (let k = 2; ; k++) {
    const n = `${list[start]} ${k}`;
    if (!used.has(n)) return n;
  }
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

// ---- Actions: each checks it is allowed, and returns the event to add (or why not) ----

export type Refusal = 'tomatoes' | 'cap' | 'evolve' | 'level' | 'unknown' | 'notReady' | 'trust' | 'team';

export type Action = { ok: true; event: PetEvent } | { ok: false; why: Refusal };

/** A fresh unique id for an event ("e" + 12 random base-36 characters). */
export function newEventId(prefix = 'e'): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `${prefix}${a[0].toString(36)}${a[1].toString(36)}`.slice(0, 40);
}

export function feedPet(r: Readonly<Roster>, petId: string, now: number, n = 1): Action {
  const p = r.pets.find((x) => x.id === petId);
  if (!p) return { ok: false, why: 'unknown' };
  if (p.need === 0) return { ok: false, why: p.level === 1 ? 'evolve' : 'cap' };
  if (r.balance < n) return { ok: false, why: 'tomatoes' };
  return { ok: true, event: { id: newEventId(), t: now, kind: 'feed', n, pet: petId } };
}

export function evolvePet(r: Readonly<Roster>, petId: string, now: number): Action {
  const p = r.pets.find((x) => x.id === petId);
  if (!p) return { ok: false, why: 'unknown' };
  if (p.level !== 1 || p.rank < EVOLVE_RANK) return { ok: false, why: 'level' };
  if (r.balance < EVOLVE_COST) return { ok: false, why: 'tomatoes' };
  return { ok: true, event: { id: newEventId(), t: now, kind: 'evolve', n: EVOLVE_COST, pet: petId } };
}

export function buyEgg(r: Readonly<Roster>, tier: EggTier, now: number): Action {
  if (r.balance < EGGS[tier].cost) return { ok: false, why: 'tomatoes' };
  return { ok: true, event: { id: newEventId('g'), t: now, kind: 'egg', n: EGGS[tier].cost, s: String(tier) } };
}

export function hatchEgg(r: Readonly<Roster>, eggId: string, now: number): Action {
  const egg = r.eggs.find((g) => g.id === eggId);
  if (!egg) return { ok: false, why: 'unknown' };
  if (!egg.ready) return { ok: false, why: 'notReady' };
  return { ok: true, event: { id: newEventId(), t: now, kind: 'hatch', n: 0, s: eggId } };
}

export function feedWild(r: Readonly<Roster>, kind: WildKind, now: number): Action {
  if (r.balance < 1) return { ok: false, why: 'tomatoes' };
  return { ok: true, event: { id: newEventId(), t: now, kind: 'trust', n: 1, s: kind } };
}

/** After `feedWild`: trust is full, a wild one of `kind` stays (a new pet). */
export function befriend(r: Readonly<Roster>, kind: WildKind, now: number): Action {
  if (r.trust[kind] < TRUST_NEEDED) return { ok: false, why: 'trust' };
  return { ok: true, event: { id: newEventId(), t: now, kind: 'befriend', n: 0, pet: newEventId('w'), s: kind } };
}

export function renamePet(r: Readonly<Roster>, petId: string, name: string, now: number): Action {
  const clean = cleanName(name);
  if (!r.pets.some((p) => p.id === petId) || !clean) return { ok: false, why: 'unknown' };
  return { ok: true, event: { id: newEventId(), t: now, kind: 'name', n: 0, pet: petId, s: clean } };
}

export function setTeam(r: Readonly<Roster>, ids: readonly string[], now: number): Action {
  const valid = ids.filter((id) => r.pets.some((p) => p.id === id && p.origin !== 'original'));
  if (valid.length > TEAM_MAX) return { ok: false, why: 'team' };
  return { ok: true, event: { id: newEventId(), t: now, kind: 'team', n: 0, s: [...new Set(valid)].join(',') } };
}

/** Applies an allowed action's event to the log (convenience for tests and the store). */
export function apply(l: Readonly<Ledger>, a: Action): Ledger {
  return a.ok ? withEvent(l, a.event) : (l as Ledger);
}
