import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';
import type { SkillSound } from '../audio/synth/skillSounds';
import type { EmberSink } from '../world/creatures/embers';
import { Embers } from '../world/creatures/embers';
import { IceRoad } from '../world/creatures/iceRoad';
import { AuroraTrail } from '../world/creatures/auroraTrail';
import { MeteorShower } from '../world/creatures/meteorShower';
import { WingTrails } from '../world/creatures/wingTrails';
import { MANTA_WINGSPAN } from './flight/mantaSize';
import { MantaEntranceFx } from './flight/mantaEntranceFx';
import { makeCourse, RingRun, SHOWN, type RingLevel } from './flight/ringCourse';
import { IceRings } from '../world/creatures/iceRings';
import type { SkillFxSink } from '../world/creatures/skillFx';
import type { MantaActivity } from './MantaActivity';

/**
 * - frost: Hơi Thở Băng Giá. Low over the sea, a frosty breath freezes a road of ice ahead
 *   and the manta glides on it.
 * - meteor: Mưa Sao Băng. Shooting stars rain across the sky and burst into glitter, and snow
 *   starts to fall over the island.
 * - aurora: Dải Lụa Cực Quang. Curtains of aurora unfurl from the wingtips along the flight
 *   path and hang there; flying along them again, their wind carries the manta faster.
 * - rings: Vòng Tròn Băng Giá. A random course of ice rings ahead to fly through, one after
 *   another against the clock (see RingCourse); each bursts as you pass; all of them: a tomato.
 */
export type MantaSkillId = 'frost' | 'meteor' | 'aurora' | 'rings';
export const MANTA_SKILLS: readonly MantaSkillId[] = ['frost', 'meteor', 'aurora', 'rings'];

/** Seconds between casts of each skill (the rings: after a course ends). */
export const COOLDOWN: Record<MantaSkillId, number> = { frost: 10, meteor: 30, aurora: 18, rings: 3 };
/** Flying through a ring: this much speed (m/s), up to `top`; the shards thrown (High); motes. */
const RING_FX = { boost: 3.5, top: 32, shards: 110, motes: 40 } as const;

/** What the ring course reports (App: its readout, the note, the tomato). */
export interface RingHooks {
  start(level: RingLevel): void;
  /** Every frame: rings passed, of how many, seconds so far, time left for the next (0 … 1). */
  progress(passed: number, total: number, elapsed: number, left: number): void;
  /** Flew past one (not through it). */
  miss(): void;
  /** All of them (`tomato`: one was earned), or out of time, or got off: 'abort'. */
  end(result: 'done' | 'timeout' | 'abort', passed: number, total: number, elapsed: number, tomato: boolean): void;
  /** One tomato for a course flown to the end (started at `startedAt`, ms); false if not paid. */
  reward(startedAt: number): boolean;
}
/** The breath (s); it freezes the sea this far ahead of the manta's middle (m, plus speed). */
const BREATH = { time: 4.5, lead: 12, leadPerSpeed: 0.45, step: 1.6 } as const;
/** Highest over the sea (m) the breath reaches down from. */
export const FROST_HEIGHT = 16;
/** Seconds the aurora is drawn; a point every `step` m of flight. */
const AURORA = { time: 10, step: 2, minAge: 2.5, reach: 4.5, boost: 26, top: 34 } as const;
/** The shower (s), meteors per second (reduced motion: fewer), and the snow it brings. */
const SHOWER = { time: 12, rate: 5, calmRate: 2 } as const;
/**
 * Where the shower's meteors are: their ends inside the view (fractions of the half-width
 * across, of the half-height up from the middle), `near` … `far` m away and at least `low` m
 * above the sea; each `len` m long, at `speed` m/s. The radiant (where they all seem to come
 * from) sits just above the top of the view, `radiantUp` half-heights up.
 */
const METEOR = { across: 0.85, upMin: -0.05, upMax: 0.8, near: 90, far: 230, low: 25, len: [50, 110], speed: [60, 100], radiantUp: 1.25 } as const;
const SNOW = { peak: 0.8, rise: 3, hold: 40, fall: 12 } as const;
/** Glitter crystals per second around the camera at full skill snow. */
const GLITTER = 70;
/**
 * Flying (an ice creature, any time): snowflakes shed from the wing tips and the trailing edge
 * (per second: `base` hovering, plus `perSpeed` per m/s), and the tip wind from `windFrom` m/s,
 * full at `windFull`.
 */
