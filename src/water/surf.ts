import { smoothstep } from '../core/math';

/**
 * The surf break: a train of steep crests rolling onto one beach, on top of the Gerstner sea.
 * Same formula on the GPU (surfGlsl, in the water vertex shader) and on the CPU (sampleSurf, for
 * the board, the kayak and the swimmer), so what you ride is what you see.
 *
 * Surf frame: x along the swell toward the beach (0 at the waterline, negative offshore),
 * l along the beach. Each crest is one bump per wavelength with a short steep face in front and
 * a long gentle back. A crest grows as it comes in, and from the break line on it "peels": the
 * breaking point runs along the crest from one end (l = PEEL_START) at PEEL_SPEED, white water
 * tumbling down the face behind it and a band of foam (the soup) trailing the broken part. Near
 * the beach every crest breaks (close-out) and fades into the swash.
 *
 * Everything is a closed form of (x, l, t): no state, so GPU and CPU always agree.
 */
export const SURF = {
  /** Wavelength (m) and speed toward the beach (m/s): a set every ~13 s. */
  length: 40,
  speed: 3,
  /** Face and back widths, as fractions of the wavelength (Gaussian half widths). */
  face: 0.075,
  back: 0.24,
  /** Offshore start (crests grow from here), the break line, where every crest closes out. */
  start: -115,
  breakAt: -42,
  closeOut: -9,
  /** Half width of the break along the beach (m). */
  halfWidth: 55,
  /** The peel: where along the crest the breaking starts, and how fast it runs (m/s). */
  peelStart: -48,
  peelSpeed: 5,
} as const;

/** Mean of the crest shape over a wavelength (subtracted so the mean water level stays put). */
const MEAN = ((SURF.face + SURF.back) * Math.sqrt(Math.PI)) / 2;

/** Crest height (m, trough to crest ≈ this) for the sea slider: a rideable wave even when calm. */
const AMP = { base: 1.6, perStrength: 0.5 } as const;

export function surfAmplitude(strength: number): number {
  return AMP.base + AMP.perStrength * strength;
}

/** Where the break is: its waterline origin and the unit direction toward the beach. */
export interface SurfFrame {
  ox: number;
  oz: number;
  ux: number;
  uz: number;
}

export interface SurfSample {
  /** Height (m) added to the sea, and its slope. */
  height: number;
  dhdx: number;
  dhdz: number;
  /** Water velocity (m/s) the wave carries, toward the beach (negative: back out). */
  push: number;
  /** 0..1: how broken the wave is here (white water). */
  broken: number;
  /** Position in the wave: −0.5 … 0.5 wavelengths from the crest (> 0: on the face). */
  d: number;
  /** Envelope 0..1 (no wave → 0). */
  size: number;
  /** Surf-frame coordinates. */
  x: number;
  l: number;
}

/** Height and foam terms at surf-frame (x, l), time t; `depth` = water depth there. */
function wave(x: number, l: number, t: number, amp: number, depth: number, out: SurfSample): number {
  const S = SURF;
  out.x = x;
  out.l = l;
  if (x < S.start || x > 2 || Math.abs(l) > S.halfWidth + 6) {
    out.broken = 0;
    out.d = 0;
    out.size = 0;
    out.push = 0;
    return 0;
  }
  const psi = (x - S.speed * t) / S.length;
  const d = psi - Math.floor(psi) - 0.5;
  const shape = d > 0 ? Math.exp(-((d / S.face) ** 2)) : Math.exp(-((d / S.back) ** 2));
  // This crest's position and the time since it crossed the break line.
  const xc = x - d * S.length;
  const tau = (xc - S.breakAt) / S.speed;
  const peel = S.peelStart + S.peelSpeed * tau;
  let broken = tau > 0 ? smoothstep(peel + 4, peel - 4, l) : 0;
  broken = Math.max(broken, smoothstep(S.closeOut - 6, S.closeOut, xc));
  const size =
    smoothstep(S.start, S.breakAt, x) *
    (1 - smoothstep(-14, -2, x)) *
    (1 - smoothstep(S.halfWidth - 15, S.halfWidth + 5, Math.abs(l))) *
    smoothstep(-0.1, 0.8, depth);
  out.broken = broken * size;
  out.d = d;
  out.size = size;
  // Orbital motion: forward under the crest, back under the trough (no net drift).
  out.push = S.speed * (shape - MEAN) * size;
  // A broken crest slumps (only the bump: the trough stays, so nothing jumps where d wraps).
  return amp * size * (shape * (1 - 0.45 * broken) - MEAN);
}

const tmp: SurfSample = { height: 0, dhdx: 0, dhdz: 0, push: 0, broken: 0, d: 0, size: 0, x: 0, l: 0 };

