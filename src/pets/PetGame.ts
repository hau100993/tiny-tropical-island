import * as THREE from 'three';
import type { ClickAim } from '../controls/waterClick';
import { PetPointer } from '../controls/petPointer';
import type { SkillFxSink } from '../world/creatures/skillFx';
import type { WildTarget } from '../activities/wildCreatures';
import type { PetSpot } from '../activities/creatures';
import type { SkillElement } from '../ui/skillCard';
import { CampView } from '../ui/CampView';
import { FeedBubble } from '../ui/FeedBubble';
import { vi } from '../ui/strings.vi';
import { TomatoToss } from '../world/pets/tomatoToss';
import { buildBody, type PetBody } from '../world/pets/bodies';
import { PetActor } from '../world/pets/PetActor';
import { RecipeRunner, hasRecipe, recipeLength, type Caster, type RecipePools } from '../world/pets/recipes';
import { Ceremonies } from '../world/pets/ceremony';
import { applyLevel2, ELEMENT_COLOR, spinAura, tintModel } from '../world/pets/looks';
import type { TomatoWallet } from './wallet';
import {
  befriend,
  buyEgg,
  evolvePet,
  feedPet,
  feedWild,
  hatchEgg,
  hatchedId,
  openSkills,
  renamePet,
  setTeam,
  skillPower,
  TEAM_MAX,
  type Action,
  type Pet,
  type Refusal,
  type Roster,
} from './roster';
import { SPECIES, TRUST_NEEDED, type EggTier, type WildKind } from './species';

/** Feeding reach (m, on the ground) for a pet, and for a wild one (they are shy: you throw). */
const PET_REACH = 3.2;
const WILD_REACH = 12;
/** Walked off without feeding: that one doesn't ask again for this long (ms). */
const ASK_AGAIN_MS = 10 * 60_000;

export interface PetGameHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  ui: HTMLElement;
  wallet: TomatoWallet;
  heightAt(x: number, z: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  fx: SkillFxSink;
  pools(): RecipePools;
  hearts(at: THREE.Vector3): void;
  skillCard(text: string, element: SkillElement): void;
  /** A short note (the activity card's last row). */
  note(text: string): void;
  /** A focus session is running (no spending, no bubbles). */
  focusing(): boolean;
  /** You on foot (or swimming): feet and heading. */
  you(out: { x: number; y: number; z: number; yaw: number }): boolean;
  /** Where the new pets live when not following you. */
  camp: { x: number; z: number };
  /** Where the pointer aims (as for the creatures), and whether another pet has it first. */
  aim(): ClickAim;
  pointerTaken(): boolean;
  /** Mochi, Bọt, Hỏa Long, Mầm, Bé Mập (shown and loaded ones), by pet id. */
  originalSpots(out: PetSpot[]): void;
  originalRoot(id: string): THREE.Object3D | null;
  originalCheer(id: string): void;
  /** Where an original is and faces, for its Level 2 skills. */
  originalCaster(id: string, out: Caster): boolean;
  /** An original's own skill (its next one, as its key does): false if it can't now. */
  originalNative(id: string): boolean;
  wildWatchers(out: WildTarget[]): void;
  /** The .glb model of a befriended crab, dragon or bunny. */
  loadWild(kind: WildKind): Promise<PetBody>;
  /** A soft pop (a tomato landed). */
  pop(): void;
  /** Wind strength now (animations). */
  wind(): number;
  /** Extra rows for the camp (backup reminder, Drive invitation), or null. */
  campNotices(): HTMLElement | null;
}

type Target = { pet: string; x: number; y: number; z: number; reach: number } | { wild: WildTarget; x: number; y: number; z: number; reach: number };

/**
 * The Thú Cưng game on the island: the camp tab, the feeding bubble, tossed tomatoes, the new
 * pets (their models, walking about, their skills), Level 2 looks, hatching and evolving.
 * The rules and the save live in roster.ts / ledger.ts; this only shows and asks.
 */