const AURA = { base: 8, perSpeed: 3.5, windFrom: 5, windFull: 22 } as const;
/** Its mouth, this far ahead of its middle (m). */
const MOUTH = MANTA_WINGSPAN * 0.42;
const HALF_SPAN = MANTA_WINGSPAN / 2;

export interface MantaSkillHooks {
  /** The skill's name card (UI). */
  card(id: MantaSkillId): void;
  /** Can't cast now: a short note. */
  refuse(id: MantaSkillId, why: 'cooldown' | 'needSea' | 'running', seconds: number): void;
  sound(kind: SkillSound, size: number): void;
  /** A splash ring in the sea (the ice landing on it). */
  ripple(x: number, z: number): void;
  /** Soft white puffs (the breath's cold mist). */
  mist: EmberSink;
  /** Rainbow motes (riding the aurora's wind). */
  sparkle: EmberSink;
  /** The sea's glowing motes (the churn as it comes up out of the sea). */
  glow: EmberSink;
  /** Shock rings and camera shake (its breach). */
  fx: Pick<SkillFxSink, 'shock' | 'shake'>;
  /** A ring in the water (radius m, strength: negative pushes it down). */
  wave(x: number, z: number, radius: number, strength: number): void;
  /** The highest thing at (x, z): terrain, trees, the house (the sea: 0). */
  floor(x: number, z: number): number;
  rings: RingHooks;
  heightAt(x: number, z: number): number;
  reducedMotion(): boolean;
}

/** A meteor's burst, waiting for it to burn out (shader time). */
interface Burst {
  t: number;
  x: number;
  y: number;
  z: number;
}

const tmpV = new THREE.Vector3();
const tmpTip = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpStart = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();
const camBack = new THREE.Vector3();

/**
 * The manta's four skills (1 – 4 while riding): the effects (an ice road, curtains of
 * aurora, a meteor shower, frost glitter) and their timing. Everything runs on the shader clock
 * (uTime), which the ribbons and meteors are drawn with.
 */
export class MantaSkills {
  readonly ice: IceRoad;
  readonly aurora: AuroraTrail;
  readonly meteors: MeteorShower;
  readonly frost: Embers;
  readonly wind: WingTrails;
  /** Its entrance out of the sea: the churn, the breach, the water streaming off it. */
  readonly entrance: MantaEntranceFx;
  readonly iceRings: IceRings;
  /** The ring course being flown, when it started (ms), the manta's last position. */
  private run: RingRun | null = null;
  private runStarted = 0;
  private readonly runLast = new THREE.Vector3();
  private shardScale = 1;
  /** Extra snowfall for the weather (0 … 1): the meteor shower's snow. */
  snow = 0;
  private readonly ready: Record<MantaSkillId, number> = { frost: -1e9, meteor: -1e9, aurora: -1e9, rings: -1e9 };
  private breath = 0;
  private auroraLeft = 0;
  private showerLeft = 0;
  private snowAge = Infinity;
  private nextMeteor = 0;
  /** The radiant's place across the top of the view this shower (−1 … 1 of the half-width). */
  private radiantX = 0;
  private chimeT = 0;
  private readonly bursts: Burst[] = Array.from({ length: 64 }, () => ({ t: Infinity, x: 0, y: 0, z: 0 }));
  private burstNext = 0;
  private readonly lastIce = { x: Infinity, z: Infinity };
  private readonly lastAurora = new THREE.Vector3(Infinity, 0, 0);
  private readonly emitDebt = { breath: 0, mist: 0, glitter: 0, spray: 0, sparkle: 0, aura: 0 };
  private scrapeT = 0;
  private dt = 0;
  private boosting = false;

