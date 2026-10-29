import { button, el } from './components';
import { vi } from './strings.vi';
import { EGG_TIERS, EGGS, SPECIES, speciesName, TRUST_NEEDED, WILD_KINDS, type EggTier } from '../pets/species';
import { EVOLVE_COST, openSkills, roomOf, roomUsed, skillOpen, skillRank, TEAM_ROOM, type Pet, type Roster } from '../pets/roster';

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


/**
 * "Thú Cưng" tab of the panel (Trại): the tomato store, every pet with Level, Rank, EXP and its
 * skills, eggs and the egg shop, trust of the wild ones. Spending only during breaks: while a
 * focus session runs it shows just the egg's progress and a word of encouragement.
 */
export class CampView {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private roster: Roster | null = null;
  private focusing = false;
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
    this.head.replaceChildren(
      el('div', 'camp-title', vi.pets.camp),
      el('div', 'camp-store', `${vi.pets.wallet} 🍅 ${Math.max(0, r.balance)}`),
    );
    const parts: HTMLElement[] = [];
    if (this.message) parts.push(el('div', 'camp-message', this.message));
    if (this.focusing) {
      parts.push(el('div', 'camp-locked', vi.pets.focusLocked));
      const egg = r.eggs[0];
      if (egg) parts.push(this.eggRow(egg.id, egg.tier, egg.progress, egg.ready, true));
      this.body.replaceChildren(...parts);
      return;
    }
    const notices = this.actions.notices();
    if (notices) parts.push(notices);

    parts.push(el('div', 'subhead', vi.pets.mine));
    const out = new Set(r.team);
    const used = roomUsed(r.pets, r.team);
    if (r.pets.some((p) => p.origin !== 'original')) parts.push(el('div', 'note', vi.pets.room(used, TEAM_ROOM)));
    const sorted = [...r.pets].sort((a, b) => Number(b.origin === 'original') - Number(a.origin === 'original') || a.since - b.since);
    for (const p of sorted) parts.push(this.petCard(p, out.has(p.id), used));

    parts.push(el('div', 'subhead', vi.pets.eggs));
    r.eggs.forEach((g, i) => parts.push(this.eggRow(g.id, g.tier, g.progress, g.ready, i === 0)));
    const shop = el('div', 'camp-shop');
    for (const tier of EGG_TIERS) {
      const b = button('', () => this.actions.buyEgg(tier), 'btn small camp-egg-buy');
      b.append(el('span', 'camp-egg-icon', '🥚'), el('span', '', vi.pets.eggName(tier)), el('span', 'camp-cost', vi.pets.eggCost(EGGS[tier].cost)));
      b.disabled = r.balance < EGGS[tier].cost;
      shop.append(b);
    }
    parts.push(shop, el('div', 'note', vi.pets.eggHint));

