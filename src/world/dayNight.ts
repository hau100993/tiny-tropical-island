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
  type TimeMode,
} from './celestial';
import type { Lighting } from './lighting';
import type { HouseInfo } from './house';
import { smoothstep } from '../core/math';
import { parseJson, readStored, writeStored } from '../core/storage';
import type { SharedUniforms } from '../core/uniforms';

const CLOCK_KEY = 'tsw.clock';
const MOON_COLOR = new THREE.Color('#9fb4ff');

/** What the weather contributes to the sky this frame. */
export interface SkyWeather {
  /** Grey-out from rain/snow/wind (0..1). */
  overcast: number;
  rain: number;
  wetness: number;
}

/** User sky options (from settings). */
export interface SkyOptions {
  mode: TimeMode;
  clouds: number;
  gloom: number;
  rainbow: boolean;
  stars: boolean;
  meteors: number;
  aurora: number;
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
  private meteorSlot = 0;
  private readonly meteorTmp = new THREE.Vector3();
  private elevation = 0;

  constructor(
    private readonly shared: SharedUniforms,
    private readonly lighting: Lighting,
    private readonly house: HouseInfo,
  ) {
    const stored = parseJson(readStored(CLOCK_KEY));
    this.hours = typeof stored === 'number' && stored >= 0 && stored < 24 ? stored : 9.5;
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

  private save(): void {
    writeStored(CLOCK_KEY, this.hours);
  }

  update(dt: number, opts: SkyOptions, weather: SkyWeather, camera: THREE.PerspectiveCamera): void {
    const u = this.shared;
    this.hours = advanceTime(this.hours, opts.mode, dt, new Date());
    this.saveTimer += dt;
    if (this.saveTimer > 30) {
      this.saveTimer = 0;
      this.save();
    }

    sunDirection(this.hours, this.sun);
    moonDirection(this.hours, this.moon);
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
    const moonI = 0.35 * (1 - sunUp) * smoothstep(0.0, 0.15, this.moon.y) * (1 - 0.6 * oc);
    const useSun = sunUp > 0.5;
    const dir = useSun ? this.sun : this.moon;
    this.tmp.copy(useSun ? u.uSunColor.value : MOON_COLOR);
    this.lighting.setMain(dir, this.tmp, useSun ? sunI * sunUp : moonI);
    u.uLightDir.value.copy(dir);
    u.uLightColor.value.copy(this.tmp).multiplyScalar(useSun ? Math.min(1, sunI / 2.6) : moonI * 2.2);
    this.lighting.setHemi(p.hemiSky, p.hemiGround, p.hemiIntensity * (1 - 0.25 * oc));

    // House: windows and the porch lantern glow from dusk to dawn.
    const lamps = smoothstep(0.08, -0.06, e);
    this.house.windowMaterial.emissiveIntensity = lamps * 1.6;
    this.house.lamp.intensity = lamps * 6;

    // Clouds: base cover, more with bad weather; they drift with the wind.
    u.uCloudCover.value = Math.min(1, Math.max(opts.clouds, oc * 0.95));
    const drift = (0.004 + u.uWind.value * 0.02) * dt;
    u.uCloudOffset.value.x += u.uWindDir.value.x * drift;
    u.uCloudOffset.value.y += u.uWindDir.value.y * drift;

    const clearNight = u.uNight.value * (1 - u.uCloudCover.value * 0.9);
    u.uStars.value = opts.stars ? 1 : 0;
    u.uAurora.value = opts.aurora * clearNight;
    // A rainbow needs sun behind you, rain just passed (wet air) and not raining hard any more.
    const lowSun = smoothstep(0.02, 0.1, e) * (1 - smoothstep(0.45, 0.65, e));
    u.uRainbow.value = opts.rainbow ? lowSun * smoothstep(0.15, 0.5, weather.wetness) * (1 - smoothstep(0.1, 0.4, weather.rain)) * (1 - oc * 0.5) : 0;

    this.updateMeteors(opts.meteors * clearNight, camera);
  }

  /**
   * Spawns occasional shooting stars into two uniform slots. They start inside the visible
   * part of the sky (from the camera's view), otherwise most would fall behind the viewer or
   * above the top of the screen — the orbit camera mostly looks down at the island.
   */
  private updateMeteors(rate: number, camera: THREE.PerspectiveCamera): void {
    const u = this.shared;
    const t = u.uTime.value;
    if (rate <= 0.01) {
      this.nextMeteor = t + 2;
      return;
    }
    if (t < this.nextMeteor) return;
    // Average gap shrinks with the slider: ~25 s at the low end, ~4 s at the top.
    this.nextMeteor = t + (4 + 21 * (1 - rate)) * (0.5 + Math.random());

    const fwd = camera.getWorldDirection(this.meteorTmp);
    const camAz = Math.atan2(fwd.z, fwd.x);
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    const halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    // Altitude band between just above the horizon and near the top of the screen.
    const lo = Math.max(0.06, pitch - halfV * 0.5);
    const hi = Math.max(lo + 0.08, Math.min(1.3, pitch + halfV * 0.55));
    const alt = lo + Math.random() * (hi - lo);
    const az = camAz + (Math.random() * 2 - 1) * halfH * 0.7;
    const start = new THREE.Vector3(Math.cos(az) * Math.cos(alt), Math.sin(alt), Math.sin(az) * Math.cos(alt));
    // Travel mostly sideways and a little down (never below the horizon).
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
    const len = 0.18 + Math.random() * 0.2;
    const drop = Math.min(len * 0.5, Math.max(0, alt - 0.04));
    const end = start.clone().addScaledVector(side, len).add(new THREE.Vector3(0, -drop, 0)).normalize();
    const i = this.meteorSlot;
    this.meteorSlot = (this.meteorSlot + 1) % 2;
    u.uMeteorA.value[i].set(start.x, start.y, start.z, t);
    u.uMeteorB.value[i].set(end.x, end.y, end.z, 0.9 + Math.random() * 0.7);
  }

  get sunElevation(): number {
    return this.elevation;
  }
}

/** Blends a color toward its own grey (luminance) — overcast without changing brightness much. */
function greyOut(c: THREE.Color, amount: number, tmp: THREE.Color): void {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  tmp.setRGB(l, l, l);
  c.lerp(tmp, amount);
}