  constructor(
    scene: THREE.Scene,
    private readonly shared: SharedUniforms,
    private readonly manta: MantaActivity,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly hooks: MantaSkillHooks,
  ) {
    this.frost = new Embers(shared, 'frost');
    this.ice = new IceRoad(shared, {
      frost: this.frost,
      mist: hooks.mist,
      ripple: (x, z) => hooks.ripple(x, z),
      sound: (kind, size) => hooks.sound(kind, size),
    });
    this.aurora = new AuroraTrail(shared);
    this.meteors = new MeteorShower(shared);
    this.wind = new WingTrails(shared);
    this.entrance = new MantaEntranceFx(shared, {
      sound: (kind, size) => hooks.sound(kind, size),
      wave: (x, z, r, k) => hooks.wave(x, z, r, k),
      mist: hooks.mist,
      glow: hooks.glow,
      fx: hooks.fx,
      reducedMotion: () => hooks.reducedMotion(),
    });
    this.iceRings = new IceRings(shared);
    scene.add(...this.ice.objects, ...this.wind.meshes, this.aurora.mesh, this.meteors.mesh, this.frost.points, this.entrance.spray.points, ...this.iceRings.objects);
    manta.ice = this.ice;
  }

  private get now(): number {
    return this.shared.uTime.value;
  }

  /** Seconds until `id` can be cast again (0: ready). */
  cooldown(id: MantaSkillId): number {
    return Math.max(0, this.ready[id] - this.now);
  }

  /** 1 – 4: casts `id` if the manta is ridden, ready and (frost) low over the sea. */
  cast(id: MantaSkillId): boolean {
    const m = this.manta;
    if (m.state !== 'riding' || !m.active) return false;
    if (id === 'rings' && this.run) {
      this.hooks.refuse(id, 'running', 0);
      return false;
    }
    const wait = this.cooldown(id);
    if (wait > 0) {
      this.hooks.refuse(id, 'cooldown', Math.ceil(wait));
      return false;
    }
    const f = m.flight;
    if (id === 'frost' && (this.hooks.heightAt(f.x, f.z) > -0.6 || f.y > FROST_HEIGHT)) {
      this.hooks.refuse(id, 'needSea', 0);
      return false;
    }
    this.ready[id] = this.now + COOLDOWN[id];
    this.hooks.card(id);
    switch (id) {
      case 'frost':
        this.breath = BREATH.time;
        this.ice.cut();
        this.lastIce.x = Infinity;
        this.hooks.sound('frost', 1);
        break;
      case 'meteor': {
        this.showerLeft = SHOWER.time;
        this.snowAge = 0;
        this.nextMeteor = this.now;
        this.chimeT = 3;
        // All the shower's meteors come from one point (its radiant), as a real one: here
        // just above the top of your view, so they streak down across it, fanning out.
        this.radiantX = (Math.random() - 0.5) * 0.8;
        this.hooks.sound('starfall', 1);
        break;
      }
      case 'aurora':
        this.auroraLeft = AURORA.time;
        this.aurora.cut();
        this.lastAurora.x = Infinity;
        this.hooks.sound('aurora', 1);
        break;
      case 'rings':
        this.startCourse();
        break;
    }
    return true;
  }

  /** A new random course ahead: the first rings form one after another. */
  private startCourse(): void {
    const f = this.manta.flight;
    const course = makeCourse(Math.random, f.x, f.y, f.z, f.yaw, (x, z) => this.hooks.floor(x, z));
    this.run = new RingRun(course);
    this.runStarted = Date.now();
    this.runLast.set(f.x, f.y, f.z);
    const n = Math.min(SHOWN, course.gates.length);
    for (let i = 0; i < n; i++) this.iceRings.show(i, { ...course.gates[i], hex: course.hex }, this.now + i * 0.18);
    this.hooks.sound('frost', 0.25);
    this.hooks.rings.start(course.level);
  }