export class PetGame {
  readonly camp: CampView;
  private readonly bubble: FeedBubble;
  private readonly toss = new TomatoToss();
  private readonly recipes: RecipeRunner;
  private readonly ceremonies: Ceremonies;
  private readonly actors = new Map<string, PetActor>();
  private readonly loading = new Set<string>();
  /** Levels the models were built for (rebuilt when it changes). */
  private readonly builtLevel = new Map<string, 1 | 2>();
  private readonly auras = new Map<string, THREE.Object3D>();
  private readonly pointer: PetPointer;
  private hovered: PetActor | null = null;
  private readonly spots: PetSpot[] = [];
  private readonly watchers: WildTarget[] = [];
  private target: Target | null = null;
  private readonly askedUntil = new Map<string, number>();
  private readonly you = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly caster: Caster = { x: 0, y: 0, z: 0, yaw: 0 };
  /** Each original's place in its skill cycle (its own three, then its open Level 2 ones). */
  private readonly cycle = new Map<string, number>();
  private focusing = false;
  private lastRoster: Roster;

  constructor(private readonly host: PetGameHost) {
    this.lastRoster = host.wallet.roster;
    this.camp = new CampView({
      feed: (id) => this.feed(id, null),
      evolve: (id) => this.evolve(id),
      buyEgg: (tier) => this.buyEgg(tier),
      hatch: (id) => this.hatch(id),
      rename: (id, name) => this.result(host.wallet.act((r) => renamePet(r, id, name, Date.now()))),
      toggleTeam: (id) => this.toggleTeam(id),
      castSkill: (id, index) => this.castSkill(id, index),
      notices: () => host.campNotices(),
    });
    this.bubble = new FeedBubble(host.ui, () => this.feedTarget());
    this.recipes = new RecipeRunner({ fx: host.fx, get pools() { return host.pools(); }, heightAt: host.heightAt, ripple: host.ripple });
    const pools = host.pools();
    this.ceremonies = new Ceremonies(host.fx, pools.rainbow);
    host.scene.add(this.toss.group, this.ceremonies.group);
    this.pointer = new PetPointer(host.renderer.domElement, host.camera, {
      aim: () => (this.actors.size > 0 ? host.aim() : 'none'),
      hit: (ray) => {
        this.hovered = null;
        if (host.pointerTaken()) return false;
        let best = Infinity;
        for (const a of this.actors.values()) {
          if (!a.body.root.visible) continue;
          const d = a.hitBy(ray, this.tmp);
          if (d !== null && d < best) {
            best = d;
            this.hovered = a;
          }
        }
        return this.hovered !== null;
      },
      onStart: () => {
        if (this.hovered) this.tapActor(this.hovered);
      },
      onMove: () => {},
      onEnd: () => {},
    });
    host.wallet.onChange(() => this.refresh());
    this.refresh();
  }

  /** The pointer is on a new pet (no water click, the paw cursor). */
  get hover(): boolean {
    return this.pointer.hover;
  }

  /** Something the camp shows changed outside the log (the Drive status). */
  refreshCamp(): void {
    this.camp.update(this.lastRoster, this.focusing);
  }

  /** E (no seat near): feed the one the bubble points at. */
  feedNearest(): boolean {
    if (!this.target || this.focusing) return false;
    this.feedTarget();
    return true;
  }

  /**
   * An original's skill key (J, R, X, Z): its own three in turn, then its open Level 2 ones.
   * Returns what the key should do: 'native' (the original's own code), or 'done' (a Level 2
   * recipe started, or nothing possible).
   */
  originalKey(id: string): 'native' | 'done' {
    const pet = this.pet(id);
    if (!pet) return 'native';
    const l2 = openSkills(pet).filter((i) => i >= 3);
    if (l2.length === 0) return 'native';
    const n = 3 + l2.length;
    const step = (this.cycle.get(id) ?? 0) % n;
    if (step < 3) {
      if (this.host.originalNative(id)) this.cycle.set(id, step + 1);
      return 'done';
    }
    if (this.castRecipe(pet, l2[step - 3])) this.cycle.set(id, (step + 1) % n);
    return 'done';
  }

  update(dt: number): void {
    const focusing = this.host.focusing();
    if (focusing !== this.focusing) {
      this.focusing = focusing;
      this.camp.update(this.lastRoster, focusing);
    }
    this.toss.update(dt);
    this.recipes.update(dt);
    this.ceremonies.update(dt);
    const walking = this.host.you(this.you);
    const wind = this.host.wind();
    for (const a of this.actors.values()) a.update(dt, walking ? this.you : null, wind);
    for (const ring of this.auras.values()) spinAura(ring, dt);
    this.applyOriginalLooks();
    this.pointer.update();
    this.updateBubble(walking, dt);
  }

