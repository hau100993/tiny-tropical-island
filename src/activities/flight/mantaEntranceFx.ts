import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import type { SkillSound } from '../../audio/synth/skillSounds';
import type { EmberSink } from '../../world/creatures/embers';
import type { SkillFxSink } from '../../world/creatures/skillFx';
import { Spray } from '../../water/Spray';
import { SUMMON, type MantaSummon } from './mantaSummon';

/** The splash's own droplet pool (one draw call, only while drops are alive). */
const POOL = 2600;
/**
 * The churn before it breaks out, at full strength (the end of the stir): droplets boiling up
 * per second, glowing motes per second, its radius (m), a ripple every `rippleEvery` s.
 */
const CHURN = { drops: 600, glow: 70, mist: 18, radius: 4.5, rippleEvery: 0.15 } as const;
/** The breach: the crown thrown out round it, the column dragged up behind it, mist puffs. */
const BREACH = { crown: 520, column: 380, mist: 40, ring: 2.6, life: 2.8 } as const;
/** Water streaming off it after the breach: per second at first, for this long (s). */
const DRIP = { sheet: 420, sheetFor: 0.6, tips: 140, for: 3.5 } as const;
/** The crown falling back onto the sea this long after the breach (s): a patter of rings. */
const RAIN_BACK = 1.9;

export interface EntranceHooks {
  sound(kind: SkillSound, size: number): void;
  /** A ring in the water simulation (radius m, strength: negative pushes the water down). */
  wave(x: number, z: number, radius: number, strength: number): void;
  /** Soft white puffs. */
  mist: EmberSink;
  /** The sea's glowing motes (bioluminescence). */
  glow: EmberSink;
  fx: Pick<SkillFxSink, 'shock' | 'shake'>;
  reducedMotion(): boolean;
}

const tip = new THREE.Vector3();
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * What the sea does when the manta comes up out of it (see MantaSummon): it churns and glows
 * over it, then bursts into a crown of water round it and a column dragged up behind it (water
 * VFX are built in these layers: the crown, a mist that lingers, droplets on gravity), water
 * streams off its wings as it climbs and loops, and the crown rains back in rings.
 */
export class MantaEntranceFx {
  readonly spray: Spray;
  private phase = 'done';
  private debt = { drops: 0, glow: 0, mist: 0, sheet: 0, tips: 0 };
  private rippleT = 0;
  private rainedBack = true;
  private heaved = false;
  private readonly last = new THREE.Vector3();

  constructor(shared: SharedUniforms, private readonly hooks: EntranceHooks) {
    this.spray = new Spray(shared, 'spray', undefined, POOL);
    this.spray.points.name = 'manta-splash';
  }

