import * as THREE from 'three';
import type { DogCompanion } from './dogCompanion';
import type { SkillFxSink } from '../world/creatures/skillFx';
import type { EmberSink } from '../world/creatures/embers';
import type { Lightning } from '../world/creatures/lightning';
import type { Scorcher } from '../world/scorch';

/** Mochi's skills, in the order J cycles through them. */
export type DogSkill = 'zoom' | 'bark' | 'zap';
const SKILLS: readonly DogSkill[] = ['zoom', 'bark', 'zap'];

/**
 * "Sonic Bark": it braces (`windup` s), then one huge bark: rings of sound race out `reach` m;
 * you are knocked over within `knock` m (on foot), creatures within it jump.
 */
const BARK = { windup: 0.4, time: 1.5, reach: 10, knock: 8, rings: 3 } as const;
/**
 * "Lightning Strike": it crouches charging (`charge` s, sparks crawling over it), then `strikes` bolts,
 * `every` s apart, at whatever is near within `reach` m (you, palms, rocks, the house, the other
 * creatures, the sea): each scorched black and smoking for `burn` s.
 */
const ZAP = { charge: 0.9, strikes: 4, every: 0.38, reach: 13, burn: 5 } as const;

/** Something lightning can strike: a point, what it is, and its body to scorch (if any). */
export interface StrikeTarget {
  x: number;
  y: number;
  z: number;
  kind: 'you' | 'tree' | 'rock' | 'house' | 'creature' | 'sea';
  body: THREE.Object3D | null;
  /** It was struck (a creature reacts). */
  hit?: () => void;
}

export interface DogSkillHost {
  dog(): DogCompanion | null;
  /** Mochi's head (world), for the bark and the bolts to leave from. */
  head(out: THREE.Vector3): THREE.Vector3 | null;
  /** You, on foot on land (feet), else null. */
  player(): { x: number; y: number; z: number } | null;
  knockDown(fromX: number, fromZ: number): boolean;
  /** What a bolt from (x, z) may strike, within r m (fills `out`). */
  targets(x: number, z: number, r: number, out: StrikeTarget[]): void;
  /** Creatures within r m of (x, z) are startled (the bark). */
  startle(x: number, z: number, r: number): void;
  heightAt(x: number, z: number): number;
  ripple(x: number, z: number, radius: number, strength: number): void;
  fx: SkillFxSink;
  lightning: Lightning;
  scorch: Scorcher;
  /** Yellow sparks (rainbow motes with a gold hue), soot, and pale dust (steam puffs). */
  sparks: EmberSink;
  smoke: EmberSink;
  dust: EmberSink;
  /** Its name card. */
  card(skill: DogSkill): void;
}

/** A point still smoking after a strike: where, and for how long yet (s). */
interface Smoulder {
  x: number;
  y: number;
  z: number;
  left: number;
}

/**
 * Mochi's three skills: "Shooting Star" (its zoomies, in DogCompanion), "Sonic Bark" (a bark
 * that knocks you over) and "Lightning Strike" (lightning, like a Pikachu). J starts the next one; a
 * pat sometimes starts one at random. This runs the bark's and the lightning's timelines on
 * top of the dog standing its ground (DogCompanion.act) and asks the shared effects for the rest.
 */
export class DogSkills {
  private nextSkill = 0;
  private skill: DogSkill | null = null;
  private t = 0;
  private struck = 0;
  private crawlIn = 0;
  private readonly head = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private readonly list: StrikeTarget[] = [];
  private readonly smoulders: Smoulder[] = [];
  private smokeDebt = 0;

  constructor(private readonly host: DogSkillHost) {}

  /** A skill under way (the zoomies count: DogCompanion.busy). */
  get busy(): boolean {
    return this.skill !== null || (this.host.dog()?.busy ?? false);
  }

  /** J: the next skill. Returns it, or null (busy, or Mochi isn't there; `zoom` may still find no room: 'noRoom'). */
  next(zoomies: () => boolean): DogSkill | 'noRoom' | null {
    if (this.busy || !this.host.dog()) return null;
    const s = SKILLS[this.nextSkill];
    this.nextSkill = (this.nextSkill + 1) % SKILLS.length;
    return this.start(s, zoomies) ? s : 'noRoom';
  }

