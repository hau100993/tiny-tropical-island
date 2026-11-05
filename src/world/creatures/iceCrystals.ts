import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { createWaveUniforms, NUM_WAVES } from '../../water/gerstner';

/** Deterministic 0..1 from an integer (a fixed jitter for the crystal's outline). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * One ice crystal, height 1: a five-sided prism from below the waterline (y −0.25) tapering
 * a little to y 0.6, then a point at the top (a touch off-centre). Uneven sides so it isn't a
 * perfect pentagon; flat faces (no shared vertices: the facets catch the light one by one).
 * `aH`: height 0 (foot) … 1 (tip) for the colour.
 */
export function spikeGeometry(): THREE.BufferGeometry {
  const sides = 5;
  const ring = (y: number, r: number): THREE.Vector3[] =>
    Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2 + (hash(k) - 0.5) * 0.5;
      const rr = r * (0.8 + 0.4 * hash(k + 10));
      return new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr);
    });
  const foot = ring(-0.25, 1);
  const waist = ring(0.6, 0.78);
  const tip = new THREE.Vector3(0.07, 1, 0.03);
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let k = 0; k < sides; k++) {
    const j = (k + 1) % sides;
    tri(foot[k], waist[k], foot[j]);
    tri(foot[j], waist[k], waist[j]);
    tri(waist[k], tip, waist[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const h = new Float32Array(pos.length / 3);
  for (let i = 0; i < h.length; i++) h[i] = (pos[i * 3 + 1] + 0.25) / 1.25;
  g.setAttribute('aH', new THREE.BufferAttribute(h, 1));
  return g;
}

/** A broken-off plate of ice, radius ~1, 0.15 thick: an uneven hexagon with flat sides. */
export function shardGeometry(): THREE.BufferGeometry {
  const sides = 6;
  const pts = Array.from({ length: sides }, (_, k) => {
    const a = (k / sides) * Math.PI * 2 + (hash(k + 30) - 0.5) * 0.7;
    const r = 0.6 + 0.4 * hash(k + 40);
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
  const top = 0.06;
  const bot = -0.09;
  const pos: number[] = [];
  const h: number[] = [];
  const v = (x: number, y: number, z: number, hh: number): void => {
    pos.push(x, y, z);
    h.push(hh);
  };
  for (let k = 0; k < sides; k++) {
    const [ax, az] = pts[k];
    const [bx, bz] = pts[(k + 1) % sides];
    // Top (a fan from the middle) and the side.
    v(0, top, 0, 0.9);
    v(bx, top, bz, 0.8);
    v(ax, top, az, 0.8);
    v(ax, top, az, 0.6);
    v(bx, top, bz, 0.6);
    v(ax, bot, az, 0.3);
    v(bx, top, bz, 0.6);
    v(bx, bot, bz, 0.3);
    v(ax, bot, az, 0.3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
  return g;
}

// ---- Shaders ----

const SPIKE_VERT = /* glsl */ `
attribute float aH;
attribute float aBirth;
attribute float aEnd;
attribute float aSeed;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vH;
varying float vSeed;
varying float vFresh;
// Overshoots and settles: the crystal shoots up past its size, then back.
float easeOutBack(float x) {
  const float c1 = 2.2;
  const float c3 = c1 + 1.0;
  return 1.0 + c3 * pow(x - 1.0, 3.0) + c1 * pow(x - 1.0, 2.0);
}
void main() {
  float age = uTime - aBirth;
  float grow = age <= 0.0 ? 0.0 : easeOutBack(clamp(age / 0.4, 0.0, 1.0));
  // Crumbling: it shrinks and drops into the sea in half a second.
  float crumble = clamp((uTime - aEnd) / 0.5, 0.0, 1.0);
  vec3 p = position;
  p.y *= grow * (1.0 - crumble);
  p.xz *= mix(0.45, 1.0, clamp(grow, 0.0, 1.0)) * (1.0 - 0.7 * crumble);
  p.y -= crumble * 0.4;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vH = aH;
  vSeed = aSeed;
  vFresh = exp(-max(age, 0.0) * 2.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SHARD_VERT = /* glsl */ `
attribute float aH;
attribute vec4 aStart; // x, z, size, spin (rad/s)
attribute vec2 aDrift;
attribute float aBirth;
attribute float aEnd;
attribute float aSeed;
uniform float uTime;
uniform float uWaveStrength;
uniform vec4 uWaveA[NUM_WAVES];
uniform vec4 uWaveB[NUM_WAVES];
varying vec3 vWorld;
varying vec3 vLocal;
varying float vH;
varying float vSeed;
varying float vFresh;
void main() {
  float age = max(uTime - aBirth, 0.0);
  // Drifting away from the road, slowing down.
  vec2 c = aStart.xy + aDrift * 6.0 * (1.0 - exp(-age / 6.0));
  // Riding the open sea's Gerstner waves (the vertical part, as in water.vert).
  float h = 0.0;
  vec2 slope = vec2(0.0);
  for (int i = 0; i < NUM_WAVES; i++) {
    vec2 D = uWaveA[i].xy;
    float k = uWaveA[i].z;
    float A = uWaveA[i].w * uWaveStrength;
    float f = k * dot(D, c) - uWaveB[i].x * uTime + uWaveB[i].z;
    h += A * sin(f);
    slope += D * (A * k * cos(f));
  }
  float grow = smoothstep(0.0, 0.3, uTime - aBirth);
  // Melting: shrinking and sinking.
  float melt = clamp((uTime - aEnd) / 1.5, 0.0, 1.0);
  vec3 p = position * aStart.z * grow * (1.0 - 0.6 * melt);
  float a = aSeed * 6.2832 + aStart.w * age;
  p.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xz;
  // Tilted with the wave under it (a shear along its slope).
  p.y += dot(p.xz, slope);
  vec3 world = vec3(c.x, h + 0.03 - melt * 0.5, c.y) + p;
  vWorld = world;
  vLocal = position * 2.0;
  vH = aH;
  vSeed = aSeed;
  vFresh = 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/**
 * Faceted ice (shared with the ice rings): needs the varyings vWorld, vLocal, vH (0 foot … 1
 * tip), vSeed and vFresh (an inner glow: forming, or a ring that is next).
 */
export const CRYSTAL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uDayLight;
uniform float uNight;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
varying vec3 vWorld;
varying vec3 vLocal;
varying float vH;
varying float vSeed;
varying float vFresh;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // Flat facets: the normal from the screen-space slope of the surface.
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(cameraPosition - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  // Deep blue at the foot through bright cyan to a white tip; a few lean teal or violet.
  vec3 deep = mix(vec3(0.04, 0.26, 0.5), vec3(0.18, 0.16, 0.55), step(0.85, vSeed));
  vec3 mid = mix(vec3(0.3, 0.74, 0.96), vec3(0.3, 0.9, 0.85), step(vSeed, 0.2));
  vec3 base = mix(deep, mid, smoothstep(0.0, 0.5, vH));
  base = mix(base, vec3(0.93, 0.99, 1.0), smoothstep(0.6, 1.0, vH));
  // Cracks inside the crystal: thin bright sheets seen through it (fake depth).
  float cr = noise(vLocal.xy * 3.0 + vSeed * 17.0) + 0.5 * noise(vLocal.zy * 5.0 - vSeed * 9.0);
  float crack = 1.0 - smoothstep(0.0, 0.05, abs(cr - 0.75));
  base = mix(base, vec3(0.9, 0.98, 1.0), crack * 0.5);
  vec3 sky = mix(uSkyHorizon, uSkyTop, 0.5);
  float ndl = max(dot(n, uLightDir), 0.0);
  vec3 col = base * (sky * 0.5 + vec3(0.25) + uLightColor * 0.7 * ndl) * (0.3 + 0.7 * uDayLight);
  // Bright rim (light bending through the edges) and the light's glare on a facet.
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += (sky * 0.6 + vec3(0.35, 0.5, 0.6)) * fres * (0.4 + 0.6 * uDayLight);
  col += uLightColor * pow(max(dot(reflect(-uLightDir, n), v), 0.0), 40.0) * 1.4;
  // A facet now and then flashes as it catches the light.
  float g = hash(floor(n.xz * 6.0) + vSeed * 31.0);
  col += vec3(1.0) * step(0.8, g) * pow(max(sin(uTime * (2.0 + 3.0 * g) + g * 50.0), 0.0), 24.0) * 0.8;
  // Inner glow at night, strongest toward the tip; a flash as it forms.
  col += mix(vec3(0.15, 0.55, 1.0), vec3(0.6, 0.95, 1.0), vH) * (uNight * (0.25 + 0.95 * vH + 0.6 * fres + 0.5 * crack) + 1.2 * vFresh);
  gl_FragColor = vec4(col, 1.0);
}
`;

const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();

export function crystalUniforms(shared: SharedUniforms): Record<string, THREE.IUniform> {
  return {
    uTime: shared.uTime,
    uLightDir: shared.uLightDir,
    uLightColor: shared.uLightColor,
    uDayLight: shared.uDayLight,
    uNight: shared.uNight,
    uSkyTop: shared.uSkyTop,
    uSkyHorizon: shared.uSkyHorizon,
  };
}

/** One spike as placed: where its tip ends up and when it crumbles (for the CPU's bits). */
export interface SpikeSpec {
  x: number;
  y: number;
  z: number;
  /** Height (m), thickness (m). */
  height: number;
  thick: number;
  /** Tilt from upright (rad) toward the heading `toward` (rad, atan2(x, z) style). */
  tilt: number;
  toward: number;
  spin: number;
  birth: number;
  end: number;
}

/**
 * The ice's crystals: spikes standing in clusters (one InstancedMesh, the placement in each
 * instance's matrix, growth and crumbling in the vertex shader) and plates of broken ice
 * drifting on the waves (another, moved entirely in its vertex shader). Both are ring buffers:
 * the oldest are reused. Opaque (cheap): the light through them is faked in the shader.
 */
export class IceCrystals {
  readonly spikes: THREE.InstancedMesh;
  readonly shards: THREE.InstancedMesh;
  /** Where each spike's tip is and when it crumbles (CPU copy, for the crumbs). */
  readonly tipX: Float32Array;
  readonly tipY: Float32Array;
  readonly tipZ: Float32Array;
  readonly endAt: Float32Array;
  readonly crumbled: Uint8Array;
  readonly maxSpikes: number;
  readonly maxShards: number;
  /** How many of the pool the quality preset lets through (≤ the pools). */
  spikeLimit: number;
  shardLimit: number;
  private nextSpike = 0;
  private nextShard = 0;
  private readonly sBirth: THREE.InstancedBufferAttribute;
  private readonly sEnd: THREE.InstancedBufferAttribute;
  private readonly sSeed: THREE.InstancedBufferAttribute;
  private readonly hStart: THREE.InstancedBufferAttribute;
  private readonly hDrift: THREE.InstancedBufferAttribute;
  private readonly hBirth: THREE.InstancedBufferAttribute;
  private readonly hEnd: THREE.InstancedBufferAttribute;
  private readonly hSeed: THREE.InstancedBufferAttribute;

  constructor(shared: SharedUniforms, maxSpikes: number, maxShards: number) {
    this.maxSpikes = this.spikeLimit = maxSpikes;
    this.maxShards = this.shardLimit = maxShards;
    this.tipX = new Float32Array(maxSpikes);
    this.tipY = new Float32Array(maxSpikes);
    this.tipZ = new Float32Array(maxSpikes);
    this.endAt = new Float32Array(maxSpikes).fill(Infinity);
    this.crumbled = new Uint8Array(maxSpikes).fill(1);

    const sg = spikeGeometry();
    const never = (n: number, fill: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(n).fill(fill), 1).setUsage(THREE.DynamicDrawUsage);
    this.sBirth = never(maxSpikes, 1e9);
    this.sEnd = never(maxSpikes, 1e9);
    this.sSeed = never(maxSpikes, 0);
    sg.setAttribute('aBirth', this.sBirth);
    sg.setAttribute('aEnd', this.sEnd);
    sg.setAttribute('aSeed', this.sSeed);
    const spikeMat = new THREE.ShaderMaterial({
      uniforms: crystalUniforms(shared),
      vertexShader: SPIKE_VERT,
      fragmentShader: CRYSTAL_FRAG,
    });
    this.spikes = new THREE.InstancedMesh(sg, spikeMat, maxSpikes);
    this.spikes.name = 'ice-spikes';
    this.spikes.frustumCulled = false;
    this.spikes.visible = false;
    // Not yet placed: all collapsed (birth far in the future), matrices at the origin.
    this.spikes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const hg = shardGeometry();
    this.hStart = new THREE.InstancedBufferAttribute(new Float32Array(maxShards * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.hDrift = new THREE.InstancedBufferAttribute(new Float32Array(maxShards * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.hBirth = never(maxShards, 1e9);
    this.hEnd = never(maxShards, 1e9);
    this.hSeed = never(maxShards, 0);
    hg.setAttribute('aStart', this.hStart);
    hg.setAttribute('aDrift', this.hDrift);
    hg.setAttribute('aBirth', this.hBirth);
    hg.setAttribute('aEnd', this.hEnd);
    hg.setAttribute('aSeed', this.hSeed);
    const waves = createWaveUniforms();
    const shardMat = new THREE.ShaderMaterial({
      uniforms: { ...crystalUniforms(shared), uWaveStrength: shared.uWaveStrength, uWaveA: waves.uWaveA, uWaveB: waves.uWaveB },
      vertexShader: SHARD_VERT,
      fragmentShader: CRYSTAL_FRAG,
      defines: { NUM_WAVES },
    });
    this.shards = new THREE.InstancedMesh(hg, shardMat, maxShards);
    this.shards.name = 'ice-shards';
    this.shards.frustumCulled = false;
    this.shards.visible = false;
  }

  /** Quality: how many of each the presets draw (the newest ones). */
  setLimits(spikes: number, shards: number): void {
    this.spikeLimit = Math.min(this.maxSpikes, spikes);
    this.shardLimit = Math.min(this.maxShards, shards);
    this.spikes.count = this.spikeLimit;
    this.shards.count = this.shardLimit;
    this.nextSpike %= this.spikeLimit;
    this.nextShard %= this.shardLimit;
  }

  /** Stands a spike (see SpikeSpec); it grows from `birth` and crumbles at `end`. */
  addSpike(s: Readonly<SpikeSpec>, seed: number): void {
    const i = this.nextSpike;
    this.nextSpike = (i + 1) % this.spikeLimit;
    tmpQ.setFromEuler(tmpE.set(s.tilt, s.toward, 0, 'YXZ'));
    // Its own spin round its axis first, so the uneven faces point every which way.
    tmpM.makeRotationY(s.spin);
    tmpS.set(s.thick, s.height, s.thick);
    const m = tmpM2.compose(tmpP.set(s.x, s.y, s.z), tmpQ, tmpS).multiply(tmpM);
    this.spikes.setMatrixAt(i, m);
    this.spikes.instanceMatrix.needsUpdate = true;
    tmpP.set(0, 1, 0).applyMatrix4(m);
    this.tipX[i] = tmpP.x;
    this.tipY[i] = tmpP.y;
    this.tipZ[i] = tmpP.z;
    this.endAt[i] = s.end;
    this.crumbled[i] = 0;
    (this.sBirth.array as Float32Array)[i] = s.birth;
    (this.sEnd.array as Float32Array)[i] = s.end;
    (this.sSeed.array as Float32Array)[i] = seed;
    this.sBirth.needsUpdate = true;
    this.sEnd.needsUpdate = true;
    this.sSeed.needsUpdate = true;
    this.spikes.visible = true;
  }

  /** A plate of ice at (x, z), `size` m across, drifting at (dx, dz) m/s, from `birth` to `end`. */
  addShard(x: number, z: number, size: number, dx: number, dz: number, birth: number, end: number): void {
    const i = this.nextShard;
    this.nextShard = (i + 1) % this.shardLimit;
    const st = this.hStart.array as Float32Array;
    st[i * 4] = x;
    st[i * 4 + 1] = z;
    st[i * 4 + 2] = size;
    st[i * 4 + 3] = (Math.random() - 0.5) * 0.3;
    const d = this.hDrift.array as Float32Array;
    d[i * 2] = dx;
    d[i * 2 + 1] = dz;
    (this.hBirth.array as Float32Array)[i] = birth;
    (this.hEnd.array as Float32Array)[i] = end;
    (this.hSeed.array as Float32Array)[i] = Math.random();
    this.hStart.needsUpdate = true;
    this.hDrift.needsUpdate = true;
    this.hBirth.needsUpdate = true;
    this.hEnd.needsUpdate = true;
    this.hSeed.needsUpdate = true;
    this.shards.visible = true;
  }

  /** Forgets everything (all collapsed again). */
  clear(): void {
    (this.sBirth.array as Float32Array).fill(1e9);
    (this.hBirth.array as Float32Array).fill(1e9);
    this.sBirth.needsUpdate = true;
    this.hBirth.needsUpdate = true;
    this.endAt.fill(Infinity);
    this.crumbled.fill(1);
    this.spikes.visible = false;
    this.shards.visible = false;
  }

  dispose(): void {
    this.spikes.geometry.dispose();
    this.shards.geometry.dispose();
    (this.spikes.material as THREE.Material).dispose();
    (this.shards.material as THREE.Material).dispose();
  }
}