/**
 * CPU twin of surfWave() in the shader. `depthAt` gives the water depth (the GPU uses the
 * terrain texture); slopes by central differences, like the shader's normals.
 */
export function sampleSurf(
  frame: SurfFrame,
  px: number,
  pz: number,
  t: number,
  strength: number,
  depthAt: (x: number, z: number) => number,
  out: SurfSample,
): SurfSample {
  const amp = surfAmplitude(strength);
  const at = (wx: number, wz: number, o: SurfSample): number => {
    const rx = wx - frame.ox;
    const rz = wz - frame.oz;
    return wave(rx * frame.ux + rz * frame.uz, -rx * frame.uz + rz * frame.ux, t, amp, depthAt(wx, wz), o);
  };
  out.height = at(px, pz, out);
  if (out.size <= 0) {
    out.dhdx = 0;
    out.dhdz = 0;
    return out;
  }
  const e = SURF_EPS;
  out.dhdx = (at(px + e, pz, tmp) - at(px - e, pz, tmp)) / (2 * e);
  out.dhdz = (at(px, pz + e, tmp) - at(px, pz - e, tmp)) / (2 * e);
  return out;
}

/** Step (m) for the slopes, on both sides. */
const SURF_EPS = 0.4;

export function createSurfSample(): SurfSample {
  return { height: 0, dhdx: 0, dhdz: 0, push: 0, broken: 0, d: 0, size: 0, x: 0, l: 0 };
}

const f = (v: number): string => v.toFixed(4);

/**
 * GLSL of the same wave: `vec4 surfWave(vec2 p, float t, float depth, float strength)` → (height, foam
 * coverage, lit face, broken). Constants are baked in from SURF.
 */
export const surfGlsl = /* glsl */ `
uniform vec4 uSurfFrame; // origin.xz, direction to the beach

// strength: the sea slider (uWaveStrength).
vec4 surfWave(vec2 p, float t, float depth, float strength) {
  vec2 r = p - uSurfFrame.xy;
  vec2 u = uSurfFrame.zw;
  float x = dot(r, u);
  float l = dot(r, vec2(-u.y, u.x));
  if (x < ${f(SURF.start)} || x > 2.0 || abs(l) > ${f(SURF.halfWidth + 6)}) return vec4(0.0);
  float psi = (x - ${f(SURF.speed)} * t) / ${f(SURF.length)};
  float d = fract(psi) - 0.5;
  float shape = d > 0.0 ? exp(-pow(d / ${f(SURF.face)}, 2.0)) : exp(-pow(d / ${f(SURF.back)}, 2.0));
  float xc = x - d * ${f(SURF.length)};
  float tau = (xc - ${f(SURF.breakAt)}) / ${f(SURF.speed)};
  float peel = ${f(SURF.peelStart)} + ${f(SURF.peelSpeed)} * tau;
  // (GLSL leaves smoothstep with edge0 > edge1 undefined: always flip with 1 − smoothstep.)
  float broken = tau > 0.0 ? 1.0 - smoothstep(peel - 4.0, peel + 4.0, l) : 0.0;
  broken = max(broken, smoothstep(${f(SURF.closeOut - 6)}, ${f(SURF.closeOut)}, xc));
  float size = smoothstep(${f(SURF.start)}, ${f(SURF.breakAt)}, x)
    * (1.0 - smoothstep(-14.0, -2.0, x))
    * (1.0 - smoothstep(${f(SURF.halfWidth - 15)}, ${f(SURF.halfWidth + 5)}, abs(l)))
    * smoothstep(-0.1, 0.8, depth);
  float h = (${f(AMP.base)} + ${f(AMP.perStrength)} * strength) * size * (shape * (1.0 - 0.45 * broken) - ${f(MEAN)});
  // White water: tumbling down the face of the broken part, and the soup trailing behind it
  // (thinning out a few meters back). A thin feather of spray along the lip just ahead of the peel.
  float lip = smoothstep(-0.05, 0.0, d) * (1.0 - smoothstep(0.07, 0.16, d));
  float soup = smoothstep(-0.42, -0.1, d) * (1.0 - smoothstep(-0.02, 0.01, d));
  float feather = (1.0 - broken) * (1.0 - smoothstep(0.0, 12.0, abs(l - peel))) * step(0.0, tau) * smoothstep(-0.03, 0.0, d) * (1.0 - smoothstep(0.0, 0.04, d));
  float foam = (broken * (lip + 0.75 * soup) + 0.6 * feather) * size;
  // The unbroken face: steep and thin enough for the light to come through (turquoise).
  float face = (1.0 - broken) * smoothstep(0.0, 0.03, d) * (1.0 - smoothstep(0.08, 0.2, d)) * size;
  return vec4(h, foam, face, broken * size);
}
`;
