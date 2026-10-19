import * as THREE from 'three';
import {
  advanceTime,
  createPalette,
  dayLight,
  moonDirection,
  nightness,
  paletteFor,
  sunDirection,
  type SkyPalette,
  type ClockOptions,
} from './celestial';
import type { Lighting } from './lighting';
import type { HouseInfo } from './house';
import { smoothstep } from '../core/math';
import { parseJson, readStored, writeStored } from '../core/storage';
import { METEOR_SLOTS, type SharedUniforms } from '../core/uniforms';

const CLOCK_KEY = 'tsw.clock';
const SKY_TURN_KEY = 'tsw.skyTurn';
/** Seconds (time constant) for the sky to swing to a new scene's direction. */
const TURN_EASE = 1.2;
const MOON_COLOR = new THREE.Color('#9fb4ff');
const MOON_LOW_COLOR = new THREE.Color('#ffb27a');

/** What the weather contributes to the sky this frame. */
export interface SkyWeather {
  /** Grey-out from rain/snow/wind (0..1). */
  overcast: number;
  rain: number;
  wetness: number;
}

/** User sky options (from settings). */
export interface SkyOptions {
  clock: ClockOptions;
  clouds: number;
  gloom: number;
  rainbow: boolean;
  stars: boolean;
  meteors: number;
  aurora: number;
  /** 0.3 = normal moon, 1 = big bright full moon. */
  moonlight: number;
}

/**
 * The clock and everything that follows from it: sun and moon, the sky palette (blended with
 * overcast), lights, house lamps, cloud drift, stars, aurora, rainbow and shooting stars.
 */
export class DayNight {
  hours: number;
  private readonly sun = new THREE.Vector3();
  private readonly moon = new THREE.Vector3();
  private readonly palette: SkyPalette = createPalette();
  private readonly grey = new THREE.Color();
  private readonly tmp = new THREE.Color();
  private saveTimer = 0;
  private nextMeteor = 0;
  private readonly meteorTmp = new THREE.Vector3();
  private readonly meteorStart = new THREE.Vector3();
  private readonly meteorEnd = new THREE.Vector3();
  private readonly meteorSide = new THREE.Vector3();
  private readonly meteorUp = new THREE.Vector3();
  private elevation = 0;
  /** Sky turn (radians): current, eased toward the target. */
  private turn = 0;
  private turnTarget = 0;