  /** A pat: now and then one of its skills at random (`chance`); true if one started. */
  maybeOnPat(chance: number, zoomies: () => boolean): boolean {
    if (this.busy || Math.random() >= chance) return false;
    // The zoomies need room: the others are tried if it has none.
    const order = [...SKILLS].sort(() => Math.random() - 0.5);
    for (const s of order) if (this.start(s, zoomies)) return true;
    return false;
  }

  /** Joining another creature's skill (a combo): its lightning, unless it is busy. */
  join(): boolean {
    return !this.busy && this.start('zap', () => false);
  }

  private start(s: DogSkill, zoomies: () => boolean): boolean {
    const h = this.host;
    const dog = h.dog();
    if (!dog) return false;
    if (s === 'zoom') {
      if (!zoomies()) return false;
      h.card('zoom');
      return true;
    }
    const you = h.player();
    // It faces you (or the way it already faces when you aren't about).
    const fx = you ? you.x : dog.x + Math.sin(dog.yaw);
    const fz = you ? you.z : dog.z + Math.cos(dog.yaw);
    const time = s === 'bark' ? BARK.time : ZAP.charge + ZAP.strikes * ZAP.every + 0.5;
    if (!dog.act(time, fx, fz, s === 'bark' ? 'idle' : 'sniff')) return false;
    this.skill = s;
    this.t = 0;
    this.struck = 0;
    this.crawlIn = 0;
    h.card(s);
    h.fx.sound('charge', s === 'bark' ? 0.3 : 0.8, dog.x, dog.y, dog.z);
    h.fx.focus(dog.x, dog.y + 0.5, dog.z, time + 0.6);
    return true;
  }

  update(dt: number): void {
    this.updateSmoke(dt);
    const s = this.skill;
    if (!s) return;
    const h = this.host;
    const dog = h.dog();
    if (!dog || !h.head(this.head)) {
      this.skill = null;
      return;
    }
    const t0 = this.t;
    this.t += dt;
    if (s === 'bark') {
      if (t0 < BARK.windup && this.t >= BARK.windup) this.bark(dog);
      if (this.t >= BARK.time) this.skill = null;
      return;
    }
    if (this.t < ZAP.charge) {
      this.crawl(dt);
      return;
    }
    while (this.struck < ZAP.strikes && this.t >= ZAP.charge + this.struck * ZAP.every) {
      this.strike(dog);
      this.struck++;
    }
    if (this.t >= ZAP.charge + ZAP.strikes * ZAP.every + 0.5) this.skill = null;
  }

  /** The bark: rings of sound racing out on the ground and in the air, you knocked over, the sea rippling. */
  private bark(dog: DogCompanion): void {
    const h = this.host;
    const g = Math.max(0, h.heightAt(dog.x, dog.z));
    h.fx.sound('sonic', 1, dog.x, g, dog.z);
    for (let i = 0; i < BARK.rings; i++) {
      h.fx.shock(dog.x, g, dog.z, 'energy', 0xbfe8ff, BARK.reach * (1 - i * 0.18), 0.8 + i * 0.25, 1.4 - i * 0.35);
    }
    h.fx.shock(this.head.x, this.head.y, this.head.z, 'energy', 0xe6f6ff, BARK.reach * 0.6, 0.6);
    h.fx.shake(dog.x, g, dog.z, 0.65, 0.8);
    // Sand and spray thrown up all round.
    for (let i = 0; i < 80; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 1.5;
      h.dust.emit(dog.x + Math.cos(a) * r, g + 0.1, dog.z + Math.sin(a) * r, Math.cos(a) * 3, 0.4 + Math.random() * 0.6, Math.sin(a) * 3, 0.15 + Math.random() * 0.15);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = dog.x + Math.cos(a) * BARK.reach * 0.6;
      const z = dog.z + Math.sin(a) * BARK.reach * 0.6;
      if (h.heightAt(x, z) < 0) h.ripple(x, z, 1.5, -0.5);
    }
    const you = h.player();
    if (you && Math.hypot(you.x - dog.x, you.z - dog.z) < BARK.knock) h.knockDown(dog.x, dog.z);
    h.startle(dog.x, dog.z, BARK.knock);
  }

