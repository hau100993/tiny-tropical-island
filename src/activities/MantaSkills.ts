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
import type { MantaActivity } from './MantaActivity';

/**
 * - frost: Hơi Thở Băng Giá. Low over the sea, a frosty breath freezes a road of ice ahead
 *   and the manta glides on it.
 * - meteor: Mưa Sao Băng. Shooting stars rain across the sky and burst into glitter, and snow
 *   starts to fall over the island.
 * - aurora: Dải Lụa Cực Quang. Curtains of aurora unfurl from the wingtips along the flight
 *   path and hang there; flying along them again, their wind carries the manta faster.
 */
export type MantaSkillId = 'frost' | 'meteor' | 'aurora';
export const MANTA_SKILLS: readonly MantaSkillId[] = ['frost', 'meteor', 'aurora'];

/** Seconds between casts of each skill. */
export const COOLDOWN: Record<MantaSkillId, number> = { frost: 10, meteor: 30, aurora: 18 };
/** The breath (s); it freezes the sea this far ahead of the manta's middle (m, plus speed). */
const BREATH = { time: 4.5, lead: 12, leadPerSpeed: 0.45, step: 1.6 } as const;
/** Highest over the sea (m) the breath reaches down from. */
export const FROST_HEIGHT = 16;
/** Seconds the aurora is drawn; a point every `step` m of flight. */
const AURORA = { time: 10, step: 2, minAge: 2.5, reach: 4.5, boost: 26, top: 34 } as const;
/** The shower (s), meteors per second (reduced motion: fewer), and the snow it brings. */
const SHOWER = { time: 12, rate: 5, calmRate: 2 } as const;
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
  refuse(id: MantaSkillId, why: 'cooldown' | 'needSea', seconds: number): void;
  sound(kind: SkillSound, size: number): void;
  /** A splash ring in the sea (the ice landing on it). */
  ripple(x: number, z: number): void;
  /** Soft white puffs (the breath's cold mist). */
  mist: EmberSink;
  /** Rainbow motes (riding the aurora's wind). */
  sparkle: EmberSink;
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

/**
 * The manta's three skills (Q / E / R while riding): the effects (an ice road, curtains of
 * aurora, a meteor shower, frost glitter) and their timing. Everything runs on the shader clock
 * (uTime), which the ribbons and meteors are drawn with.
 */
export class MantaSkills {
  readonly ice: IceRoad;
  readonly aurora: AuroraTrail;
  readonly meteors: MeteorShower;
  readonly frost: Embers;
  readonly wind: WingTrails;
  /** Extra snowfall for the weather (0 … 1): the meteor shower's snow. */
  snow = 0;
  private readonly ready: Record<MantaSkillId, number> = { frost: -1e9, meteor: -1e9, aurora: -1e9 };
  private breath = 0;
  private auroraLeft = 0;
  private showerLeft = 0;
  private snowAge = Infinity;
  private nextMeteor = 0;
  private readonly radiant = new THREE.Vector3(0, -1, 0);
  private chimeT = 0;
  private readonly bursts: Burst[] = Array.from({ length: 64 }, () => ({ t: Infinity, x: 0, y: 0, z: 0 }));
  private burstNext = 0;
  private readonly lastIce = { x: Infinity, z: Infinity };
  private readonly lastAurora = new THREE.Vector3(Infinity, 0, 0);
  private readonly emitDebt = { breath: 0, mist: 0, glitter: 0, spray: 0, sparkle: 0, aura: 0 };
  private scrapeT = 0;
  private boosting = false;

  constructor(
    scene: THREE.Scene,
    private readonly shared: SharedUniforms,
    private readonly manta: MantaActivity,
    private readonly camera: THREE.Camera,
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
    scene.add(...this.ice.objects, ...this.wind.meshes, this.aurora.mesh, this.meteors.mesh, this.frost.points);
    manta.ice = this.ice;
  }

  private get now(): number {
    return this.shared.uTime.value;
  }

  /** Seconds until `id` can be cast again (0: ready). */
  cooldown(id: MantaSkillId): number {
    return Math.max(0, this.ready[id] - this.now);
  }

  /** Q / E / R: casts `id` if the manta is ridden, ready and (frost) low over the sea. */
  cast(id: MantaSkillId): boolean {
    const m = this.manta;
    if (m.state !== 'riding' || !m.active) return false;
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
        // All the shower's meteors come from one point of the sky (its radiant), as a real one.
        const a = Math.random() * Math.PI * 2;
        this.radiant.set(Math.cos(a) * 0.75, -0.62, Math.sin(a) * 0.75).normalize();
        this.hooks.sound('starfall', 1);
        break;
      }
      case 'aurora':
        this.auroraLeft = AURORA.time;
        this.aurora.cut();
        this.lastAurora.x = Infinity;
        this.hooks.sound('aurora', 1);
        break;
    }
    return true;
  }

  /** The shader clock was reset: drop everything timed on it. */
  reset(): void {
    this.ice.clear();
    this.wind.clear();
    this.aurora.ribbon.clear();
    this.meteors.reset();
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
    const flying = m.state === 'riding' || m.state === 'arriving' || m.state === 'landing';
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

  /** One meteor of the shower: across the sky in front of the camera, ending high over the sea or the island. */
  private launchMeteor(now: number): void {
    const f = this.manta.flight;
    const c = this.camera;
    c.getWorldDirection(tmpV);
    const view = Math.atan2(tmpV.x, tmpV.z);
    const a = view + (Math.random() - 0.5) * 2.4;
    const d = 50 + Math.random() * 170;
    const ex = f.x + Math.sin(a) * d;
    const ez = f.z + Math.cos(a) * d;
    const ey = Math.max(45, f.y + 25) + Math.random() * 60;
    const len = 80 + Math.random() * 70;
    // Jitter around the radiant so they don't fly in lockstep.
    const r = this.radiant;
    const jx = r.x + (Math.random() - 0.5) * 0.25;
    const jy = r.y + (Math.random() - 0.5) * 0.15;
    const jz = r.z + (Math.random() - 0.5) * 0.25;
    const n = Math.hypot(jx, jy, jz);
    const sx = ex - (jx / n) * len;
    const sy = ey - (jy / n) * len;
    const sz = ez - (jz / n) * len;
    const dur = len / (75 + Math.random() * 45);
    // Slightly in the future: the shader starts it on its next frame.
    const t0 = now + 0.02;
    this.meteors.launch(sx, sy, sz, ex, ey, ez, t0, dur);
    const b = this.bursts[this.burstNext];
    this.burstNext = (this.burstNext + 1) % this.bursts.length;
    // The shader burns it out over its last 15%: burst as it fades, where its head is then
    // (it speeds up: k·(0.7 + 0.3k) of the way at k = 0.92).
    const along = 0.92 * (0.7 + 0.3 * 0.92);
    b.t = t0 + dur * 0.92;
    b.x = sx + (ex - sx) * along;
    b.y = sy + (ey - sy) * along;
    b.z = sz + (ez - sz) * along;
  }

  /** Quality preset: the ice's spikes and shards. */
  setQuality(spikes: number, shards: number): void {
    this.ice.setQuality(spikes, shards);
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.frost.setViewport(heightPx, fovDeg);
  }

  dispose(): void {
    this.ice.dispose();
    this.aurora.dispose();
    this.meteors.dispose();
    this.wind.dispose();
  }
}