  // ---- The feeding bubble ----

  private updateBubble(walking: boolean, dt: number): void {
    const prev = this.target;
    // Who is nearest changes slowly: looked for five times a second, followed every frame.
    this.lookIn -= dt;
    if (this.lookIn <= 0 || !walking || this.focusing) {
      this.lookIn = 0.2;
      this.target = walking && !this.focusing ? this.findTarget() : null;
    } else if (this.target) {
      this.follow(this.target);
    }
    // Walked away from one that asked, without feeding it: it won't ask again for a while.
    if (prev && (!this.target || this.keyOf(prev) !== this.keyOf(this.target))) {
      this.askedUntil.set(this.keyOf(prev), Date.now() + ASK_AGAIN_MS);
    }
    const t = this.target;
    if (!t) {
      this.bubble.hide();
      return;
    }
    this.tmp.set(t.x, t.y + 0.25, t.z).project(this.host.camera);
    if (this.tmp.z > 1 || Math.abs(this.tmp.x) > 1.1 || Math.abs(this.tmp.y) > 1.1) {
      this.bubble.hide();
      return;
    }
    const rect = this.host.renderer.domElement.getBoundingClientRect();
    const sx = rect.left + ((this.tmp.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - this.tmp.y) / 2) * rect.height;
    const r = this.lastRoster;
    if ('pet' in t) {
      const p = this.pet(t.pet);
      if (!p) return;
      const sub = r.balance < 1 ? vi.pets.bubbleEmpty : p.need > 0 ? `${vi.pets.rankLine(p.level, p.rank)} · ${vi.pets.expLine(p.into, p.need)}` : p.level === 1 ? vi.pets.expEvolve : vi.pets.expMax;
      this.bubble.show(vi.pets.bubble(p.name), sub, sx, sy);
    } else {
      const kind = t.wild.kind;
      const sub = r.balance < 1 ? vi.pets.bubbleEmpty : vi.pets.trust(SPECIES[kind].name, r.trust[kind], TRUST_NEEDED);
      this.bubble.show(vi.pets.bubbleWild(SPECIES[kind].name), sub, sx, sy);
    }
  }

  private lookIn = 0;

  /** Between searches: the target's head moves with it. */
  private follow(t: Target): void {
    if ('wild' in t) {
      t.x = t.wild.x;
      t.y = t.wild.y;
      t.z = t.wild.z;
      return;
    }
    const a = this.actors.get(t.pet);
    if (a) {
      a.headTop(this.tmp);
      t.x = this.tmp.x;
      t.y = this.tmp.y;
      t.z = this.tmp.z;
      return;
    }
    this.spots.length = 0;
    this.host.originalSpots(this.spots);
    for (const s of this.spots) {
      if (s.id !== t.pet) continue;
      t.x = s.x;
      t.y = s.y;
      t.z = s.z;
    }
  }

  private keyOf(t: Target): string {
    return 'pet' in t ? t.pet : `wild:${t.wild.kind}`;
  }

  /** The nearest pet (or wild one) in reach and in view that may ask now. */
  private findTarget(): Target | null {
    const now = Date.now();
    const you = this.you;
    const cam = this.host.camera;
    cam.getWorldDirection(this.tmp2);
    let best: Target | null = null;
    let bestD = Infinity;
    const consider = (t: Target): void => {
      const d = Math.hypot(t.x - you.x, t.z - you.z);
      if (d > t.reach || d >= bestD) return;
      // In front of the camera.
      this.tmp.set(t.x - cam.position.x, t.y - cam.position.y, t.z - cam.position.z).normalize();
      if (this.tmp.dot(this.tmp2) < 0.35) return;
      const until = this.askedUntil.get(this.keyOf(t)) ?? 0;
      // The one already asking keeps asking.
      if (until > now && !(this.target && this.keyOf(this.target) === this.keyOf(t))) return;
      best = t;
      bestD = d;
    };
    this.spots.length = 0;
    this.host.originalSpots(this.spots);
    for (const s of this.spots) consider({ pet: s.id, x: s.x, y: s.y, z: s.z, reach: s.id === 'bemap' ? PET_REACH + 1.5 : PET_REACH });
    for (const a of this.actors.values()) {
      a.headTop(this.tmp);
      consider({ pet: a.petId, x: this.tmp.x, y: this.tmp.y, z: this.tmp.z, reach: PET_REACH });
    }
    this.watchers.length = 0;
    this.host.wildWatchers(this.watchers);
    for (const w of this.watchers) consider({ wild: w, x: w.x, y: w.y, z: w.z, reach: WILD_REACH });
    return best;
  }

