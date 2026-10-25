import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';
import type { BubbleSink } from '../world/creatures/airBubbles';
import type { EmberSink } from '../world/creatures/embers';
import type { TrunkInstance } from '../world/vegetation/forest';
import type { CrabModel } from '../world/creatures/crabModel';
import type { DragonModel } from '../world/creatures/dragonModel';
import type { BunnyModel } from '../world/creatures/bunnyModel';

/** How many of each kind can be out at once (models are loaded once, then reused). */
const PER_KIND = 2;
/** You are "in the forest" with at least this many trunks within FOREST_R m. */
const FOREST_TREES = 6;
const FOREST_R = 8;
/** Where one may show up: a trunk this far from you (m), within this angle of where you look. */
const NEAR = 5;
const FAR = 11;
const VIEW = 1.2;
/** Seconds between appearances (random in the range). */
const GAP = [2.5, 7] as const;
/** Timeline (s): stepping out from behind the trunk, watching you, slipping back. */
const EMERGE = 0.9;
const WATCH = [2.5, 5.5] as const;
const RETREAT = 0.8;
const VANISH = 0.3;
/** Come nearer than this (m) and it startles and vanishes. */
const SHY = 3.5;
/**
 * Ambushes (attacks on): one out watching you now and then attacks instead, this often (s,
 * random in the range) while you are in the forest. The wind-up (s: it glows and calls) gives
 * you time to run, and Mochi time to come between; then it stays and fights (activities/
 * ambush.ts) until it is driven off, wins, or `linger` s have gone by.
 */
const AMBUSH = { every: [10, 20], windup: 0.8, linger: 30 } as const;
/** Driven off: it flashes, shrinks and is gone in a burst of sparkles (s). */
const BANISH = 0.45;

export type WildKind = 'crab' | 'dragon' | 'bunny';
type Kind = WildKind;
const KINDS: Kind[] = ['crab', 'dragon', 'bunny'];
type Action = 'idle' | 'move' | 'skill' | 'greet' | 'dance';
type State = 'emerge' | 'watch' | 'retreat' | 'vanish' | 'windup' | 'taunt' | 'banish';

/** A wild one that has just attacked: where it is, and a way to drive it off. */
export interface Attacker {
  kind: WildKind;
  /** Its head (world), where its attack leaves from. */
  x: number;
  y: number;
  z: number;
  /** Gone (driven off, or it slipped away). */
  readonly gone: boolean;
  /** Driven off: a flash, sparkles, gone. */
  banish(): void;
  /** Its attack pose for a moment (as it throws a shot). */
  cast(): void;
  /** It won (or gave up): a little dance, then back behind its trunk. */
  leave(): void;
}

/** One wild creature's model, whatever its kind. */
interface Wild {
  kind: Kind;
  root: THREE.Group;
  /** Rough height of its head above its root (m), for the element puffs. */
  head: number;
  animate(dt: number, action: Action, speed: number, wind: number): void;
  busy: boolean;
}

interface Encounter {
  w: Wild;
  state: State;
  t: number;
  watch: number;
  /** Hidden behind the trunk → peeking beside it (world). */
  hx: number;
  hz: number;
  px: number;
  pz: number;
  y: number;
  flourished: boolean;
  greeted: boolean;
  /** As an attacker (once it has attacked); since its last shot (s). */
  attacker: Attacker | null;
  castT: number;
}

export interface WildHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  shared: SharedUniforms;
  heightAt(x: number, z: number): number;
  trunks: readonly TrunkInstance[];
  treesNear(x: number, z: number, r: number): number;
  bubbles: BubbleSink;
  embers: EmberSink;
  spores: EmberSink;
  /** A creature's call at (x, y, z). */
  voice(kind: Kind, x: number, y: number, z: number): void;
  /** Loads `count` copies of each kind (once, on first need). */
  load(count: number): Promise<{ crabs: CrabModel[]; dragons: DragonModel[]; bunnies: BunnyModel[] }>;
  /** Compiles the models' shaders before they first show. */
  compile(root: THREE.Object3D): Promise<unknown>;
  /** An ambush is coming from it (Mochi steps up), then it attacks (the fight: activities/ambush.ts). */
  windup(a: Attacker): void;
  attack(a: Attacker): void;
  /** Driven off at (x, y, z): the flash and the sparkles. */
  banished(kind: WildKind, x: number, y: number, z: number): void;
}