  constructor(
    private readonly shared: SharedUniforms,
    private readonly lighting: Lighting,
    private readonly house: HouseInfo,
  ) {
    const stored = parseJson(readStored(CLOCK_KEY));
    this.hours = typeof stored === 'number' && stored >= 0 && stored < 24 ? stored : 9.5;
    const turn = parseJson(readStored(SKY_TURN_KEY));
    this.turn = this.turnTarget = typeof turn === 'number' && Number.isFinite(turn) ? wrapAngle(turn) : 0;
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => this.save());
  }

  /** 0 = day … 1 = night (for audio: birds fall silent, crickets start). */
  get night(): number {
    return this.shared.uNight.value;
  }

  setHours(h: number): void {
    this.hours = ((h % 24) + 24) % 24;
    this.save();
  }

  /** Sky direction for a scene, in degrees (0 = the real east-west arc). Swings there smoothly. */
  setSkyTurn(degrees: number): void {
    this.turnTarget = wrapAngle((degrees * Math.PI) / 180);
    writeStored(SKY_TURN_KEY, this.turnTarget);
  }

  /** The sky direction being turned to, in degrees. */
  get skyTurn(): number {
    return Math.round((this.turnTarget * 180) / Math.PI);
  }

  private save(): void {
    writeStored(CLOCK_KEY, this.hours);
  }

  update(dt: number, opts: SkyOptions, weather: SkyWeather, camera: THREE.PerspectiveCamera): void {
    const u = this.shared;
    this.hours = advanceTime(this.hours, opts.clock, dt, new Date());
    this.saveTimer += dt;
    if (this.saveTimer > 30) {
      this.saveTimer = 0;
      this.save();
    }

    // Shortest way round to the target direction.
    this.turn += wrapAngle(this.turnTarget - this.turn) * (1 - Math.exp(-dt / TURN_EASE));
    if (Math.abs(wrapAngle(this.turnTarget - this.turn)) < 1e-4) this.turn = this.turnTarget;
    u.uSkyTurn.value = this.turn;
    sunDirection(this.hours, this.sun, this.turn);
    moonDirection(this.hours, this.moon, this.turn);
    const e = this.sun.y;
    this.elevation = e;
    u.uSunDir.value.copy(this.sun);
    u.uMoonDir.value.copy(this.moon);
    u.uDayLight.value = dayLight(e);
    u.uNight.value = nightness(e);
    // The sky turns once a day: stars wheel around slowly.
    u.uStarRotation.value = (this.hours / 24) * Math.PI * 2;

    // Base palette for this time, then grey it toward overcast (luminance-preserving, so a
    // cloudy night is dark grey, a cloudy noon light grey).
    const p = paletteFor(e, this.palette);
    const oc = Math.min(1, Math.max(weather.overcast, opts.gloom));
    greyOut(u.uSkyTop.value.copy(p.top), oc * 0.85, this.grey);
    greyOut(u.uSkyHorizon.value.copy(p.horizon), oc * 0.85, this.grey);
    greyOut(u.uSunColor.value.copy(p.sun), oc * 0.7, this.grey);

    // Main light: the sun by day, the moon by night, crossfading while both are near zero.
    const sunUp = smoothstep(-0.04, 0.02, e);
    const sunI = p.sunIntensity * (1 - 0.65 * oc);
    // Moonlight: ×1 at the normal setting (0.3), up to ×2 for a bright full moon.
    const moonBoost = 0.55 + 1.5 * opts.moonlight;
    const moonI = 0.35 * moonBoost * (1 - sunUp) * smoothstep(0.0, 0.15, this.moon.y) * (1 - 0.6 * oc);
    const useSun = sunUp > 0.5;
    const dir = useSun ? this.sun : this.moon;
    // Moonlight is orange while the moon is low (like the disc, see moonTint in skyCommon.glsl).
    if (useSun) this.tmp.copy(u.uSunColor.value);
    else this.tmp.copy(MOON_LOW_COLOR).lerp(MOON_COLOR, smoothstep(0.02, 0.35, this.moon.y));
    this.lighting.setMain(dir, this.tmp, useSun ? sunI * sunUp : moonI);
    u.uLightDir.value.copy(dir);
    u.uLightColor.value.copy(this.tmp).multiplyScalar(useSun ? Math.min(1, sunI / 2.6) : moonI * 2.2);
    // A bright moon also lifts the night ambient a little (silvery island, readable shadows).
    const moonAmbient = 1 + 0.6 * Math.max(0, opts.moonlight - 0.3) * u.uNight.value * (1 - oc);
    this.lighting.setHemi(p.hemiSky, p.hemiGround, p.hemiIntensity * (1 - 0.25 * oc) * moonAmbient);

    // House: lamp shades and the wall light glow from dusk to dawn; by day a soft bounce
    // light keeps the room readable next to the bright sea outside the glass.
    const lamps = smoothstep(0.08, -0.06, e);
    this.house.windowMaterial.emissiveIntensity = lamps * 1.6;
    this.house.lamp.intensity = lamps * 4;
    this.house.roomLamp.intensity = lamps * 5;
    this.house.fillLight.intensity = sunUp * (1 - 0.5 * oc) * 2.2 + lamps * 0.6;

    // Clouds: base cover, more with bad weather; they drift with the wind.
    u.uCloudCover.value = Math.min(1, Math.max(opts.clouds, oc * 0.95));
    const drift = (0.004 + u.uWind.value * 0.02) * dt;
    u.uCloudOffset.value.x += u.uWindDir.value.x * drift;
    u.uCloudOffset.value.y += u.uWindDir.value.y * drift;

    const clearNight = u.uNight.value * (1 - u.uCloudCover.value * 0.9);
    u.uStars.value = opts.stars ? 1 : 0;
    u.uAurora.value = opts.aurora * clearNight;
    // Clouds hide the extra glow, back toward the normal moon.
    u.uMoonGlow.value = 0.3 + (opts.moonlight - 0.3) * (1 - u.uCloudCover.value * 0.8) * (1 - oc);
    // A rainbow needs sun behind you, rain just passed (wet air) and not raining hard any more.
    const lowSun = smoothstep(0.02, 0.1, e) * (1 - smoothstep(0.45, 0.65, e));
    u.uRainbow.value = opts.rainbow ? lowSun * smoothstep(0.15, 0.5, weather.wetness) * (1 - smoothstep(0.1, 0.4, weather.rain)) * (1 - oc * 0.5) : 0;

    this.updateMeteors(opts.meteors * clearNight, camera);
  }

  /**
   * Spawns shooting stars into the uniform slots: now and then one to three at once, each with
   * its own direction, length, speed and brightness. They start inside the part of the sky the
   * camera can see; the orbit camera mostly looks down at the island, so a random spot in the
   * whole sky would usually be off screen.
   */
  private updateMeteors(rate: number, camera: THREE.PerspectiveCamera): void {
    const u = this.shared;
    const t = u.uTime.value;
    if (rate <= 0.01) {
      this.nextMeteor = t + 2;
      return;
    }
    if (t < this.nextMeteor) return;
    // Average gap shrinks with the slider: ~20 s at the low end, ~2 s at the top.
    this.nextMeteor = t + (2 + 18 * (1 - rate)) * (0.3 + Math.random() * 1.4);

    const fwd = camera.getWorldDirection(this.meteorTmp);
    const camAz = Math.atan2(fwd.z, fwd.x);
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    const halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    // Altitude band between just above the horizon and near the top of the screen.
    const top = pitch + halfV;
    if (top <= 0.02) return; // no sky on screen
    let lo = Math.max(0.1, pitch - halfV * 0.5);
    let hi = Math.min(1.3, pitch + halfV * 0.7);
    if (hi < lo + 0.05) {
      // Looking down from high up: only a thin strip of sky above the horizon is visible.
      lo = 0.012;
      hi = Math.max(lo + 0.01, top * 0.85);
    }

    const r = Math.random();
    const count = r < 0.65 ? 1 : r < 0.9 ? 2 : 3;
    for (let k = 0; k < count; k++) {
      const alt = lo + Math.random() * (hi - lo);
      const az = camAz + (Math.random() * 2 - 1) * halfH * 0.85;
      const ca = Math.cos(alt);
      const sa = Math.sin(alt);
      const start = this.meteorStart.set(Math.cos(az) * ca, sa, Math.sin(az) * ca);
      // Direction on the sky at the start point: mostly falling (any angle in the lower half),
      // sometimes any direction at all.
      const theta = Math.random() < 0.8 ? -Math.PI * (0.05 + Math.random() * 0.9) : Math.random() * Math.PI * 2;
      const side = this.meteorSide.set(-Math.sin(az), 0, Math.cos(az));
      const up = this.meteorUp.set(-sa * Math.cos(az), ca, -sa * Math.sin(az));
      let len = 0.05 + Math.random() * Math.random() * 0.3;
      // Shorten paths that would dip below the horizon.
      const dy = Math.sin(theta) * ca;
      if (dy < 0) len = Math.min(len, Math.max(0.02, (alt - Math.min(0.03, alt * 0.5)) / -dy));
      const end = this.meteorEnd
        .copy(start)
        .addScaledVector(side, Math.cos(theta) * len)
        .addScaledVector(up, Math.sin(theta) * len)
        .normalize();
      // Use a slot whose meteor has burnt out, so none vanishes mid-flight.
      const i = this.freeMeteorSlot(t);
      if (i < 0) return;
      // Slight stagger inside a group; short streaks take ~1.5 s, long ones up to ~4 s.
      const delay = k * (0.1 + Math.random() * 0.6);
      u.uMeteorA.value[i].set(start.x, start.y, start.z, t + delay);
      u.uMeteorB.value[i].set(end.x, end.y, end.z, (1.3 + Math.random() * 0.9) * (0.8 + len * 4));
    }
  }

  private freeMeteorSlot(t: number): number {
    const a = this.shared.uMeteorA.value;
    const b = this.shared.uMeteorB.value;
    for (let i = 0; i < METEOR_SLOTS; i++) if (t > a[i].w + b[i].w) return i;
    return -1;
  }

  get sunElevation(): number {
    return this.elevation;
  }
}

/** Wraps an angle to (−π, π]. */
function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Blends a color toward its own grey (luminance) — overcast without changing brightness much. */
function greyOut(c: THREE.Color, amount: number, tmp: THREE.Color): void {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  tmp.setRGB(l, l, l);
  c.lerp(tmp, amount);
}
