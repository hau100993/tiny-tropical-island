import * as THREE from 'three';
import { smoothstep } from '../core/math';

/**
 * Sun, moon and sky palette as pure functions of the time of day (hours, 0–24).
 * Unit-tested; the DayNight class only applies the results to the scene.
 */

/** Tilt of the sun's daily arc toward +Z (radians): noon sun is high but not overhead. */
const ARC_TILT = 0.35;

/**
 * Sun rises in the east (+X) at 06:00, culminates at 12:00, sets in the west (−X) at 18:00.
 * `turn` (radians) rotates the whole sky around the vertical: a scene can bring its sunrise,
 * sunset or moon into the desk window (see ScenePreset.skyTurn).
 */
export function sunDirection(hours: number, out = new THREE.Vector3(), turn = 0): THREE.Vector3 {
  const theta = ((hours - 6) / 24) * Math.PI * 2;
  out.set(Math.cos(theta), Math.sin(theta) * Math.cos(ARC_TILT), Math.sin(theta) * Math.sin(ARC_TILT)).normalize();
  return turnSky(out, turn);
}

/** Moon opposite the sun in height, mirrored in Z so it isn't exactly antipodal. */
export function moonDirection(hours: number, out = new THREE.Vector3(), turn = 0): THREE.Vector3 {
  sunDirection(hours, out);
  out.set(-out.x, -out.y, out.z * 0.6 + 0.25).normalize();
  return turnSky(out, turn);
}

/**
 * The sky turn (degrees) that puts the sun, or at night the moon, at azimuth `viewAz` +
 * `offset` (radians; atan2(z, x)) for this time: e.g. into the desk window. 0 when neither is up.
 */
export function windowSkyTurn(hours: number, viewAz: number, offset = (-15 * Math.PI) / 180): number {
  const v = new THREE.Vector3();
  if (sunDirection(hours, v).y < -0.03 && moonDirection(hours, v).y < -0.03) return 0;
  const a = viewAz + offset - Math.atan2(v.z, v.x);
  return Math.round((Math.atan2(Math.sin(a), Math.cos(a)) * 180) / Math.PI);
}