const tmpF = new THREE.Vector3();

/**
 * Wild Bọt, Hỏa Long and Mầm in the rainforest: walk into the trees and, every few seconds, one
 * of them peeks out from behind a trunk in front of you (up to 1–3 at once, picked again each
 * time you enter), watches you, shows its element (bubbles, embers, pollen), then slips back
 * behind the trunk and is gone. Come too close and it startles and vanishes in a puff. Leave the
 * forest and they all hide. Models are loaded on the first visit (two of each kind, skeleton
 * clones of one load) and reused; hidden ones cost nothing.
 */
export class WildCreatures {
  private enabled = false;
  private loading = false;
  private pool: Wild[] | null = null;
  private readonly active: Encounter[] = [];
  private gap = 1.5;
  private wasInForest = false;
  /** How many may be out at once during this visit (1–3). */
  private limit = 2;
  /** Ambushes: on, and the next in (s). */
  private attacks = false;
  private ambushIn = 0;

  constructor(private readonly host: WildHost) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) for (const e of this.active) this.startVanish(e, false);
  }

  /** Whether they attack you (and Mochi) now and then. */
  setAttacks(on: boolean): void {
    this.attacks = on;
  }

  /** In the forest with them about (the health bars show). */
  get inForest(): boolean {
    return this.wasInForest;
  }

  private between(r: readonly [number, number]): number {
    return r[0] + Math.random() * (r[1] - r[0]);
  }

  /** `you`: where you walk (feet), or null when not walking about. */
  update(dt: number, you: { x: number; y: number; z: number } | null): void {
    const inForest = this.enabled && you !== null && this.host.treesNear(you.x, you.z, FOREST_R) >= FOREST_TREES;
    if (inForest && !this.pool && !this.loading) this.loadPool();
    if (inForest && !this.wasInForest) {
      this.limit = 1 + Math.floor(Math.random() * 3);
      this.gap = 1 + Math.random() * 2;
      this.ambushIn = this.between(AMBUSH.every);
    }
    this.wasInForest = inForest;
    // An ambush: one of those out watching you winds up an attack.
    if (inForest && this.attacks && !this.active.some((e) => e.state === 'windup' || e.state === 'taunt')) {
      this.ambushIn -= dt;
      const watcher = this.ambushIn <= 0 ? this.active.find((e) => e.state === 'watch') : undefined;
      if (watcher) {
        this.go(watcher, 'windup');
        this.host.voice(watcher.w.kind, watcher.px, watcher.y, watcher.pz);
        this.host.windup(this.attackerOf(watcher));
        this.ambushIn = this.between(AMBUSH.every);
      }
    }

    if (inForest && you && this.pool) {
      this.gap -= dt;
      if (this.gap <= 0 && this.active.length < this.limit) {
        this.gap = GAP[0] + Math.random() * (GAP[1] - GAP[0]);
        this.spawn(you);
      }
    }
    const wind = this.host.shared.uWind.value;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      if (!this.step(e, dt, inForest ? you : null, wind)) {
        e.w.root.visible = false;
        e.w.busy = false;
        this.active.splice(i, 1);
      }
    }
  }

  /** Advances one encounter; false when it is over. */
  private step(e: Encounter, dt: number, you: { x: number; y: number; z: number } | null, wind: number): boolean {
    e.t += dt;
    const w = e.w;
    let x = e.px;
    let z = e.pz;
    let scale = 1;
    let action: Action = 'idle';
    let speed = 0;
    let face = Math.atan2(e.px - e.hx, e.pz - e.hz);
    const d = you ? Math.hypot(you.x - e.px, you.z - e.pz) : Infinity;
    // Startled, or you have left the forest: gone (an attacker stands its ground, unless you leave).
    const fighting = e.state === 'windup' || e.state === 'taunt' || e.state === 'banish';
    if ((!you || (d < SHY && !fighting)) && e.state !== 'vanish' && e.state !== 'banish') this.startVanish(e, d < SHY);

    switch (e.state) {
      case 'emerge': {
        const k = Math.min(1, e.t / EMERGE);
        const s = k * k * (3 - 2 * k);
        x = e.hx + (e.px - e.hx) * s;
        z = e.hz + (e.pz - e.hz) * s;
        scale = Math.min(1, 0.4 + k * 1.5);
        action = 'move';
        speed = 0.5;
        if (k >= 1) this.go(e, 'watch');
        break;
      }
      case 'watch':
        if (you) face = Math.atan2(you.x - e.px, you.z - e.pz);
        action = e.t < 1.2 ? 'greet' : 'idle';
        if (!e.greeted) {
          e.greeted = true;
          this.host.voice(w.kind, e.px, e.y, e.pz);
        }
        // Halfway through, a little show of its element.
        if (!e.flourished && e.t > e.watch * 0.5) {
          e.flourished = true;
          this.puff(w, e.px, e.y, e.pz, 14, 0.6);
          if (w.kind !== 'crab') action = 'dance';
        }
        if (e.t >= e.watch) this.go(e, 'retreat');
        break;
      case 'retreat': {
        const k = Math.min(1, e.t / RETREAT);
        const s = k * k * (3 - 2 * k);
        x = e.px + (e.hx - e.px) * s;
        z = e.pz + (e.hz - e.pz) * s;
        face = Math.atan2(e.hx - e.px, e.hz - e.pz);
        scale = 1 - Math.max(0, k - 0.6) / 0.4;
        action = 'move';
        speed = 0.5;
        if (k >= 1) return false;
        break;
      }
      case 'vanish': {
        const k = Math.min(1, e.t / VANISH);
        x = e.px;
        z = e.pz;
        scale = 1 - k;
        if (k >= 1) return false;
        break;
      }
      case 'windup':
        // Facing you, glowing with its element, growing a little: an attack is coming.
        if (you) face = Math.atan2(you.x - e.px, you.z - e.pz);
        action = 'skill';
        scale = 1 + 0.12 * Math.sin(Math.min(1, e.t / AMBUSH.windup) * Math.PI * 3);
        if (Math.random() < dt * 30) this.puff(w, e.px, e.y, e.pz, 2, 0.3);
        if (e.t >= AMBUSH.windup) {
          this.go(e, 'taunt');
          e.castT = 0;
          this.host.attack(this.attackerOf(e));
        }
        break;
      case 'taunt':
        // Stays out and fights: its attack pose as it throws, hopping about between.
        if (you) face = Math.atan2(you.x - e.px, you.z - e.pz);
        e.castT += dt;
        action = e.castT < 0.9 ? 'skill' : 'dance';
        if (e.t >= AMBUSH.linger) this.go(e, 'retreat');
        break;
      case 'banish': {
        // A flash, a squash and stretch, gone.
        const k = Math.min(1, e.t / BANISH);
        scale = k < 0.3 ? 1 + k : (1 - k) * 1.86;
        action = 'skill';
        if (k >= 1) return false;
        break;
      }
    }
    if (e.attacker) {
      const a = e.attacker as Attacker & { x: number; y: number; z: number };
      a.x = x;
      a.z = z;
      a.y = (w.kind === 'dragon' ? e.y : this.host.heightAt(x, z)) + w.head;
    }
    // A wild dragon hovers between the trunks; the others stand on the ground.
    const ground = this.host.heightAt(x, z);
    w.root.position.set(x, w.kind === 'dragon' ? Math.max(ground, e.y) : ground, z);
    w.root.rotation.y = face;
    w.root.scale.setScalar(Math.max(0.001, scale));
    w.animate(dt, action, speed, wind);
    return true;
  }

  private go(e: Encounter, state: State): void {
    e.state = state;
    e.t = 0;
  }

  /** This encounter as an attacker: its head, and banishing it (once: a flash and sparkles). */
  private attackerOf(e: Encounter): Attacker {
    if (e.attacker) return e.attacker;
    const self = this;
    const head = (e.w.kind === 'dragon' ? e.y : this.host.heightAt(e.px, e.pz)) + e.w.head;
    const a: Attacker = {
      kind: e.w.kind,
      x: e.px,
      y: head,
      z: e.pz,
      get gone(): boolean {
        return !self.active.includes(e) || e.state === 'banish' || e.state === 'vanish' || e.state === 'retreat';
      },
      banish(): void {
        if (a.gone) return;
        self.go(e, 'banish');
        self.host.banished(e.w.kind, a.x, a.y, a.z);
        self.host.voice(e.w.kind, e.px, e.y, e.pz);
      },
      cast(): void {
        e.castT = 0;
      },
      leave(): void {
        if (a.gone) return;
        self.host.voice(e.w.kind, e.px, e.y, e.pz);
        self.go(e, 'retreat');
      },
    };
    e.attacker = a;
    return a;
  }

  /** Vanishes on the spot; `startled`: with a puff of its element and a call. */
  private startVanish(e: Encounter, startled: boolean): void {
    if (e.state === 'vanish') return;
    if (startled) {
      this.puff(e.w, e.px, e.y, e.pz, 26, 1.2);
      this.host.voice(e.w.kind, e.px, e.y, e.pz);
    }
    this.go(e, 'vanish');
  }

  /** Its element in a burst round its head: soap bubbles, embers or pollen. */
  private puff(w: Wild, x: number, y: number, z: number, n: number, speed: number): void {
    const hy = (w.kind === 'dragon' ? y : this.host.heightAt(x, z)) + w.head;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      const vx = Math.cos(a) * s;
      const vz = Math.sin(a) * s;
      const vy = 0.2 + Math.random() * 0.8;
      if (w.kind === 'crab') this.host.bubbles.blow(x, hy, z, vx, vy, vz, 0.03 + Math.random() * 0.05);
      else if (w.kind === 'dragon') this.host.embers.emit(x, hy, z, vx, vy, vz, 0.03 + Math.random() * 0.03);
      else this.host.spores.emit(x, hy, z, vx, vy * 0.6, vz, 0.025 + Math.random() * 0.025);
    }
  }

  /** A free creature of a random kind beside a trunk in front of you, 6–13 m off. */
  private spawn(you: { x: number; y: number; z: number }): void {
    const pool = this.pool;
    if (!pool) return;
    const free = KINDS.filter((k) => pool.some((w) => w.kind === k && !w.busy));
    if (free.length === 0) return;
    const kind = free[Math.floor(Math.random() * free.length)];
    const w = pool.find((m) => m.kind === kind && !m.busy);
    if (!w) return;
    // Trunks in range and in view (camera forward, flattened).
    this.host.camera.getWorldDirection(tmpF);
    const look = Math.atan2(tmpF.x, tmpF.z);
    const candidates: TrunkInstance[] = [];
    for (const t of this.host.trunks) {
      const dx = t.x - you.x;
      const dz = t.z - you.z;
      const d = Math.hypot(dx, dz);
      if (d < NEAR || d > FAR) continue;
      let off = Math.atan2(dx, dz) - look;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) > VIEW) continue;
      if (this.active.some((e) => Math.hypot(e.px - t.x, e.pz - t.z) < 2)) continue;
      candidates.push(t);
    }
    // A few random tries for a spot the camera can actually see (no trunk in between).
    const cam = this.host.camera.position;
    for (let tries = 0; tries < 10 && candidates.length > 0; tries++) {
      const pick = candidates.splice(Math.floor(Math.random() * candidates.length), 1)[0];
      // Hidden right behind the trunk (from you); peeking out well to one side of it, a step
      // toward you.
      const dx = you.x - pick.x;
      const dz = you.z - pick.z;
      const d = Math.hypot(dx, dz) || 1;
      const lx = dx / d;
      const lz = dz / d;
      const side = Math.random() < 0.5 ? 1 : -1;
      const r = pick.radius;
      const hx = pick.x - lx * (r + 0.35);
      const hz = pick.z - lz * (r + 0.35);
      const px = pick.x - lz * side * (r + 0.75) + lx * 0.4;
      const pz = pick.z + lx * side * (r + 0.75) + lz * 0.4;
      const ground = this.host.heightAt(px, pz);
      if (ground < 0.3 || !this.clearView(cam.x, cam.z, px, pz)) continue;
      this.begin(w, kind, hx, hz, px, pz, ground);
      return;
    }
  }

  /** No trunk stands between (ax, az) and (bx, bz) (a flat test, segment against circles). */
  private clearView(ax: number, az: number, bx: number, bz: number): boolean {
    const vx = bx - ax;
    const vz = bz - az;
    const len2 = vx * vx + vz * vz || 1;
    for (const t of this.host.trunks) {
      const k = Math.max(0, Math.min(1, ((t.x - ax) * vx + (t.z - az) * vz) / len2));
      // The trunk right at the creature does not count (it peeks from beside it).
      if (k > 0.97) continue;
      const cx = ax + vx * k - t.x;
      const cz = az + vz * k - t.z;
      if (cx * cx + cz * cz < (t.radius + 0.15) * (t.radius + 0.15)) return false;
    }
    return true;
  }

  /** Starts an encounter for `w` (hidden at hx, hz behind its trunk; peeking at px, pz). */
  private begin(w: Wild, kind: Kind, hx: number, hz: number, px: number, pz: number, ground: number): void {
    w.busy = true;
    w.root.visible = true;
    w.root.scale.setScalar(0.001);
    this.active.push({
      w,
      state: 'emerge',
      t: 0,
      watch: WATCH[0] + Math.random() * (WATCH[1] - WATCH[0]),
      hx,
      hz,
      px,
      pz,
      y: kind === 'dragon' ? ground + 1.4 + Math.random() * 1.2 : ground,
      flourished: false,
      greeted: false,
      attacker: null,
      castT: 0,
    });
  }

  private loadPool(): void {
    this.loading = true;
    this.host
      .load(PER_KIND)
      .then(async ({ crabs, dragons, bunnies }) => {
        const pool: Wild[] = [
          ...crabs.map((m): Wild => ({ kind: 'crab', root: m.root, head: 0.3, busy: false, animate: (dt, a, s) => m.update(dt, a, s) })),
          ...dragons.map((m): Wild => ({ kind: 'dragon', root: m.root, head: 0.5, busy: false, animate: (dt, a) => m.update(dt, a) })),
          ...bunnies.map((m): Wild => ({ kind: 'bunny', root: m.root, head: 0.7, busy: false, animate: (dt, a, s, wind) => m.update(dt, a, s, a === 'greet' || a === 'dance' ? 0.8 : 0, wind) })),
        ];
        const group = new THREE.Group();
        for (const w of pool) group.add(w.root);
        await this.host.compile(group);
        for (const w of pool) {
          w.root.visible = false;
          this.host.scene.add(w.root);
        }
        this.pool = pool;
      })
      .catch((err: unknown) => console.warn('wild creatures load failed', err))
      .finally(() => {
        this.loading = false;
      });
  }
}
