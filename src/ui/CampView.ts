import { backBar, button, el } from './components';
import { icons } from './icons';
import { vi } from './strings.vi';
import { speciesEgg, tierEgg } from './eggArt';
import { EGG_TIERS, EGGS, SPECIES, speciesName, TRUST_NEEDED, WILD_KINDS, type EggTier } from '../pets/species';
import { EVOLVE_COST, openSkills, roomOf, roomUsed, skillRank, TEAM_ROOM, type Egg, type Pet, type Roster } from '../pets/roster';

/** What the camp asks the game to do. */
export interface CampActions {
  feed(petId: string): void;
  evolve(petId: string): void;
  buyEgg(tier: EggTier): void;
  hatch(eggId: string): void;
  rename(petId: string, name: string): void;
  toggleTeam(petId: string): void;
  /** A skill chip: that pet uses the skill now (if it is on the island). */
  castSkill(petId: string, index: number): void;
  /** Extra rows above the list (the backup reminder, the Drive invitation); null for none. */
  notices(): HTMLElement | null;
}

type Group = 'pets' | 'eggs' | 'wild';
const GROUPS: readonly Group[] = ['pets', 'eggs', 'wild'];

/**
 * "Thú Cưng" tab of the panel (Trại), laid out like the Cảnh tab: three groups (Thú, Trứng,
 * Hoang dã) on a segmented row beside the tomato store. Thú is a grid of small cards (a quick
 * 🍅 on hover); a card opens that pet's page in place (Level, Rank, EXP, its open skills, feed,
 * evolve, out on the island). Trứng: painted eggs (one pattern per species), the one
 * incubating, and the shop. Spending only during breaks: while a focus session runs it shows
 * just the egg's progress and a word of encouragement.
 */
export class CampView {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private roster: Roster | null = null;
  private focusing = false;
  private group: Group = 'pets';
  /** The pet whose page is open, else the grid. */
  private detail: string | null = null;
  /** A rename box is open: no re-render under the typing. */
  private editing: string | null = null;
  private message = '';
  private messageTimer = 0;

  constructor(private readonly actions: CampActions) {
    this.root = el('div', 'camp');
    this.head = el('div', 'camp-head');
    this.body = el('div', 'camp-body');
    this.root.append(this.head, this.body);
  }

  update(roster: Roster, focusing: boolean): void {
    this.roster = roster;
    this.focusing = focusing;
    if (!this.editing) this.render();
  }

