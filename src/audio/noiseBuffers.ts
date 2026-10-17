import type { Rng } from '../core/rng';
import { createRng } from '../core/rng';

/**
 * Noise "colors" are the raw material of the synthesized ambience:
 * white = flat hiss, pink = softer (−3 dB/octave, like rain or leaves),
 * brown = deep rumble (−6 dB/octave, like surf or distant wind).
 * All generators are pure functions of an RNG, so they are unit-testable.
 */

export function generateWhite(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Paul Kellet's economical pink-noise filter. */
export function generatePink(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return makeSeamless(out);
}

/** Leaky-integrated white noise. */
export function generateBrown(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
    out[i] = last * 3.5;
  }
  return makeSeamless(out);
}

/**
 * Filtered noise drifts, so the last sample of a buffer differs from the first and looping
 * would click. Removing a linear ramp makes both ends meet; the change is inaudible.
 */
export function makeSeamless(data: Float32Array): Float32Array {
  const n = data.length;
  if (n < 2) return data;
  const step = data[n - 1] - data[0];
  for (let i = 0; i < n; i++) data[i] -= (step * i) / (n - 1);
  return data;
}

/**
 * Pre-rendered raindrop patter: many tiny decaying "plinks" at random times, pitches and
 * stereo positions. Looping two such buffers of different lengths avoids audible repetition
 * without scheduling thousands of nodes.
 */
export function generateDroplets(
  sampleRate: number,
  seconds: number,
  dropsPerSecond: number,
  rng: Rng,
): [Float32Array, Float32Array] {
  const n = Math.floor(sampleRate * seconds);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const count = Math.floor(seconds * dropsPerSecond);
  for (let d = 0; d < count; d++) {
    const start = Math.floor(rng() * n);
    const freq = 1400 + rng() * 4200;
    const decay = 0.003 + rng() * 0.012;
    const amp = 0.04 + rng() * rng() * 0.3;
    const pan = rng();
    const len = Math.min(Math.floor(decay * 6 * sampleRate), n);
    for (let k = 0; k < len; k++) {
      const t = k / sampleRate;
      const s = amp * Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / decay);
      // Wrap around the end so the loop seam has drops too.
      const idx = (start + k) % n;
      left[idx] += s * (1 - pan);
      right[idx] += s * pan;
    }
  }
  normalize(left, right, 0.9);
  return [left, right];
}

function normalize(a: Float32Array, b: Float32Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]), Math.abs(b[i]));
  if (max === 0) return;
  const k = peak / max;
  for (let i = 0; i < a.length; i++) {
    a[i] *= k;
    b[i] *= k;
  }
}

/** Stereo noise buffers shared by all layers (each layer starts them at a random offset). */
export interface NoiseBank {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  dropletsA: AudioBuffer;
  dropletsB: AudioBuffer;
}

const NOISE_SECONDS = 8;

export function createNoiseBank(ctx: BaseAudioContext, seed = 7): NoiseBank {
  const rng = createRng(seed);
  const n = ctx.sampleRate * NOISE_SECONDS;
  const stereo = (gen: (n: number, rng: Rng) => Float32Array): AudioBuffer => {
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    // Independent channels give a wide, natural stereo image.
    buf.copyToChannel(gen(n, rng) as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(gen(n, rng) as Float32Array<ArrayBuffer>, 1);
    return buf;
  };
  const drops = (seconds: number, rate: number): AudioBuffer => {
    const [l, r] = generateDroplets(ctx.sampleRate, seconds, rate, rng);
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
    return buf;
  };
  return {
    white: stereo(generateWhite),
    pink: stereo(generatePink),
    brown: stereo(generateBrown),
    dropletsA: drops(5.0, 70),
    dropletsB: drops(7.3, 45),
  };
}