/** Rotates a sky direction around +Y so its azimuth atan2(z, x) grows by `turn`. */
export function turnSky(v: THREE.Vector3, turn: number): THREE.Vector3 {
  if (turn === 0) return v;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return v.set(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
}

export interface SkyPalette {
  top: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
}

interface Key extends SkyPalette {
  /** Sun elevation (sin of altitude) where this key applies. */
  e: number;
}

const key = (e: number, top: string, horizon: string, sun: string, sunIntensity: number, hemiSky: string, hemiGround: string, hemiIntensity: number): Key => ({
  e,
  top: new THREE.Color(top),
  horizon: new THREE.Color(horizon),
  sun: new THREE.Color(sun),
  sunIntensity,
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemiIntensity,
});

/**
 * Night → blue hour → sunset/sunrise → golden hour → day, keyed by sun elevation (sin of its
 * altitude; 0.1 ≈ 6°). These colours apply in every direction, so around sunset the horizon
 * key is a neutral lilac-grey: the orange and gold are added toward the sun only, in
 * skyColor() (skyCommon.glsl). Blue hour: the sun 4–10° below, deep blue sky with a lilac-pink horizon.
 * Golden hour: the sun low, warm light and long shadows; the sky light (hemi) stays bluish, so
 * shadows turn cool against the warm sunlit side.
 */
const KEYS: Key[] = [
  key(-0.3, '#040917', '#0b1730', '#7d8fd0', 0, '#1d2c50', '#0a0d12', 0.35),
  key(-0.16, '#0b1640', '#2b2f5e', '#ff7a6a', 0, '#2a3360', '#101118', 0.4),
  key(-0.07, '#1c2e6a', '#6f5a8c', '#ff6a4a', 0, '#4a5288', '#1a1820', 0.5),
  key(0.0, '#2c4686', '#9a8aa8', '#ff6a30', 0.6, '#8a7a9a', '#4a3428', 0.62),
  key(0.04, '#36599e', '#b4a8b8', '#ff8a40', 1.1, '#9da6c8', '#6a5038', 0.72),
  key(0.12, '#4479bf', '#d8d2cc', '#ffc27a', 1.9, '#a9b8dc', '#8a7a60', 0.88),
  key(0.3, '#2f7fd6', '#bfe2f5', '#fff0d4', 2.6, '#cfe8ff', '#c9b68a', 1.1),
];

const DAWN_SUN = new THREE.Color('#ffc070');
const DAWN_HEMI = new THREE.Color('#e8b090');
const DUSK_SUN = new THREE.Color('#ffa040');

/**
 * Sunrise and sunset light: golden-peach in the morning, amber-orange in the evening. Only the
 * sunlight and the light on the island change here; the sky's colours depend on the direction
 * you look (warm toward the sun, cool away from it) and are made in the sky shader.
 * `morning` is 1 before noon, 0 after.
 */
export function dawnDuskShift(p: SkyPalette, elevation: number, morning: number): SkyPalette {
  const tw = 1 - smoothstep(0.0, 0.25, Math.abs(elevation));
  const up = smoothstep(-0.06, 0.02, elevation);
  const evening = 1 - morning;
  p.sun.lerp(DAWN_SUN, 0.6 * tw * morning);
  p.hemiSky.lerp(DAWN_HEMI, 0.35 * tw * up * morning);
  p.sun.lerp(DUSK_SUN, 0.5 * tw * evening);
  return p;
}

/** Interpolated palette for a sun elevation (smooth between keys). */
export function paletteFor(elevation: number, out: SkyPalette): SkyPalette {
  const e = Math.min(KEYS[KEYS.length - 1].e, Math.max(KEYS[0].e, elevation));
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smoothstep(a.e, b.e, e);
  out.top.copy(a.top).lerp(b.top, t);
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.sunIntensity = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * t;
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.hemiIntensity = a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * t;
  return out;
}

export function createPalette(): SkyPalette {
  return {
    top: new THREE.Color(),
    horizon: new THREE.Color(),
    sun: new THREE.Color(),
    sunIntensity: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 0,
  };
}

/** 0 = night … 1 = day, with a floor so moonlit scenes stay readable. */
export function dayLight(elevation: number): number {
  return 0.1 + 0.9 * smoothstep(-0.12, 0.25, elevation);
}

/** 0 = day … 1 = dark enough for stars. */
export function nightness(elevation: number): number {
  return 1 - smoothstep(-0.22, 0.0, elevation);
}

/** 'real': the computer's clock. 'free': the island's own clock, set by hand, at any speed. */
export type TimeMode = 'real' | 'free';

/** Island seconds per real second. ×60: a day in 24 minutes; ×240: a day in 6 minutes. */
export const TIME_SPEEDS = [1, 10, 30, 60, 240] as const;
export type TimeSpeed = (typeof TIME_SPEEDS)[number];

export interface ClockOptions {
  mode: TimeMode;
  speed: TimeSpeed;
  paused: boolean;
}

/** Advances the clock by `dt` real seconds. */
export function advanceTime(hours: number, clock: Readonly<ClockOptions>, dt: number, now: Date): number {
  if (clock.mode === 'real') {
    return now.getHours() + now.getMinutes() / 60 + (now.getSeconds() + now.getMilliseconds() / 1000) / 3600;
  }
  if (clock.paused) return hours;
  return (hours + (dt * clock.speed) / 3600) % 24;
}

export function formatClock(hours: number): string {
  // Whole minutes, with a little slack so 17.7 h reads 17:42, not 17:41 (17.7 × 60 = 1061.99…).
  const total = Math.floor((((hours % 24) + 24) % 24) * 60 + 1e-6);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** hh:mm:ss */
export function formatClockSeconds(hours: number): string {
  // (+1e-6: 14.51 h is 52235.99999… s in floating point, which must still read :36.)
  const total = Math.floor((((hours % 24) + 24) % 24) * 3600 + 1e-6) % 86400;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