    parts.push(el('div', 'subhead', vi.pets.wildTitle));
    for (const kind of WILD_KINDS) {
      parts.push(el('div', 'camp-trust', vi.pets.trust(SPECIES[kind].name, r.trust[kind], TRUST_NEEDED)));
    }
    parts.push(el('div', 'note', vi.pets.wildHint));
    this.body.replaceChildren(...parts);
  }

  private petCard(p: Pet, isOut: boolean, roomTaken: number): HTMLElement {
    const sp = SPECIES[p.species];
    const card = el('div', `camp-pet ${sp.element}${p.shiny ? ' shiny' : ''}`);
    const top = el('div', 'camp-pet-top');
    const icon = el('div', 'camp-pet-icon', sp.emoji);
    const who = el('div', 'camp-pet-who');
    const nameRow = el('div', 'camp-pet-name');
    if (this.editing === p.id) {
      const input = el('input', 'text-input');
      input.value = p.name;
      input.maxLength = 24;
      input.title = vi.pets.renameTitle;
      const done = (save: boolean): void => {
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
    } else {
      nameRow.append(el('span', '', p.name));
      if (p.origin !== 'original') {
        const g = el('span', `camp-gender ${p.traits.gender}`, p.traits.gender === 'f' ? '♀' : '♂');
        g.title = p.traits.gender === 'f' ? vi.pets.female : vi.pets.male;
        nameRow.append(g);
      }
      if (p.shiny) nameRow.append(el('span', 'camp-shiny', `✨ ${vi.pets.shiny}`));
      const pen = button('✎', () => {
        this.editing = p.id;
        this.render();
      }, 'camp-rename');
      pen.title = vi.pets.rename;
      pen.setAttribute('aria-label', vi.pets.rename);
      nameRow.append(pen);
    }
    who.append(nameRow, el('div', 'camp-pet-species', `${speciesName(p.species, p.level)} · ${vi.pets.rankLine(p.level, p.rank)}`));
    const facts = [vi.pets.power(p.power)];
    if (p.origin !== 'original') facts.push('★'.repeat(p.traits.stars) + '☆'.repeat(3 - p.traits.stars));
    if (p.traits.size !== 'normal') facts.push(vi.pets.size[p.traits.size]);
    if (sp.rarity === 'rare' || sp.rarity === 'legendary') facts.push(vi.pets.rarity[sp.rarity]);
    const factLine = el('div', `camp-pet-facts ${sp.rarity}`, facts.join(' · '));
    factLine.title = vi.pets.factsHint;
    who.append(factLine);
    top.append(icon, who);

    const bar = el('div', 'camp-exp');
    const fill = el('div', 'camp-exp-fill');
    fill.style.width = `${p.need > 0 ? (100 * p.into) / p.need : 100}%`;
    bar.append(fill);
    const expText = p.need > 0 ? vi.pets.expLine(p.into, p.need) : p.level === 1 ? vi.pets.expEvolve : vi.pets.expMax;

    const skills = el('div', 'camp-skills');
    const open = new Set(openSkills(p));
    sp.skills.forEach((name, i) => {
      const cls = `camp-skill${open.has(i) ? '' : ' locked'}${i >= 3 ? ' l2' : ''}`;
      if (skillOpen(p, i)) {
        const b = button(name, () => this.actions.castSkill(p.id, i), cls);
        b.title = vi.pets.castHint;
        skills.append(b);
      } else {
        const s = el('span', cls, name);
        s.title = i >= 3 && p.level === 1 ? `${vi.pets.skillLevel2} · ${vi.pets.skillLocked(skillRank(p, i))}` : vi.pets.skillLocked(skillRank(p, i));
        skills.append(s);
      }
    });

    const row = el('div', 'button-row camp-actions');
    const feed = button(vi.pets.feed, () => this.actions.feed(p.id), 'btn small primary');
    feed.disabled = p.need === 0;
    row.append(feed);
    if (p.level === 1 && p.need === 0) {
      const evo = button(vi.pets.evolve(EVOLVE_COST), () => this.actions.evolve(p.id), 'btn small camp-evolve');
      row.append(evo);
    }
    if (p.origin !== 'original') {
      const t = button(vi.pets.out, () => this.actions.toggleTeam(p.id), `btn small toggle${isOut ? ' on' : ''}`);
      t.setAttribute('aria-pressed', String(isOut));
      const needs = roomOf(p.species, p.traits.size);
      t.title = vi.pets.roomNeeds(needs);
      if (!isOut && roomTaken + needs > TEAM_ROOM) {
        t.disabled = true;
        t.title = `${vi.pets.outFull(TEAM_ROOM)} · ${vi.pets.roomNeeds(needs)}`;
      }
      row.append(t);
    } else {
      row.append(el('span', 'camp-home', vi.pets.home));
    }
    card.append(top, bar, el('div', 'camp-exp-text', expText), skills, row);
    return card;
  }

  private eggRow(id: string, tier: EggTier, progress: number, ready: boolean, incubating: boolean): HTMLElement {
    const row = el('div', `camp-egg${ready ? ' ready' : ''}`);
    row.append(el('span', 'camp-egg-icon', ready ? '🐣' : '🥚'), el('span', 'camp-egg-name', vi.pets.eggName(tier)));
    if (ready && !this.focusing) {
      row.append(button(vi.pets.hatch, () => this.actions.hatch(id), 'btn small primary'));
    } else {
      const bar = el('div', 'camp-exp');
      const fill = el('div', 'camp-exp-fill');
      fill.style.width = `${(100 * Math.min(progress, tier)) / tier}%`;
      bar.append(fill);
      row.append(bar, el('span', 'camp-egg-progress', incubating ? vi.pets.eggProgress(Math.min(progress, tier), tier) : vi.pets.eggWaiting));
    }
    return row;
  }
}
