import * as THREE from 'three';
import { Precipitation } from './precipitation';
import { overcast, particleAmounts, stepAccumulation, type Accumulation } from './accumulation';
import { gustShape } from './wind';
import { SmoothedValue } from '../core/envState';
import type { QualityProfile } from '../core/quality';
import type { SharedUniforms } from '../core/uniforms';
import type { WaterSystem } from '../water/WaterSystem';

export interface WeatherTargets {
  rain: number;
  snow: number;
  wind: number;
}

/** Rain splashes per second on the water at full rain. Each is a tiny drop in the ripple sim. */
const SPLASHES_PER_SECOND = 140;
/** Radius around the island center where splashes land (inside the simulated square). */
const SPLASH_RADIUS = 95;

/**
 * Turns the three weather intensities into everything you see: particles, wind gusts,
 * wet/snowy surfaces (via shared uniforms) and raindrop ripples. It also reports how overcast
 * the sky should be; DayNight greys the time-of-day palette by that amount.
 */
export class Weather {
  readonly rainFx: Precipitation;
  readonly snowFx: Precipitation;
  private readonly rain = new SmoothedValue(0, 0.5);
  private readonly snow = new SmoothedValue(0, 0.5);
  private readonly wind = new SmoothedValue(0, 0.5);
  private acc: Accumulation = { wetness: 0, snowCover: 0 };
  private splashDebt = 0;
  /** Sky grey-out from current weather (applied by DayNight on top of the time-of-day palette). */
  overcast = 0;

  constructor(
    scene: THREE.Scene,
    private readonly shared: SharedUniforms,
    private readonly water: WaterSystem,
  ) {
    this.rainFx = new Precipitation(
      {
        kind: 'rain',
        maxCount: 25000,
        box: new THREE.Vector3(50, 36, 50),
        fall: 13,
        size: new THREE.Vector2(0.03, 1.0),
        color: '#d0dde6',
        opacity: 0.42,
        driftPerGust: 7,
      },
      shared,
    );
    this.snowFx = new Precipitation(
      {
        kind: 'snow',
        maxCount: 15000,
        box: new THREE.Vector3(44, 30, 44),
        fall: 1.3,
        size: new THREE.Vector2(0.11, 0),
        color: '#f4f7fb',
        opacity: 0.9,
        driftPerGust: 3.5,
      },
      shared,
    );
    scene.add(this.rainFx.mesh, this.snowFx.mesh);
  }

  get particleMeshes(): THREE.Object3D[] {
    return [this.rainFx.mesh, this.snowFx.mesh];
  }

  setTargets(t: WeatherTargets): void {
    this.rain.target = t.rain;
    this.snow.target = t.snow;
    this.wind.target = t.wind;
  }

  /** Jump straight to the targets (first frame), instead of easing in from clear weather. */
  snapToTargets(): void {
    this.rain.value = this.rain.target;
    this.snow.value = this.snow.target;
    this.wind.value = this.wind.target;
  }

  setQuality(profile: QualityProfile): void {
    this.rainFx.setQualityMax(profile.rainCount);
    this.snowFx.setQualityMax(profile.snowCount);
  }

  /** Extra sea roughness from wind, added to the wave-strength slider. */
  get seaBoost(): number {
    return this.wind.value * 0.35 * (0.5 + 0.5 * gustShape(this.lastWall));
  }

  private lastWall = 0;

  /** @param wall wall-clock seconds (same time base as the wind audio). */
  update(dt: number, wall: number): void {
    this.lastWall = wall;
    this.rain.update(dt);
    this.snow.update(dt);
    this.wind.update(dt);
    const rain = this.rain.value;
    const snow = this.snow.value;
    const wind = this.wind.value;

    this.acc = stepAccumulation(this.acc, rain, snow, dt);
    const u = this.shared;
    u.uRain.value = rain;
    u.uSnow.value = snow;
    u.uWind.value = wind;
    u.uGust.value = wind * gustShape(wall);
    u.uWetness.value = this.acc.wetness;
    u.uSnowCover.value = this.acc.snowCover;

    const amounts = particleAmounts(rain, snow);
    this.rainFx.update(amounts.rain, dt);
    this.snowFx.update(amounts.snow, dt);

    // Raindrops hitting the sea: random tiny splashes in the ripple simulation.
    this.splashDebt += amounts.rain * SPLASHES_PER_SECOND * dt;
    while (this.splashDebt >= 1) {
      this.splashDebt -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SPLASH_RADIUS;
      this.water.addRipple(Math.cos(a) * r, Math.sin(a) * r, 0.7, -0.06);
    }

    this.overcast = overcast(rain, snow, wind);
  }

  get wetness(): number {
    return this.acc.wetness;
  }

  get rainAmount(): number {
    return this.rain.value;
  }
}