  private feedTarget(): void {
    const t = this.target;
    if (!t || this.focusing) return;
    if ('pet' in t) this.feed(t.pet, t);
    else this.feedWildOne(t.wild);
  }

  // ---- Actions ----

  private feed(petId: string, at: Target | null): void {
    if (this.focusing) {
      this.camp.say(vi.pets.focusLocked);
      return;
    }
    const before = this.pet(petId);
    const a = this.host.wallet.act((r) => feedPet(r, petId, Date.now()));
    if (!a.ok) {
      this.refuse(a.why);
      return;
    }
    this.bubble.pop();
    const after = this.pet(petId);
    const land = (): void => {
      this.landOn(petId);
      if (before && after) this.rankEffects(before, after);
    };
    const spot = at ?? this.spotOf(petId);
    if (spot && this.host.you(this.you)) {
      this.from.set(this.you.x, this.you.y + 1.2, this.you.z);
      this.to.set(spot.x, spot.y, spot.z);
      if (this.toss.toss(this.from, this.to, land)) return;
    }
    land();
  }

  private feedWildOne(w: WildTarget): void {
    const a = this.host.wallet.act((r) => feedWild(r, w.kind, Date.now()));
    if (!a.ok) {
      this.refuse(a.why);
      return;
    }
    this.bubble.pop();
    this.host.you(this.you);
    this.from.set(this.you.x, this.you.y + 1.2, this.you.z);
    this.to.set(w.x, w.y, w.z);
    const land = (): void => {
      this.host.pop();
      w.fed();
      const r = this.host.wallet.roster;
      const trust = r.trust[w.kind];
      if (trust < TRUST_NEEDED) {
        this.host.note(vi.pets.trustUp(trust, TRUST_NEEDED));
        return;
      }
      const b = this.host.wallet.act((rr) => befriend(rr, w.kind, Date.now()));
      if (!b.ok) return;
      w.join();
      const id = b.event.pet ?? '';
      const p = this.pet(id);
      if (p) {
        this.host.skillCard(vi.pets.befriended(p.name, SPECIES[p.species].name), SPECIES[p.species].element);
        this.spawnAt.set(id, { x: w.x, z: w.z });
      }
    };
    if (!this.toss.toss(this.from, this.to, land)) land();
  }

  /** Where a new pet first appears (befriended or hatched): else at the camp. */
  private readonly spawnAt = new Map<string, { x: number; z: number }>();

  private landOn(petId: string): void {
    this.host.pop();
    const spot = this.spotOf(petId);
    if (spot) {
      this.tmp.set(spot.x, spot.y, spot.z);
      this.host.hearts(this.tmp);
      this.host.hearts(this.tmp);
    }
    const actor = this.actors.get(petId);
    if (actor) actor.cheer();
    else this.host.originalCheer(petId);
  }