  /** One frame of the course: through a ring, past it, out of time; the glow of the next. */
  private flyCourse(now: number): void {
    const run = this.run;
    if (!run) return;
    const m = this.manta;
    const f = m.flight;
    const h = this.hooks;
    const gates = run.course.gates;
    if (m.state !== 'riding' || !m.active) {
      // Off the manta: the course melts away.
      for (let i = run.next; i < Math.min(gates.length, run.next + SHOWN); i++) this.iceRings.melt(i, now);
      this.run = null;
      h.rings.end('abort', run.next, run.total, run.elapsed, false);
      return;
    }
    const ev = run.update(this.dt, this.runLast.x, this.runLast.y, this.runLast.z, f.x, f.y, f.z);
    this.runLast.set(f.x, f.y, f.z);
    // Its velocity (for the shards to fly on with it).
    const cp = Math.cos(f.pitch);
    const vx = -Math.sin(f.yaw) * cp * f.speed;
    const vy = Math.sin(f.pitch) * f.speed;
    const vz = -Math.cos(f.yaw) * cp * f.speed;
    if (ev?.kind === 'pass') {
      const g = gates[ev.index];
      this.iceRings.shatter(ev.index, now, vx, vy, vz, Math.round(RING_FX.shards * this.shardScale));
      if (ev.index + SHOWN < gates.length) this.iceRings.show(ev.index + SHOWN, { ...gates[ev.index + SHOWN], hex: run.course.hex }, now + 0.1);
      // The ring's note (a step up the scale each ring), and through the middle a sparkle on top.
      h.sound('gate', ev.index / 16);
      if (ev.perfect) h.sound('perfect', ev.index / 16);
      h.fx.shake(g.x, g.y, g.z, ev.perfect ? 0.25 : 0.15, 0.35);
      if (f.speed > 0) f.speed = Math.max(f.speed, Math.min(RING_FX.top, f.speed + RING_FX.boost));
      for (let k = 0; k < RING_FX.motes * (ev.perfect ? 2 : 1); k++) {
        const a = Math.random() * Math.PI * 2;
        tmpV.set(Math.cos(a), Math.sin(a), Math.random() - 0.5).multiplyScalar(2 + Math.random() * 4);
        this.frost.emit(g.x, g.y, g.z, tmpV.x + vx * 0.3, tmpV.y + vy * 0.3, tmpV.z + vz * 0.3, 0.2 + Math.random() * 0.3);
        if (ev.perfect) h.sparkle.emit(g.x, g.y, g.z, tmpV.x, tmpV.y, tmpV.z, 0.25 + Math.random() * 0.2);
      }
      if (run.state === 'done') {
        this.run = null;
        this.ready.rings = this.now + COOLDOWN.rings;
        const tomato = h.rings.reward(this.runStarted);
        h.sound('course', 1);
        h.rings.end('done', run.total, run.total, run.elapsed, tomato);
        return;
      }
    } else if (ev?.kind === 'miss') {
      h.sound('crack', 0.4);
      h.rings.miss();
    } else if (ev?.kind === 'timeout') {
      for (let i = run.next; i < Math.min(gates.length, run.next + SHOWN); i++) this.iceRings.melt(i, now);
      this.run = null;
      this.ready.rings = this.now + COOLDOWN.rings;
      h.sound('fizzle', 1);
      h.rings.end('timeout', run.next, run.total, run.elapsed, false);
      return;
    }
    // The next ring pulses; lined up on it (flying at its hole) it shines. Those after: faint.
    const g = gates[run.next];
    const dx = -Math.sin(f.yaw) * cp;
    const dy = Math.sin(f.pitch);
    const dz = -Math.cos(f.yaw) * cp;
    const dn = dx * g.nx + dy * g.ny + dz * g.nz;
    let aligned = false;
    if (dn > 0.2) {
      const t = ((g.x - f.x) * g.nx + (g.y - f.y) * g.ny + (g.z - f.z) * g.nz) / dn;
      if (t > 0) aligned = Math.hypot(f.x + dx * t - g.x, f.y + dy * t - g.y, f.z + dz * t - g.z) < g.radius * 0.85;
    }
    this.iceRings.setGlow(run.next, aligned ? 1 : 0.35 + 0.2 * Math.sin(now * 6));
    for (let i = run.next + 1; i < Math.min(gates.length, run.next + SHOWN); i++) this.iceRings.setGlow(i, 0.05);
    h.rings.progress(run.next, run.total, run.elapsed, run.left / g.time);
  }

  /** The shader clock was reset: drop everything timed on it. */
  reset(): void {
    this.ice.clear();
    this.wind.clear();
    this.aurora.ribbon.clear();
    this.meteors.reset();
    this.iceRings.clear();
    if (this.run) {
      this.hooks.rings.end('abort', this.run.next, this.run.total, this.run.elapsed, false);
      this.run = null;
    }
    for (const b of this.bursts) b.t = Infinity;
    for (const id of MANTA_SKILLS) this.ready[id] = -1e9;
  }