  /** Every frame (also when idle: the drops fall on). `wingTip(i, out)`: where its tips are. */
  update(dt: number, s: MantaSummon, wingTip: (i: number, out: THREE.Vector3) => boolean): void {
    const h = this.hooks;
    if (s.phase !== this.phase) {
      if (s.phase === 'stir') this.startStir(s);
      this.phase = s.phase;
    }
    if (s.phase === 'stir') this.churn(dt, s);
    if (s.breached) {
      s.breached = false;
      this.breach(s);
    }
    // Water streaming off it: a sheet off the body at first, then drips off the wing tips.
    const since = s.sinceBreach;
    if (since < DRIP.for && dt > 0) {
      const vx = (s.x - this.last.x) / dt;
      const vy = (s.y - this.last.y) / dt;
      const vz = (s.z - this.last.z) / dt;
      const fade = 1 - since / DRIP.for;
      if (since < DRIP.sheetFor) {
        this.debt.sheet += dt * DRIP.sheet;
        while (this.debt.sheet >= 1) {
          this.debt.sheet -= 1;
          this.spray.drop(s.x + rand(-1.8, 1.8), s.y + rand(-0.3, 0.3), s.z + rand(-1.8, 1.8), vx * 0.55 + rand(-1, 1), vy * 0.55 + rand(-1, 1), vz * 0.55 + rand(-1, 1), rand(0.05, 0.13), 2.4);
        }
      }
      this.debt.tips += dt * DRIP.tips * fade;
      while (this.debt.tips >= 1) {
        this.debt.tips -= 1;
        if (!wingTip(Math.random() < 0.5 ? 0 : 1, tip)) break;
        this.spray.drop(tip.x, tip.y, tip.z, vx * 0.3 + rand(-0.4, 0.4), vy * 0.3, vz * 0.3 + rand(-0.4, 0.4), rand(0.04, 0.09), 3);
      }
    }
    // The crown comes back down: rings all round where it broke out.
    if (!this.rainedBack && since >= RAIN_BACK) {
      this.rainedBack = true;
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = rand(2, 7);
        h.wave(s.bx + Math.cos(a) * r, s.bz + Math.sin(a) * r, rand(0.6, 1.2), -rand(0.3, 0.6));
      }
      h.sound('splash', 0.3);
    }
    this.last.set(s.x, s.y, s.z);
    this.spray.update(dt);
  }

  private startStir(s: MantaSummon): void {
    this.rippleT = 0;
    this.rainedBack = true;
    this.heaved = false;
    this.hooks.sound('surge', 1);
    // A slow ring spreading over the water: something is coming.
    this.hooks.fx.shock(s.bx, s.seaY, s.bz, 'water', 0x8fd8ff, CHURN.radius * 2.2, SUMMON.stir, 0);
  }

  /** The sea churning over it, harder and wider as it comes up. */
  private churn(dt: number, s: MantaSummon): void {
    const h = this.hooks;
    const k = Math.min(1, s.t / SUMMON.stir);
    const r = 1 + (CHURN.radius - 1) * k;
    this.debt.drops += dt * CHURN.drops * (0.15 + 0.85 * k * k);
    while (this.debt.drops >= 1) {
      this.debt.drops -= 1;
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      this.spray.drop(s.bx + Math.cos(a) * d, s.seaY, s.bz + Math.sin(a) * d, Math.cos(a) * rand(0, 1.5), rand(1.5, 3 + 6 * k), Math.sin(a) * rand(0, 1.5), rand(0.07, 0.18), 1.8);
    }
    this.debt.glow += dt * CHURN.glow * (0.3 + 0.7 * k);
    while (this.debt.glow >= 1) {
      this.debt.glow -= 1;
      const a = Math.random() * Math.PI * 2;
      const d = rand(0.5, 1.4) * r;
      h.glow.emit(s.bx + Math.cos(a) * d, s.seaY + 0.05, s.bz + Math.sin(a) * d, Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8, rand(0.12, 0.25));
    }
    // Halfway: a second ring and a low wall of water heaving up.
    if (!this.heaved && k >= 0.5) {
      this.heaved = true;
      h.fx.shock(s.bx, s.seaY, s.bz, 'water', 0x8fd8ff, 7, 1.1, 0.8);
      h.fx.shake(s.bx, s.seaY, s.bz, 0.12, 0.8);
    }
    if (k > 0.2) {
      this.debt.mist += dt * CHURN.mist;
      while (this.debt.mist >= 1) {
        this.debt.mist -= 1;
        const a = Math.random() * Math.PI * 2;
        h.mist.emit(s.bx + Math.cos(a) * r * 0.7, s.seaY + 0.3, s.bz + Math.sin(a) * r * 0.7, Math.cos(a) * 0.5, rand(0.3, 0.8), Math.sin(a) * 0.5, rand(1, 1.8));
      }
    }
    this.rippleT -= dt;
    if (this.rippleT <= 0) {
      this.rippleT = CHURN.rippleEvery;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.6;
      h.wave(s.bx + Math.cos(a) * d, s.bz + Math.sin(a) * d, 1.5 + 2 * k, -(0.5 + 1.5 * k));
    }
  }

  /** Out through the surface: the crown, the column, the mist, the shock ring, the boom. */
  private breach(s: MantaSummon): void {
    const h = this.hooks;
    const { bx, bz, seaY } = s;
    const ux = s.fx * Math.cos(SUMMON.pitch);
    const uy = Math.sin(SUMMON.pitch);
    const uz = s.fz * Math.cos(SUMMON.pitch);
    for (let i = 0; i < BREACH.crown; i++) {
      // A ring of water thrown up and out (the crown's fingers break into drops).
      const a = Math.random() * Math.PI * 2;
      const r = BREACH.ring * rand(0.75, 1.25);
      const out = rand(2, 6.5);
      this.spray.drop(bx + Math.cos(a) * r, seaY, bz + Math.sin(a) * r, Math.cos(a) * out, rand(5, 13), Math.sin(a) * out, rand(0.07, 0.2), BREACH.life);
    }
    for (let i = 0; i < BREACH.column; i++) {
      // Dragged up behind it along its climb, slower than it and spreading.
      const v = SUMMON.speed * rand(0.35, 0.8);
      const sx = rand(-1.6, 1.6);
      const sz = rand(-1.6, 1.6);
      this.spray.drop(bx + sx, seaY + rand(0, 1), bz + sz, ux * v + sx * 0.8, uy * v, uz * v + sz * 0.8, rand(0.06, 0.16), BREACH.life);
    }
    for (let i = 0; i < BREACH.mist; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.5, 3.5);
      h.mist.emit(bx + Math.cos(a) * r, seaY + rand(0.2, 3), bz + Math.sin(a) * r, Math.cos(a) * rand(1, 3), rand(0.5, 2.5), Math.sin(a) * rand(1, 3), rand(1, 2));
    }
    h.fx.shock(bx, seaY, bz, 'water', 0xd8f4ff, 13, 1.3, 2.4);
    h.fx.shake(bx, seaY, bz, 0.35, 0.6);
    h.wave(bx, bz, 4, -2.5);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      h.wave(bx + Math.cos(a) * 3.5, bz + Math.sin(a) * 3.5, 1.5, -1);
    }
    h.sound('breach', 1);
    this.rainedBack = false;
  }

  setViewport(heightPx: number, fovDeg: number): void {
    this.spray.setViewport(heightPx, fovDeg);
  }

  dispose(): void {
    this.spray.points.geometry.dispose();
    (this.spray.points.material as THREE.Material).dispose();
  }
}