  /** Rank up: a sparkle and its card; a new skill: its own card. */
  private rankEffects(before: Pet, after: Pet): void {
    if (after.rank <= before.rank) return;
    const sp = SPECIES[after.species];
    const spot = this.spotOf(after.id);
    if (spot) {
      this.host.fx.flash(spot.x, spot.y, spot.z, ELEMENT_COLOR[sp.element], 40, 4, 0.3);
      const pools = this.host.pools();
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2;
        pools.rainbow.emit(spot.x, spot.y, spot.z, Math.cos(a) * 1.5, 1 + Math.random() * 1.5, Math.sin(a) * 1.5, 0.035);
      }
    }
    const was = new Set(openSkills(before));
    const learned = openSkills(after).find((i) => !was.has(i));
    if (learned !== undefined) this.host.skillCard(vi.pets.learned(after.name, sp.skills[learned]), sp.element);
    else this.host.skillCard(vi.pets.rankUp(after.name, after.rank), sp.element);
  }

  private evolve(petId: string): void {
    if (this.focusing) return;
    // Keep the old look until the flash (set before the change: it rebuilds at once otherwise).
    this.holdLook.add(petId);
    const a = this.host.wallet.act((r) => evolvePet(r, petId, Date.now()));
    const p = this.pet(petId);
    if (!a.ok || !p) {
      this.holdLook.delete(petId);
      if (!a.ok) this.refuse(a.why);
      return;
    }
    const sp = SPECIES[p.species];
    const spot = this.spotOf(petId) ?? { x: this.host.camp.x, y: this.host.heightAt(this.host.camp.x, this.host.camp.z), z: this.host.camp.z };
    this.ceremonies.evolve(spot.x, spot.y - 0.3, spot.z, ELEMENT_COLOR[sp.element], () => {
      this.holdLook.delete(petId);
      this.refresh();
      this.host.skillCard(vi.pets.evolved(p.name), sp.element);
    });
  }

  /** Pets whose new look waits for their ceremony's flash. */
  private readonly holdLook = new Set<string>();

  private buyEgg(tier: EggTier): void {
    if (this.focusing) return;
    this.result(this.host.wallet.act((r) => buyEgg(r, tier, Date.now())));
  }

  private hatch(eggId: string): void {
    if (this.focusing) return;
    const egg = this.lastRoster.eggs.find((g) => g.id === eggId);
    const id = hatchedId(eggId);
    // Not on the island before the egg bursts.
    this.holdLook.add(id);
    const a = this.host.wallet.act((r) => hatchEgg(r, eggId, Date.now()));
    if (!a.ok || !egg) {
      this.holdLook.delete(id);
      if (!a.ok) this.refuse(a.why);
      return;
    }
    // In front of you while walking, else at the camp.
    let x = this.host.camp.x;
    let z = this.host.camp.z;
    if (this.host.you(this.you)) {
      x = this.you.x + Math.sin(this.you.yaw) * 2.2;
      z = this.you.z + Math.cos(this.you.yaw) * 2.2;
    }
    const y = Math.max(0, this.host.heightAt(x, z));
    this.spawnAt.set(id, { x, z });
    const sp = SPECIES[egg.species];
    this.ceremonies.hatch(x, y, z, ELEMENT_COLOR[sp.element], egg.shiny, () => {
      this.holdLook.delete(id);
      this.refresh();
      const p = this.pet(id);
      if (p) this.host.skillCard((p.shiny ? vi.pets.hatchedShiny : vi.pets.hatched)(p.name, sp.name), sp.element);
    });
  }

  private toggleTeam(petId: string): void {
    const team = [...this.lastRoster.team];
    const i = team.indexOf(petId);
    if (i >= 0) team.splice(i, 1);
    else if (team.length < TEAM_MAX) team.push(petId);
    this.result(this.host.wallet.act((r) => setTeam(r, team, Date.now())));
  }

  /** A skill chip in the camp, or a tap on a new pet: that pet uses the skill. */
  private castSkill(petId: string, index: number): void {
    const p = this.pet(petId);
    if (!p || !openSkills(p).includes(index)) return;
    if (p.origin === 'original' && index < 3) {
      if (!this.host.originalNative(petId)) this.camp.say(vi.pets.notHere(p.name));
      return;
    }
    if (!this.castRecipe(p, index)) this.camp.say(vi.pets.notHere(p.name));
  }

  private tapActor(a: PetActor): void {
    const p = this.pet(a.petId);
    if (!p || a.busy) return;
    const open = openSkills(p);
    const i = (this.cycle.get(p.id) ?? 0) % open.length;
    if (this.castRecipe(p, open[i])) this.cycle.set(p.id, i + 1);
  }

  /** Starts one of a pet's recipe skills where it is; false if it isn't on the island now. */
  private castRecipe(p: Pet, index: number): boolean {
    const name = SPECIES[p.species].skills[index];
    if (!hasRecipe(name) || this.recipes.busy) return false;
    const sp = SPECIES[p.species];
    const actor = this.actors.get(p.id);
    let caster: Caster;
    if (actor) {
      caster = actor.caster;
      actor.casting(recipeLength(name));
    } else if (this.host.originalCaster(p.id, this.caster)) {
      caster = { ...this.caster };
    } else {
      return false;
    }
    this.recipes.cast(name, caster, sp.element, skillPower(p.rank));
    this.host.skillCard(`${p.name}: ${name}`, sp.element);
    return true;
  }

  // ---- Keeping the island in step with the roster ----

  private refresh(): void {
    const r = this.host.wallet.roster;
    this.lastRoster = r;
    this.camp.update(r, this.focusing);
    // New pets out on the island: the team.
    const want = new Set(r.team);
    for (const [id, actor] of this.actors) {
      if (!want.has(id)) {
        this.host.scene.remove(actor.body.root);
        this.actors.delete(id);
        this.auras.delete(id);
      }
    }
    r.team.forEach((id, slot) => {
      const p = r.pets.find((x) => x.id === id);
      if (!p || this.holdLook.has(id)) return;
      const actor = this.actors.get(id);
      if (actor) actor.slot = slot;
      if ((!actor || this.builtLevel.get(id) !== p.level) && !this.loading.has(id)) void this.build(p, slot);
    });
  }

  /** Makes (or remakes, at Level 2) a new pet's model and puts it on the island. */
  private async build(p: Pet, slot: number): Promise<void> {
    this.loading.add(p.id);
    try {
      const look = { seed: p.seed, shiny: p.shiny, level: p.level };
      let body: PetBody;
      if (p.species === 'crab' || p.species === 'dragon' || p.species === 'bunny') {
        body = await this.host.loadWild(p.species);
        tintModel(body.root, look);
        if (p.level === 2) this.auras.set(p.id, applyLevel2(body.root, SPECIES[p.species].element, 0.7));
      } else {
        body = buildBody(p.species, look);
        if (p.level === 2) this.auras.set(p.id, applyLevel2(body.root, SPECIES[p.species].element, 0.6));
      }
      await this.host.renderer.compileAsync(body.root, this.host.camera, this.host.scene);
      // Still wanted (not sent home meanwhile)?
      if (!this.host.wallet.roster.team.includes(p.id)) return;
      const old = this.actors.get(p.id);
      if (old) {
        this.host.scene.remove(old.body.root);
        old.setBody(body);
      } else {
        const start = this.spawnAt.get(p.id) ?? this.host.camp;
        this.spawnAt.delete(p.id);
        this.actors.set(p.id, new PetActor(p.id, body, { heightAt: this.host.heightAt }, this.host.camp, slot, start));
      }
      this.host.scene.add(body.root);
      this.builtLevel.set(p.id, p.level);
    } catch (err) {
      console.warn('pet model failed', err);
    } finally {
      this.loading.delete(p.id);
    }
  }

  /** The originals at Level 2 get their look as soon as their model is there. */
  private applyOriginalLooks(): void {
    for (const p of this.lastRoster.pets) {
      if (p.origin !== 'original' || p.level !== 2 || this.holdLook.has(p.id) || this.auras.has(p.id)) continue;
      const root = this.host.originalRoot(p.id);
      if (!root) continue;
      this.auras.set(p.id, applyLevel2(root, SPECIES[p.species].element, p.species === 'dog' ? 0.9 : 0.75));
    }
  }

  // ---- Helpers ----

  private pet(id: string): Pet | undefined {
    return this.host.wallet.roster.pets.find((p) => p.id === id);
  }

  /** Where a pet's head is now (original or new), if it is on the island. */
  private spotOf(id: string): { x: number; y: number; z: number } | null {
    const a = this.actors.get(id);
    if (a) {
      a.headTop(this.tmp);
      return { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z };
    }
    this.spots.length = 0;
    this.host.originalSpots(this.spots);
    const s = this.spots.find((x) => x.id === id);
    return s ? { x: s.x, y: s.y, z: s.z } : null;
  }

  private result(a: Action): void {
    if (!a.ok) this.refuse(a.why);
  }

  private refuse(why: Refusal): void {
    const text = why === 'tomatoes' ? vi.pets.noTomato : why === 'evolve' ? vi.pets.needEvolve : why === 'cap' ? vi.pets.maxed : why === 'team' ? vi.pets.outFull(TEAM_MAX) : '';
    if (!text) return;
    this.camp.say(text);
    if (this.target) this.host.note(text);
  }
}
