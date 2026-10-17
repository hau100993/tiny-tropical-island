import * as THREE from 'three';
import { smoothstep } from '../core/math';

/**
 * Sun, moon and sky palette as pure functions of the time of day (hours, 0–24).
 * Unit-tested; the DayNight class only applies the results to the scene.
 */

/** Tilt of the sun's daily arc toward +Z (radians): noon sun is high but not overhead. */
const ARC_TILT = 0.35;

/** Sun rises in the east (+X) at 06:00, culminates at 12:00, sets in the west (−X) at 18:00. */
export function sunDirection(hours: number, out = new THREE.Vector3()): THREE.Vector3 {
  const theta = ((hours - 6) / 24) * Math.PI * 2;
  return out.set(Math.cos(theta), Math.sin(theta) * Math.cos(ARC_TILT), Math.sin(theta) * Math.sin(ARC_TILT)).normalize();
}

/** Moon opposite the sun in height, mirrored in Z so it isn't exactly antipodal. */
export function moonDirection(hours: number, out = new THREE.Vector3()): THREE.Vector3 {
  sunDirection(hours, out);
  return out.set(-out.x, -out.y, out.z * 0.6 + 0.25).normalize();
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

/** Night → twilight → sunrise/sunset → golden hour → day, keyed by sun elevation. */
const KEYS: Key[] = [
  key(-0.3, '#040917', '#0b1730', '#7d8fd0', 0, '#1d2c50', '#0a0d12', 0.35),
  key(-0.1, '#0f1a3f', '#3a3561', '#ff8a5c', 0, '#3c4370', '#14141a', 0.45),
  key(0.0, '#2a3d78', '#f08a5d', '#ff8a4c', 0.5, '#7a6f8f', '#3a2f2a', 0.6),
  key(0.1, '#4479bf', '#ffc08a', '#ffbe7a', 1.7, '#b9c3d8', '#8a7a60', 0.85),
  key(0.3, '#2f7fd6', '#bfe2f5', '#fff0d4', 2.6, '#cfe8ff', '#c9b68a', 1.1),
];

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

export type TimeMode = 'real' | 'cycle24' | 'cycle6' | 'paused';

/** Advances the clock. Cycle modes compress a day into 24 or 6 real minutes. */
export function advanceTime(hours: number, mode: TimeMode, dt: number, now: Date): number {
  switch (mode) {
    case 'real':
      return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    case 'cycle24':
      return (hours + (dt * 24) / (24 * 60)) % 24;
    case 'cycle6':
      return (hours + (dt * 24) / (6 * 60)) % 24;
    case 'paused':
      return hours;
  }
}

export function formatClock(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