  /** A short line under the store (why feeding failed, …), for a few seconds. */
  say(text: string): void {
    this.message = text;
    window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => {
      this.message = '';
      if (!this.editing) this.render();
    }, 3500);
    if (!this.editing) this.render();
  }

  private render(): void {
    const r = this.roster;
    if (!r) return;
    const store = el('div', 'camp-store', `🍅 ${Math.max(0, r.balance)}`);
    store.title = vi.pets.wallet;
    const parts: HTMLElement[] = [];
    if (this.message) parts.push(el('div', 'camp-message', this.message));

    if (this.focusing) {
      this.head.replaceChildren(el('div', 'camp-title', vi.pets.focusTitle), store);
      parts.push(this.lockedCard(r));
      this.body.replaceChildren(...parts);
      return;
    }

    const pet = this.detail ? r.pets.find((p) => p.id === this.detail) : undefined;
    if (pet) {
      // The whole row goes back (the 🍅 count rides along inside it).
      const back = backBar(vi.pets.backTo(pet.name), vi.pets.back, () => this.openPet(null));
      back.root.append(store);
      this.head.replaceChildren(back.root);
      parts.push(this.petPage(pet, r));
      this.body.replaceChildren(...parts);
      return;
    }
    this.detail = null;

    this.head.replaceChildren(this.groupRow(r), store);
    if (this.group === 'pets') parts.push(...this.petsGroup(r));
    else if (this.group === 'eggs') parts.push(...this.eggsGroup(r));
    else parts.push(...this.wildGroup(r));
    this.body.replaceChildren(...parts);
  }

  /** Esc: from a pet's page back to the grid. False when there is nothing to go back from. */
  back(): boolean {
    if (!this.detail || this.focusing) return false;
    this.openPet(null);
    return true;
  }

  private openPet(id: string | null): void {
    this.detail = id;
    this.editing = null;
    this.render();
  }

  /** Thú · Trứng · Hoang dã, with a count (a dot when an egg can hatch). */
  private groupRow(r: Roster): HTMLElement {
    const row = el('div', 'seg-group three camp-groups');
    row.setAttribute('role', 'tablist');
    row.setAttribute('aria-label', vi.pets.groupsLabel);
    const ready = r.eggs.filter((g) => g.ready).length;
    for (const g of GROUPS) {
      const b = button('', () => {
        this.group = g;
        this.render();
      }, 'seg camp-group');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(g === this.group));
      b.setAttribute('aria-pressed', String(g === this.group));
      b.append(el('span', '', vi.pets.groups[g]));
      const count = g === 'pets' ? r.pets.length : g === 'eggs' ? r.eggs.length : 0;
      if (count > 0) b.append(el('span', 'camp-count', String(count)));
      if (g === 'eggs' && ready > 0) {
        b.append(el('span', 'camp-dot'));
        b.title = vi.pets.readyCount(ready);
      }
      row.append(b);
    }
    return row;
  }

  // ---- Thú: the grid ----

  private petsGroup(r: Roster): HTMLElement[] {
    const parts: HTMLElement[] = [];
    const notices = this.actions.notices();
    if (notices) parts.push(notices);
    if (r.pets.some((p) => p.origin !== 'original')) parts.push(this.roomBar(roomUsed(r.pets, r.team)));
    const out = new Set(r.team);
    const grid = el('div', 'camp-grid');
    const sorted = [...r.pets].sort((a, b) => Number(b.origin === 'original') - Number(a.origin === 'original') || a.since - b.since);
    for (const p of sorted) grid.append(this.petCell(p, p.origin === 'original' || out.has(p.id)));
    parts.push(grid);
    return parts;
  }

  private roomBar(used: number): HTMLElement {
    const box = el('div', 'camp-room');
    box.title = vi.pets.roomHint;
    const top = el('div', 'camp-room-top');
    top.append(el('span', '', vi.pets.roomLabel), el('span', 'camp-room-num', `${String(used).replace('.', ',')}/${TEAM_ROOM}`));
    box.append(top, this.bar(used / TEAM_ROOM, 'camp-bar thin'));
    return box;
  }

  private petCell(p: Pet, onIsland: boolean): HTMLElement {
    const sp = SPECIES[p.species];
    const cell = el('div', `camp-cell ${sp.element}`);
    const card = button('', () => this.openPet(p.id), `camp-card${p.shiny ? ' shiny' : ''}`);
    card.title = vi.pets.details(p.name);
    const avatar = this.avatar(p, 'camp-avatar');
    if (onIsland) {
      const dot = el('span', 'camp-here');
      dot.title = vi.pets.onIsland;
      avatar.append(dot);
    }
    const text = el('span', 'camp-card-text');
    const name = el('span', 'camp-card-name', p.name);
    if (p.shiny) name.append(el('span', 'camp-sparkle', '✨'));
    text.append(name, el('span', 'camp-card-meta', `Lv${p.level} · R${p.rank}`), this.bar(this.expPart(p), 'camp-bar thin'));
    card.append(avatar, text);
    cell.append(card);
    if (p.level === 1 && p.need === 0) {
      const up = el('span', 'camp-badge', '↑');
      up.title = vi.pets.canEvolve;
      cell.append(up);
    }
    if (p.need > 0) {
      const feed = button('🍅', () => this.actions.feed(p.id), 'icon-btn camp-quick');
      feed.title = vi.pets.quickFeed(p.name);
      feed.setAttribute('aria-label', vi.pets.quickFeed(p.name));
      cell.append(feed);
    }
    return cell;
  }

  // ---- A pet's own page ----

  private petPage(p: Pet, r: Roster): HTMLElement {
    const sp = SPECIES[p.species];
    const page = el('div', `camp-page ${sp.element}${p.shiny ? ' shiny' : ''}`);

    const hero = el('div', 'camp-hero');
    const who = el('div', 'camp-hero-who');
    who.append(this.nameRow(p));
    const species = [speciesName(p.species, p.level)];
    if (sp.rarity === 'rare' || sp.rarity === 'legendary') species.push(vi.pets.rarity[sp.rarity]);
    if (p.traits.size !== 'normal') species.push(vi.pets.size[p.traits.size]);
    if (p.shiny) species.push(`✨ ${vi.pets.shiny}`);
    who.append(el('div', `camp-hero-species ${sp.rarity}`, species.join(' · ')));
    const stats = el('div', 'camp-stats');
    stats.append(el('span', 'camp-stat', `Level ${p.level}`), el('span', 'camp-stat', `Rank ${p.rank}`));
    const power = el('span', 'camp-stat', vi.pets.power(p.power));
    if (p.origin !== 'original') power.textContent += ` · ${'★'.repeat(p.traits.stars)}${'☆'.repeat(3 - p.traits.stars)}`;
    power.title = vi.pets.factsHint;
    stats.append(power);
    who.append(stats);
    hero.append(this.avatar(p, 'camp-avatar big'), who);

    const exp = el('div', 'camp-exp');
    exp.append(this.bar(this.expPart(p), 'camp-bar'));
    exp.append(el('div', 'camp-exp-text', p.need > 0 ? vi.pets.expLine(p.into, p.need) : p.level === 1 ? vi.pets.expEvolve : vi.pets.expMax));

    const skills = el('div', 'camp-skills');
    const open = openSkills(p);
    for (const i of open) {
      const b = button(sp.skills[i], () => this.actions.castSkill(p.id, i), 'camp-skill');
      b.title = vi.pets.castHint;
      skills.append(b);
    }
    const lockedCount = 6 - open.length;
    const skillBox = el('div', 'camp-section');
    skillBox.append(el('div', 'subhead', vi.pets.skills), skills);
    if (lockedCount > 0) {
      const next = [0, 1, 2, 3, 4, 5].find((i) => !open.includes(i)) ?? 5;
      const needs = next >= 3 && p.level === 1 ? vi.pets.skillLevel2 : vi.pets.skillLocked(skillRank(p, next));
      skillBox.append(el('div', 'note', vi.pets.lockedLeft(lockedCount, needs)));
    }

    const row = el('div', 'button-row camp-actions');
    const feed = button(vi.pets.feed, () => this.actions.feed(p.id), 'btn primary');
    feed.disabled = p.need === 0;
    row.append(feed);
    if (p.level === 1 && p.need === 0) row.append(button(vi.pets.evolve(EVOLVE_COST), () => this.actions.evolve(p.id), 'btn camp-evolve'));
    if (p.origin !== 'original') {
      const isOut = r.team.includes(p.id);
      const t = button(vi.pets.out, () => this.actions.toggleTeam(p.id), `btn toggle${isOut ? ' on' : ''}`);
      t.setAttribute('aria-pressed', String(isOut));
      const needs = roomOf(p.species, p.traits.size);
      t.title = vi.pets.roomNeeds(needs);
      if (!isOut && roomUsed(r.pets, r.team) + needs > TEAM_ROOM) {
        t.disabled = true;
        t.title = `${vi.pets.outFull(TEAM_ROOM)} · ${vi.pets.roomNeeds(needs)}`;
      }
      row.append(t);
    } else {
      row.append(el('span', 'camp-home', vi.pets.home));
    }

    page.append(hero, exp, skillBox, row);
    return page;
  }

  /** The name with its rename pencil and ♀/♂, or the rename box. */
  private nameRow(p: Pet): HTMLElement {
    const nameRow = el('div', 'camp-pet-name');
    if (this.editing === p.id) {
      const input = el('input', 'text-input');
      input.value = p.name;
      input.maxLength = 24;
      input.title = vi.pets.renameTitle;
      const done = (save: boolean): void => {
        if (this.editing !== p.id) return;
        this.editing = null;
        if (save) this.actions.rename(p.id, input.value);
        this.render();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', () => done(true));
      nameRow.append(input);
      queueMicrotask(() => input.focus());
      return nameRow;
    }
    nameRow.append(el('span', '', p.name));
    if (p.origin !== 'original') {
      const g = el('span', `camp-gender ${p.traits.gender}`, p.traits.gender === 'f' ? '♀' : '♂');
      g.title = p.traits.gender === 'f' ? vi.pets.female : vi.pets.male;
      nameRow.append(g);
    }
    const pen = button('', () => {
      this.editing = p.id;
      this.render();
    }, 'icon-btn camp-rename');
    pen.innerHTML = icons.pencil;
    pen.title = vi.pets.rename;
    pen.setAttribute('aria-label', vi.pets.rename);
    nameRow.append(pen);
    return nameRow;
  }

  // ---- Trứng ----

  private eggsGroup(r: Roster): HTMLElement[] {
    const parts: HTMLElement[] = [];
    const incubating = r.eggs.find((g) => !g.ready);
    if (r.eggs.length === 0) parts.push(el('div', 'camp-empty', vi.pets.noEggs));
    else {
      const list = el('div', 'camp-eggs');
      for (const g of r.eggs) list.append(this.eggRow(g, g === incubating));
      parts.push(list);
    }

    const shop = el('div', 'camp-shop');
    for (const tier of EGG_TIERS) {
      const b = button('', () => this.actions.buyEgg(tier), 'camp-egg-buy');
      const art = el('span', 'camp-egg-pic');
      art.innerHTML = tierEgg(tier);
      b.append(art, el('span', 'camp-egg-buy-name', vi.pets.eggName(tier)), el('span', 'camp-cost', vi.pets.eggCost(EGGS[tier].cost)));
      b.disabled = r.balance < EGGS[tier].cost;
      shop.append(b);
    }
    parts.push(el('div', 'subhead', vi.pets.shop), shop, el('div', 'note', vi.pets.eggHint));
    return parts;
  }

  private eggRow(g: Egg, incubating: boolean): HTMLElement {
    const ready = g.ready && !this.focusing;
    const row = el('div', `camp-egg${ready ? ' ready' : ''}${incubating ? ' incubating' : ''}`);
    const art = el('span', 'camp-egg-pic');
    art.innerHTML = speciesEgg(g.species, g.ready);
    const text = el('div', 'camp-egg-text');
    text.append(el('div', 'camp-egg-name', vi.pets.eggName(g.tier)));
    if (ready) {
      row.append(art, text, button(vi.pets.hatch, () => this.actions.hatch(g.id), 'btn primary'));
      return row;
    }
    const done = Math.min(g.progress, g.tier);
    if (incubating) {
      text.append(this.bar(done / g.tier, 'camp-bar'), el('div', 'camp-egg-progress', `${vi.pets.incubating} · ${vi.pets.eggProgress(done, g.tier)}`));
    } else {
      text.append(el('div', 'camp-egg-progress', g.ready ? vi.pets.eggProgress(done, g.tier) : vi.pets.eggWaiting));
    }
    row.append(art, text);
    return row;
  }

  // ---- Hoang dã ----

  private wildGroup(r: Roster): HTMLElement[] {
    const list = el('div', 'camp-wild');
    for (const kind of WILD_KINDS) {
      const sp = SPECIES[kind];
      const row = el('div', `camp-wild-row ${sp.element}`);
      const n = Math.min(r.trust[kind], TRUST_NEEDED);
      const pips = el('span', 'camp-pips');
      for (let i = 0; i < TRUST_NEEDED; i++) pips.append(el('span', i < n ? 'on' : ''));
      pips.title = vi.pets.trust(sp.name, n, TRUST_NEEDED);
      row.append(el('span', 'camp-avatar small', sp.emoji), el('span', 'camp-wild-name', sp.name), pips);
      list.append(row);
    }
    return [list, el('div', 'note', vi.pets.wildHint)];
  }

  // ---- While focusing ----

  private lockedCard(r: Roster): HTMLElement {
    const box = el('div', 'camp-locked');
    box.append(el('div', 'camp-locked-text', vi.pets.focusLocked));
    const egg = r.eggs.find((g) => !g.ready) ?? r.eggs[0];
    if (egg) box.append(this.eggRow(egg, !egg.ready));
    return box;
  }

  // ---- Small pieces ----

  private avatar(p: Pet, cls: string): HTMLElement {
    return el('span', `${cls}${p.shiny ? ' shiny' : ''}`, SPECIES[p.species].emoji);
  }

  private expPart(p: Pet): number {
    return p.need > 0 ? p.into / p.need : 1;
  }

  private bar(part: number, cls: string): HTMLElement {
    const bar = el('span', cls);
    const fill = el('span', 'camp-bar-fill');
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, part)) * 100)}%`;
    bar.append(fill);
    return bar;
  }
}
