import { describe, expect, it } from 'vitest';
import { addStartingGift, earnFocus, emptyLedger, mergeLedgers, type Ledger } from '../src/pets/ledger';
import {
  apply,
  befriend,
  buildRoster,
  buyEgg,
  eggContents,
  evolvePet,
  EVOLVE_COST,
  EVOLVE_RANK,
  feedPet,
  feedWild,
  hatchEgg,
  MAX_RANK,
  openSkills,
  rankCost,
  rankOf,
  renamePet,
  setTeam,
  skillPower,
  TEAM_MAX,
} from '../src/pets/roster';
import { EGGS, TRUST_NEEDED } from '../src/pets/species';

const T0 = new Date(2026, 9, 29, 9, 0).getTime();
const MIN = 60_000;
let clock = T0;
const tick = (): number => (clock += MIN);

/** A log with `n` tomatoes from focus sessions (each its own day, so the daily cap never bites). */
function rich(n: number): Ledger {
  let l = emptyLedger();
  for (let i = 0; i < n; i++) {
    const end = T0 - (i + 1) * 86_400_000;
    l = earnFocus(l, end, 25, end).ledger;
  }
  return l;
}

function focus(l: Ledger, count: number): Ledger {
  let next = l;
  for (let i = 0; i < count; i++) {
    const end = tick();
    next = earnFocus(next, end, 25, end).ledger;
  }
  return next;
}

function feed(l: Ledger, pet: string, times: number): Ledger {
  let next = l;
  for (let i = 0; i < times; i++) next = apply(next, feedPet(buildRoster(next), pet, tick()));
  return next;
}

describe('ranks', () => {
  it('costs grow every 4 Ranks and the totals match the plan', () => {
    expect([1, 3, 4, 7, 8].map(rankCost)).toEqual([1, 1, 2, 2, 3]);
    let total = 0;
    for (let r = 1; r < EVOLVE_RANK; r++) total += rankCost(r);
    expect(total).toBe(35);
    let more = 0;
    for (let r = EVOLVE_RANK; r < MAX_RANK; r++) more += rankCost(r);
    expect(more).toBe(92);
  });

  it('Level 1 stops at Rank 15 until it evolves', () => {
    expect(rankOf(0, 1)).toEqual({ rank: 1, into: 0, need: 1 });
    expect(rankOf(4, 1)).toEqual({ rank: 4, into: 1, need: 2 });
    expect(rankOf(500, 1)).toEqual({ rank: 15, into: 0, need: 0 });
    expect(rankOf(500, 2).rank).toBe(30);
    expect(skillPower(30)).toBeCloseTo(1.725);
  });
});