  update(dt: number): void {
    const now = this.now;
    const m = this.manta;
    const f = m.flight;
    const ridden = m.state === 'riding';
    // ---- Breath: frost toward the sea ahead, freezing it ----
    if (this.breath > 0) {
      this.breath -= dt;
      if (!ridden || this.breath <= 0) {
        this.breath = 0;
        this.ice.cut();
      } else {
        this.breathe(dt, now);
      }
    }
    // ---- Gliding on the ice: a spray of crystals and the scrape of it ----
    if (m.skating > 0.6 && Math.abs(f.speed) > 2) {
      const fx = -Math.sin(f.yaw);
      const fz = -Math.cos(f.yaw);
      this.emitDebt.spray += dt * 60 * Math.min(1, Math.abs(f.speed) / 14);
      while (this.emitDebt.spray >= 1) {
        this.emitDebt.spray -= 1;
        const s = Math.random() < 0.5 ? -1 : 1;
        const r = HALF_SPAN * (0.4 + Math.random() * 0.6);
        this.frost.emit(f.x - fx * 1.5 + Math.cos(f.yaw) * s * r, f.y - 0.4, f.z - fz * 1.5 - Math.sin(f.yaw) * s * r, -fx * 2 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, -fz * 2 + (Math.random() - 0.5) * 2, 0.2 + Math.random() * 0.25);
      }
      this.scrapeT -= dt;
      if (this.scrapeT <= 0) {
        this.scrapeT = 0.22 + Math.random() * 0.15;
        this.hooks.sound('scrape', Math.min(1, Math.abs(f.speed) / 20));
      }
    }
    // ---- Aurora: a point of the curtains every few metres while it lasts; its wind ----
    if (this.auroraLeft > 0) {
      this.auroraLeft -= dt;
      if (!ridden || this.auroraLeft <= 0) {
        this.auroraLeft = 0;
        this.aurora.cut();
      } else if (tmpV.set(f.x, f.y, f.z).distanceTo(this.lastAurora) >= AURORA.step) {
        this.aurora.add(f.x, f.y, f.z, Math.cos(f.yaw), -Math.sin(f.yaw), now);
        this.lastAurora.copy(tmpV);
      }
    }
    const boost = ridden && f.speed > 2 && this.aurora.near(f.x, f.y, f.z, now, AURORA.minAge, AURORA.reach);
    if (boost) {
      // The aurora's wind: speed beyond a sprint while you follow it, shedding rainbow motes.
      f.speed = Math.min(AURORA.top, Math.max(f.speed, Math.min(f.speed + AURORA.boost * dt, AURORA.top)));
      this.emitDebt.sparkle += dt * 40;
      while (this.emitDebt.sparkle >= 1) {
        this.emitDebt.sparkle -= 1;
        const s = Math.random() < 0.5 ? -1 : 1;
        this.hooks.sparkle.emit(f.x + Math.cos(f.yaw) * s * HALF_SPAN, f.y + Math.random(), f.z - Math.sin(f.yaw) * s * HALF_SPAN, (Math.random() - 0.5) * 2, 0.5 + Math.random(), (Math.random() - 0.5) * 2, 0.3 + Math.random() * 0.2);
      }
      if (!this.boosting) this.hooks.sound('whoosh', 0.4);
    }
    this.boosting = boost;
    // ---- Meteor shower ----
    if (this.showerLeft > 0) {
      this.showerLeft -= dt;
      const rate = this.hooks.reducedMotion() ? SHOWER.calmRate : SHOWER.rate;
      while (this.showerLeft > 0 && this.nextMeteor <= now) {
        this.launchMeteor(now);
        this.nextMeteor += (0.4 + Math.random() * 1.2) / rate;
      }
      this.chimeT -= dt;
      if (this.showerLeft > 0 && this.chimeT <= 0) {
        this.chimeT = 3.5 + Math.random();
        this.hooks.sound('starfall', 0.4);
      }
    }
    for (const b of this.bursts) {
      if (b.t > now) continue;
      b.t = Infinity;
      for (let i = 0; i < 26; i++) {
        tmpV.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 5);
        this.frost.emit(b.x, b.y, b.z, tmpV.x, tmpV.y, tmpV.z, 0.8 + Math.random() * 0.8);
      }
    }
    // ---- The shower's snow: rises, holds, falls away; glitter around the camera meanwhile ----
    this.snowAge += dt;
    const a = this.snowAge;
    this.snow = SNOW.peak * Math.min(a / SNOW.rise, 1) * (1 - Math.min(Math.max((a - SNOW.rise - SNOW.hold) / SNOW.fall, 0), 1));
    if (this.snow > 0.05) {
      const c = this.camera.position;
      this.emitDebt.glitter += dt * GLITTER * this.snow;
      while (this.emitDebt.glitter >= 1) {
        this.emitDebt.glitter -= 1;
        this.frost.emit(c.x + (Math.random() - 0.5) * 36, c.y + 2 + Math.random() * 12, c.z + (Math.random() - 0.5) * 36, (Math.random() - 0.5) * 0.6, -0.8, (Math.random() - 0.5) * 0.6, 0.06 + Math.random() * 0.07);
      }
    }
    this.entrance.update(dt, m.summon, (i, out) => m.wingTip(i, out));
    this.dt = dt;
    this.flyCourse(now);
    this.iceRings.update(now);
    this.flightAura(dt, now);
    this.ice.update(now);
    this.aurora.update(now);
    this.meteors.update(now);
    this.aurora.setMotion(!this.hooks.reducedMotion());
    this.frost.update(dt);
  }

  /**
   * Flying, it trails the cold: snowflakes glinting off the wing tips and the back edge, and
   * spiralling wind off the tips once it's quick (both grow with its speed).
   */
  private flightAura(dt: number, now: number): void {
    const m = this.manta;
    const f = m.flight;
    // (Coming up out of the sea: once it's out.)
    const flying = m.state === 'riding' || m.state === 'arriving' || m.state === 'landing' || (m.state === 'rising' && m.summon.sinceBreach > 0.3);
    const speed = Math.abs(f.speed);
    const sx = Math.cos(f.yaw);
    const sz = -Math.sin(f.yaw);
    const power = flying && !this.hooks.reducedMotion() ? Math.min(1, Math.max(0, (speed - AURA.windFrom) / (AURA.windFull - AURA.windFrom))) : 0;
    for (let i = 0; i < 2; i++) {
      if (!m.wingTip(i, tmpTip)) return;
      this.wind.follow(i, tmpTip, sx, sz, power, now);
    }
    this.wind.update(now);
    if (!flying) return;
    const fx = -Math.sin(f.yaw);
    const fz = -Math.cos(f.yaw);
    this.emitDebt.aura += dt * (AURA.base + AURA.perSpeed * speed);
    while (this.emitDebt.aura >= 1) {
      this.emitDebt.aura -= 1;
      // From a wing tip, or somewhere along the back edge of the wings.
      const tip = Math.random() < 0.6;
      m.wingTip(Math.random() < 0.5 ? 0 : 1, tmpTip);
      if (!tip) {
        const k = Math.random();
        tmpTip.x = f.x + (tmpTip.x - f.x) * k - fx * 0.6;
        tmpTip.z = f.z + (tmpTip.z - f.z) * k - fz * 0.6;
        tmpTip.y = f.y + (tmpTip.y - f.y) * k;
      }
      // Left behind (a little of its speed), drifting out and down.
      const back = speed * (0.15 + Math.random() * 0.2);
      this.frost.emit(tmpTip.x, tmpTip.y, tmpTip.z, -fx * back + (Math.random() - 0.5) * 1.2, (Math.random() - 0.7) * 1.2, -fz * back + (Math.random() - 0.5) * 1.2, 0.18 + Math.random() * 0.25);
    }
  }

  /** One frame of the breath: crystals and mist from the mouth to the sea ahead, ice where it lands. */
  private breathe(dt: number, now: number): void {
    const f = this.manta.flight;
    const fx = -Math.sin(f.yaw);
    const fz = -Math.cos(f.yaw);
    const mx = f.x + fx * MOUTH;
    const my = f.y - 0.1;
    const mz = f.z + fz * MOUTH;
    const lead = BREATH.lead + Math.max(0, f.speed) * BREATH.leadPerSpeed;
    const ix = f.x + fx * lead;
    const iz = f.z + fz * lead;
    // From the mouth to where it lands (the sea surface ahead), with the manta's own speed.
    tmpV.set(ix - mx, 0.3 - my, iz - mz);
    const len = Math.max(tmpV.length(), 1);
    tmpV.multiplyScalar(1 / len);
    const v = Math.max(0, f.speed);
    // Thrown well ahead of the manta (its own speed plus the breath's), a cone that spreads.
    this.emitDebt.breath += dt * 220;
    while (this.emitDebt.breath >= 1) {
      this.emitDebt.breath -= 1;
      const k = 14 + Math.random() * 10;
      this.frost.emit(mx, my, mz, tmpV.x * k + fx * v + (Math.random() - 0.5) * 4, tmpV.y * k + (Math.random() - 0.5) * 2, tmpV.z * k + fz * v + (Math.random() - 0.5) * 4, 0.35 + Math.random() * 0.5);
    }
    this.emitDebt.mist += dt * 30;
    while (this.emitDebt.mist >= 1) {
      this.emitDebt.mist -= 1;
      const k = 8 + Math.random() * 6;
      this.hooks.mist.emit(mx, my, mz, tmpV.x * k + fx * v, tmpV.y * k, tmpV.z * k + fz * v, 1 + Math.random() * 1.2);
    }
    // Ice only on the sea (not the beach or the reef's shallows).
    if (this.hooks.heightAt(ix, iz) > -0.6) {
      this.ice.cut();
      this.lastIce.x = Infinity;
      return;
    }
    if (Math.hypot(ix - this.lastIce.x, iz - this.lastIce.z) < BREATH.step) return;
    this.ice.add(ix, iz, Math.cos(f.yaw), -Math.sin(f.yaw), now);
    this.lastIce.x = ix;
    this.lastIce.z = iz;
    this.hooks.ripple(ix, iz);
  }

  /**
   * One meteor of the shower, in front of you: it ends somewhere in the upper part of the view
   * and comes from the radiant above it. All of a shower's meteors fly parallel (from the
   * radiant's direction), so perspective fans them out from it as in a real shower.
   */
  private launchMeteor(now: number): void {
    const c = this.camera;
    c.updateMatrixWorld();
    c.matrixWorld.extractBasis(camRight, camUp, camBack);
    const tanV = Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) / c.zoom;
    const tanH = tanV * c.aspect;
    // Its end: a direction inside the view, a way off.
    const x = (Math.random() * 2 - 1) * METEOR.across;
    const y = METEOR.upMin + Math.random() * (METEOR.upMax - METEOR.upMin);
    tmpV.copy(camBack).negate().addScaledVector(camRight, x * tanH).addScaledVector(camUp, y * tanV).normalize();
    const dist = METEOR.near + Math.random() * (METEOR.far - METEOR.near);
    const e = tmpEnd.copy(c.position).addScaledVector(tmpV, dist);
    e.y = Math.max(e.y, METEOR.low + Math.random() * 15);
    // Toward the radiant (a touch of jitter so they don't fly in lockstep): it starts up there.
    tmpV.copy(camBack)
      .negate()
      .addScaledVector(camRight, (this.radiantX + (Math.random() - 0.5) * 0.15) * tanH)
      .addScaledVector(camUp, METEOR.radiantUp * tanV)
      .normalize();
    const len = METEOR.len[0] + Math.random() * (METEOR.len[1] - METEOR.len[0]);
    const s = tmpStart.copy(e).addScaledVector(tmpV, len);
    const dur = len / (METEOR.speed[0] + Math.random() * (METEOR.speed[1] - METEOR.speed[0]));
    // Slightly in the future: the shader starts it on its next frame.
    const t0 = now + 0.02;
    this.meteors.launch(s.x, s.y, s.z, e.x, e.y, e.z, t0, dur);
    // It bursts into crystals where it burns out.
    const b = this.bursts[this.burstNext];
    this.burstNext = (this.burstNext + 1) % this.bursts.length;
    b.t = t0 + dur;
    b.x = e.x;
    b.y = e.y;
    b.z = e.z;
  }

  /** Quality preset: the ice's spikes and shards. */
  setQuality(spikes: number, shards: number): void {
    this.ice.setQuality(spikes, shards);
    // The rings' shards scale with the ice's (High: 200).
    this.shardScale = Math.max(0.4, Math.min(1, shards / 200));
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.frost.setViewport(heightPx, fovDeg);
    this.meteors.setViewport(heightPx);
    this.entrance.setViewport(heightPx, fovDeg);
    this.iceRings.setViewport(heightPx, fovDeg);
  }

  dispose(): void {
    this.ice.dispose();
    this.aurora.dispose();
    this.meteors.dispose();
    this.entrance.dispose();
    this.iceRings.dispose();
    this.wind.dispose();
  }
}
