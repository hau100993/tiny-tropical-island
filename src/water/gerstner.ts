import * as THREE from 'three';
import { smoothstep } from '../core/math';

/**
 * Gerstner (trochoidal) waves: each wave moves surface points in small circles, which gives
 * sharper crests and flatter troughs than plain sine waves. The same table drives the vertex
 * shader (GPU) and `sampleWaves` (CPU, used to make the boat bob in sync).
 */
interface WaveDef {
  /** Travel direction, radians in the x-z plane. */
  angle: number;
  wavelength: number;
  /** Amplitude in meters at wave strength 1 (stormy). */
  amplitude: number;
  phase: number;
}

const WAVES: WaveDef[] = [
  { angle: 3.6, wavelength: 21, amplitude: 0.55, phase: 0.0 },
  { angle: 3.95, wavelength: 13, amplitude: 0.34, phase: 1.3 },
  { angle: 3.3, wavelength: 8.5, amplitude: 0.2, phase: 2.1 },
  { angle: 4.3, wavelength: 5.3, amplitude: 0.11, phase: 0.7 },
  { angle: 3.0, wavelength: 3.1, amplitude: 0.06, phase: 2.9 },
];

export const NUM_WAVES = WAVES.length;
const GRAVITY = 9.81;
/** Overall crest sharpness (0 = sine waves, 1 = loops start to form). */
const STEEPNESS = 0.55;

interface WaveConst {
  dx: number;
  dz: number;
  k: number;
  amplitude: number;
  omega: number;
  q: number;
  phase: number;
}

const CONSTS: WaveConst[] = WAVES.map((w) => {
  const k = (2 * Math.PI) / w.wavelength;
  return {
    dx: Math.cos(w.angle),
    dz: Math.sin(w.angle),
    k,
    amplitude: w.amplitude,
    // Deep-water dispersion: longer waves travel faster.
    omega: Math.sqrt(GRAVITY * k),
    q: STEEPNESS / (k * w.amplitude * NUM_WAVES),
    phase: w.phase,
  };
});

/**
 * Mean square slope of the waves at strength 1: a sine of slope amplitude k·A has mean square
 * slope (k·A)²/2. The glitter lobe (glitter.glsl) widens by whatever part of it isn't drawn.
 */
export const GERSTNER_MSS = CONSTS.reduce((m, c) => m + (c.k * c.amplitude) ** 2 / 2, 0);

/** Uniform arrays: A = (dir.x, dir.z, k, amplitude), B = (omega, Q, phase, 0). */
export function createWaveUniforms(): { uWaveA: { value: THREE.Vector4[] }; uWaveB: { value: THREE.Vector4[] } } {
  return {
    uWaveA: { value: CONSTS.map((c) => new THREE.Vector4(c.dx, c.dz, c.k, c.amplitude)) },
    uWaveB: { value: CONSTS.map((c) => new THREE.Vector4(c.omega, c.q, c.phase, 0)) },
  };
}

/**
 * Wave amplitude multiplier at a point: global strength, shrinking in shallow water (waves
 * die on the beach) and far from the camera (avoids shimmering). Must match water.vert.
 */
export function waveAttenuation(strength: number, depth: number, distToCamera: number): number {
  return strength * smoothstep(-0.2, 3.0, depth) * (1 - smoothstep(450, 1300, distToCamera));
}

export interface WaveSample {
  height: number;
  dhdx: number;
  dhdz: number;
}

/** CPU twin of the vertex shader's vertical displacement (horizontal motion is ignored). */
export function sampleWaves(
  x: number,
  z: number,
  t: number,
  atten: number,
  distToCamera: number,
  out: WaveSample,
): WaveSample {
  let h = 0;
  let dx = 0;
  let dz = 0;
  for (const c of CONSTS) {
    const lambda = (2 * Math.PI) / c.k;
    const a = c.amplitude * atten * (1 - smoothstep(lambda * 12, lambda * 40, distToCamera));
    const f = c.k * (c.dx * x + c.dz * z) - c.omega * t + c.phase;
    h += a * Math.sin(f);
    const slope = a * c.k * Math.cos(f);
    dx += slope * c.dx;
    dz += slope * c.dz;
  }
  out.height = h;
  out.dhdx = dx;
  out.dhdz = dz;
  return out;
}