  /** Charging: little arcs crawling over its back, gold sparks spitting off. */
  private crawl(dt: number): void {
    const h = this.host;
    this.crawlIn -= dt;
    if (this.crawlIn > 0) return;
    this.crawlIn = 0.07;
    const c = this.head;
    const k = this.t / ZAP.charge;
    for (let i = 0; i < 1 + Math.round(2 * k); i++) {
      this.from.set(c.x + (Math.random() - 0.5) * 0.5, c.y - 0.15 + Math.random() * 0.3, c.z + (Math.random() - 0.5) * 0.5);
      this.to.set(this.from.x + (Math.random() - 0.5) * 0.6, this.from.y + (Math.random() - 0.3) * 0.4, this.from.z + (Math.random() - 0.5) * 0.6);
      h.lightning.strike(this.from, this.to, 0.09, 0.05 + 0.04 * k);
    }
    for (let i = 0; i < 6; i++) {
      h.sparks.emit(c.x, c.y, c.z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.03 + Math.random() * 0.03, 0.13 + Math.random() * 0.05);
    }
    if (Math.random() < 0.4) h.fx.sound('zap', 0.1, c.x, c.y, c.z);
  }

  /** One bolt at something near, picked at random: flash, crack of thunder, scorch, smoke. */
  private strike(dog: DogCompanion): void {
    const h = this.host;
    this.list.length = 0;
    h.targets(dog.x, dog.z, ZAP.reach, this.list);
    if (this.list.length === 0) return;
    // You are a likelier target (it is your dog showing off).
    const you = this.list.find((x) => x.kind === 'you');
    const t = you && Math.random() < 0.35 ? you : this.list[Math.floor(Math.random() * this.list.length)];
    this.from.copy(this.head);
    this.from.y += 0.15;
    this.to.set(t.x, t.y, t.z);
    h.lightning.strike(this.from, this.to, 0.45, 0.26);
    // A second, thinner stroke along nearly the same path (the eye sees the restrike).
    h.lightning.strike(this.from, this.to, 0.3, 0.12);
    const ground = Math.max(0, h.heightAt(t.x, t.z));
    h.fx.flash(t.x, t.y + 0.5, t.z, 0xfff0a0, 150, 16, 0.3);
    // (No wall round you or a creature: up close it would fill the view.)
    const near = t.kind === 'you' || t.kind === 'creature';
    h.fx.shock(t.x, ground, t.z, 'spark', 0xffe680, t.kind === 'sea' ? 5 : near ? 2 : 2.8, 0.6, t.kind === 'sea' ? 0.8 : near ? 0 : 0.5);
    h.fx.shake(t.x, t.y, t.z, 0.35, 0.35);
    h.fx.sound('thunder', 0.5, t.x, t.y, t.z);
    h.fx.sound('zap', 0.6, t.x, t.y, t.z);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 1 + Math.random() * 4;
      const c = Math.random();
      h.sparks.emit(t.x, t.y, t.z, Math.cos(a) * v * (1 - c * 0.5), c * v + 1, Math.sin(a) * v * (1 - c * 0.5), 0.03 + Math.random() * 0.04, 0.12 + Math.random() * 0.06);
    }
    if (t.kind === 'sea') {
      h.ripple(t.x, t.z, 2.5, -1);
      return;
    }
    h.fx.mark(t.x, ground, t.z, t.kind === 'you' || t.kind === 'creature' ? 0.7 : 1.1, ZAP.burn + 3);
    if (t.body) h.scorch.burn(t.body, ZAP.burn);
    this.smoulders.push({ x: t.x, y: t.y, z: t.z, left: ZAP.burn * 0.6 });
    t.hit?.();
  }

  /** What was struck smokes for a while, thinning out. */
  private updateSmoke(dt: number): void {
    if (this.smoulders.length === 0) return;
    this.smokeDebt += dt * 14;
    const n = Math.floor(this.smokeDebt);
    this.smokeDebt -= n;
    for (let i = this.smoulders.length - 1; i >= 0; i--) {
      const s = this.smoulders[i];
      s.left -= dt;
      if (s.left <= 0) {
        this.smoulders.splice(i, 1);
        continue;
      }
      for (let k = 0; k < n; k++) {
        if (Math.random() > s.left / 2) continue;
        this.host.smoke.emit(s.x + (Math.random() - 0.5) * 0.3, s.y + Math.random() * 0.3, s.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2, 0.12 + Math.random() * 0.1);
      }
    }
  }
}