describe('roster', () => {
  it('starts with the five originals and no tomatoes', () => {
    const r = buildRoster(emptyLedger());
    expect(r.pets.map((p) => p.name)).toEqual(['Mochi', 'Bọt', 'Hỏa Long', 'Mầm', 'Bé Mập']);
    expect(r.balance).toBe(0);
    expect(feedPet(r, 'mam', T0)).toEqual({ ok: false, why: 'tomatoes' });
  });

  it('feeding spends tomatoes and raises the Rank', () => {
    const l = feed(addStartingGift(emptyLedger(), 10, T0), 'mam', 4);
    const r = buildRoster(l);
    const mam = r.pets.find((p) => p.id === 'mam');
    expect(r.balance).toBe(6);
    expect(mam?.rank).toBe(4);
    expect(mam?.into).toBe(1);
  });

  it('evolves at Rank 15 for 20 tomatoes, then Level 2 skills open with Rank', () => {
    let l = feed(rich(100), 'mam', 35);
    let r = buildRoster(l);
    expect(feedPet(r, 'mam', tick())).toEqual({ ok: false, why: 'evolve' });
    const mam = r.pets.find((p) => p.id === 'mam');
    expect(mam?.rank).toBe(EVOLVE_RANK);
    expect(openSkills(mam!)).toEqual([0, 1, 2]);
    l = apply(l, evolvePet(r, 'mam', tick()));
    r = buildRoster(l);
    expect(r.balance).toBe(100 - 35 - EVOLVE_COST);
    expect(openSkills(r.pets.find((p) => p.id === 'mam')!)).toEqual([0, 1, 2, 3]);
    // Rank 15 → 20: 4 + 5 × 4.
    l = feed(l, 'mam', 24);
    expect(openSkills(buildRoster(l).pets.find((p) => p.id === 'mam')!)).toEqual([0, 1, 2, 3, 4]);
  });

  it('eggs incubate one at a time with focus sessions, then hatch', () => {
    let l = rich(30);
    l = apply(l, buyEgg(buildRoster(l), 2, tick()));
    l = apply(l, buyEgg(buildRoster(l), 5, tick()));
    let r = buildRoster(l);
    expect(r.balance).toBe(30 - EGGS[2].cost - EGGS[5].cost);
    expect(hatchEgg(r, r.eggs[0].id, tick())).toEqual({ ok: false, why: 'notReady' });
    l = focus(l, 3);
    r = buildRoster(l);
    expect(r.eggs.map((g) => [g.progress, g.ready])).toEqual([
      [2, true],
      [1, false],
    ]);
    const first = r.eggs[0];
    l = apply(l, hatchEgg(r, first.id, tick()));
    r = buildRoster(l);
    expect(r.eggs).toHaveLength(1);
    const baby = r.pets.find((p) => p.origin === 'egg');
    expect(baby?.species).toBe(eggContents(first.id, 2).species);
    expect(baby?.name).toBeTruthy();
    // A new arrival joins the team while there is room.
    expect(r.team).toEqual([baby?.id]);
    // New species learn their skills as they grow.
    expect(openSkills(baby!)).toEqual([0]);
  });

  it('befriending a wild one takes trust from several feedings', () => {
    let l = rich(10);
    for (let i = 0; i < TRUST_NEEDED - 1; i++) l = apply(l, feedWild(buildRoster(l), 'bunny', tick()));
    expect(befriend(buildRoster(l), 'bunny', tick())).toEqual({ ok: false, why: 'trust' });
    l = apply(l, feedWild(buildRoster(l), 'bunny', tick()));
    l = apply(l, befriend(buildRoster(l), 'bunny', tick()));
    const r = buildRoster(l);
    const friend = r.pets.find((p) => p.origin === 'wild');
    expect(friend?.species).toBe('bunny');
    // Never the same name as Mầm.
    expect(friend?.name).not.toBe('Mầm');
    expect(r.trust.bunny).toBe(0);
    expect(r.balance).toBe(10 - TRUST_NEEDED);
  });

  it('renames, team choice and its limit', () => {
    let l = rich(TRUST_NEEDED * (TEAM_MAX + 1));
    for (let i = 0; i < TEAM_MAX + 1; i++) {
      for (let k = 0; k < TRUST_NEEDED; k++) l = apply(l, feedWild(buildRoster(l), 'crab', tick()));
      l = apply(l, befriend(buildRoster(l), 'crab', tick()));
    }
    let r = buildRoster(l);
    const crabs = r.pets.filter((p) => p.origin === 'wild');
    expect(crabs).toHaveLength(TEAM_MAX + 1);
    expect(new Set(crabs.map((p) => p.name)).size).toBe(crabs.length);
    expect(r.team).toHaveLength(TEAM_MAX);
    expect(setTeam(r, crabs.map((p) => p.id), tick())).toEqual({ ok: false, why: 'team' });
    l = apply(l, setTeam(r, [crabs[5].id], tick()));
    l = apply(l, renamePet(buildRoster(l), crabs[5].id, '  Cua   Vàng ', tick()));
    r = buildRoster(l);
    expect(r.team).toEqual([crabs[5].id]);
    expect(r.pets.find((p) => p.id === crabs[5].id)?.name).toBe('Cua Vàng');
  });

  it('two devices spending the same tomatoes go below zero, earnings pay it back', () => {
    const base = rich(1);
    const pc = apply(base, feedPet(buildRoster(base), 'bot', T0 + 1));
    const phone = apply(base, feedPet(buildRoster(base), 'mochi', T0 + 2));
    const merged = mergeLedgers(pc, phone);
    expect(buildRoster(merged).balance).toBe(-1);
    expect(feedPet(buildRoster(merged), 'bot', T0 + 3)).toEqual({ ok: false, why: 'tomatoes' });
  });
});

describe('species', () => {
  it('every recipe skill exists: Level 2 of the originals, all six of the egg species', async () => {
    const { hasRecipe } = await import('../src/world/pets/recipes');
    const { SPECIES, EGG_SPECIES, ORIGINALS } = await import('../src/pets/species');
    for (const o of ORIGINALS) for (const name of SPECIES[o.species].skills.slice(3)) expect(hasRecipe(name), name).toBe(true);
    for (const id of EGG_SPECIES) for (const name of SPECIES[id].skills) expect(hasRecipe(name), name).toBe(true);
  });

  it('every egg tier hatches only egg species', () => {
    for (const tier of [2, 5, 10] as const) {
      for (let i = 0; i < 50; i++) expect(['sparkfly', 'jelly', 'lava', 'turtle', 'owl']).toContain(eggContents(`g${i}`, tier).species);
    }
  });
});
