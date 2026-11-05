import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';

/** Meteors drawn at once (instances of one quad: one draw call). */
const MAX = 80;
/** Seconds the glowing train lingers after the head has passed (a bright meteor's persistent train). */
export const METEOR_TRAIN = 1.6;
/** Sizes in pixels at a 1000 px tall view (scaled with the view): head core, halo, quad margin. */
const CORE_PX = 2.6;
const HALO_PX = 7;
const PAD_PX = 34;

// Drawn in screen space. A shower's meteors come from the radiant, far ahead, toward you, so in
// 3D their paths are strongly foreshortened: a quad laid along the path squashes the head into a
// flat-ended blob. Instead the vertex shader projects the visible part of the path (from where
// the train has faded to the head) to pixels and lays a quad around that 2D segment, PAD_PX
// beyond it on every side. The fragment shader measures in pixels: the distance to the head
// (round core and halo) and to the segment (rounded at both ends, like a capsule), and recovers
// how long ago the head passed by undoing the perspective (1/w interpolation) along it.
const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aTime;
attribute float aSeed;
uniform float uTime;
uniform float uTrain;
uniform float uViewH;
varying vec2 vPix;
varying vec2 vS0;
varying vec2 vS1;
varying vec2 vW;
varying vec2 vA;
varying float vK;
varying float vDur;
varying float vSeed;
varying float vScale;
void hide() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
void main() {
  float k = (uTime - aTime.x) / aTime.y;
  if (k < 0.0 || k > 1.0 + uTrain / aTime.y) { hide(); return; }
  // The visible stretch: from where the train has faded (a0) to the head (a1).
  float a1 = min(k, 1.0);
  float a0 = clamp(k - uTrain / aTime.y, 0.0, a1);
  vec3 dir = aEnd - aStart;
  vec4 c0 = projectionMatrix * viewMatrix * vec4(aStart + dir * a0, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(aStart + dir * a1, 1.0);
  if (c0.w < 0.5 || c1.w < 0.5) { hide(); return; }
  // Pixels (from the view's centre): ndc × half the view's size.
  float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
  vec2 hv = 0.5 * uViewH * vec2(aspect, 1.0);
  vec2 s0 = c0.xy / c0.w * hv;
  vec2 s1 = c1.xy / c1.w * hv;
  vec2 d = s1 - s0;
  float l = length(d);
  vec2 u = l > 0.001 ? d / l : vec2(0.0, -1.0);
  vec2 n = vec2(-u.y, u.x);
  float scale = uViewH / 1000.0;
  float pad = ${PAD_PX.toFixed(1)} * scale;
  vec2 pix = mix(s0 - u * pad, s1 + u * pad, position.y) + n * position.x * 2.0 * pad;
  vPix = pix;
  vS0 = s0;
  vS1 = s1;
  vW = vec2(c0.w, c1.w);
  vA = vec2(a0, a1);
  vK = k;
  vDur = aTime.y;
  vSeed = aSeed;
  vScale = scale;
  // Depth of the head (so hills still hide it); w = 1: the quad is flat on the screen.
  gl_Position = vec4(pix / hv, clamp(c1.z / c1.w, -1.0, 1.0), 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTrain;
uniform float uDayLight;
varying vec2 vPix;
varying vec2 vS0;
varying vec2 vS1;
varying vec2 vW;
varying vec2 vA;
varying float vK;
varying float vDur;
varying float vSeed;
varying float vScale;
${FIRE_BLEND_GLSL}
// Train colours (what burns): blue-white, copper green, violet, sodium orange.
vec3 trainColor(float s) {
  if (s < 0.4) return vec3(0.65, 0.85, 1.0);
  if (s < 0.65) return vec3(0.45, 1.0, 0.6);
  if (s < 0.85) return vec3(0.8, 0.6, 1.0);
  return vec3(1.0, 0.72, 0.45);
}
void main() {
  // Closest point of the segment (screen fraction t), and the distance to it: a capsule.
  vec2 d = vS1 - vS0;
  float l2 = max(dot(d, d), 1e-4);
  float t = clamp(dot(vPix - vS0, d) / l2, 0.0, 1.0);
  float c = length(vPix - vS0 - d * t);
  // Screen fraction → path fraction (perspective: 1/w is what is linear on screen).
  float r = (t / vW.y) / ((1.0 - t) / vW.x + t / vW.y);
  float a = mix(vA.x, vA.y, r);
  float since = max((vK - a) * vDur, 0.0);
  float sc = vScale * (0.8 + 0.5 * fract(vSeed * 7.31));
  // The head: a round white-hot core in a soft halo; it flares up as it burns out, then is gone
  // in a blink. Both fade to nothing well inside the quad (no edge ever shows).
  float burnt = max(vK - 1.0, 0.0) * vDur;
  float life = exp(-burnt / 0.08);
  float flare = 1.0 + 0.9 * smoothstep(0.7, 1.0, vK) * life;
  float rc = ${CORE_PX.toFixed(1)} * sc * flare;
  float dh = length(vPix - vS1);
  float pad = ${PAD_PX.toFixed(1)} * vScale;
  float edge = 1.0 - smoothstep(0.55 * pad, 0.95 * pad, dh);
  float core = exp(-dh * dh / (rc * rc)) * life * 1.4;
  float halo = exp(-dh / (${HALO_PX.toFixed(1)} * sc * flare)) * 0.35 * life * edge;
  // The tail: as wide as the core at the head (so the two join into one teardrop), thinning
  // and fading within a fraction of a second.
  float w = mix(0.5 * sc, rc, exp(-since / 0.1));
  float tail = exp(-since / 0.16) * exp(-c * c / (w * w)) * 0.9;
  // The train: a faint hairline glowing on, slowly spreading as it fades.
  float spread = (0.8 + 7.0 * since) * sc;
  float train = exp(-since / (uTrain * 0.4)) * exp(-c * c / (spread * spread)) * 0.3
    * smoothstep(0.0, 0.05, since) * (1.0 - smoothstep(0.6 * pad, 0.95 * pad, c));
  vec3 tc = trainColor(vSeed);
  vec3 col = vec3(1.0) * core + mix(vec3(1.0), tc, 0.35) * halo
    + mix(vec3(1.0, 0.97, 0.9), tc, 0.5) * tail + tc * train;
  float sum = core + halo + tail + train;
  float alpha = 1.0 - exp(-sum * 1.4);
  if (alpha < 0.003) discard;
  // fireBlend scales the colour by alpha itself: hand it the colour per unit of alpha.
  gl_FragColor = fireBlend(col * 1.5 / max(sum, 0.001), alpha, uDayLight);
}
`;

/**
 * Mưa Sao Băng's shooting stars: each a white-hot head with a short bright tail and a faint,
 * coloured train that lingers and spreads after it (as bright meteors leave), flaring as it
 * burns out. All on the GPU: launching one writes its path and times into its instance slot;
 * the shader flies it and fades its train. Nothing per frame on the CPU.
 */
export class MeteorShower {
  readonly mesh: THREE.InstancedMesh;
  private readonly start: THREE.InstancedBufferAttribute;
  private readonly end: THREE.InstancedBufferAttribute;
  private readonly time: THREE.InstancedBufferAttribute;
  private readonly seed: THREE.InstancedBufferAttribute;
  private next = 0;
  private lastEnd = -1e9;

  constructor(shared: SharedUniforms) {
    // Two triangles are enough: the vertex shader lays them on the screen, the fragment shader
    // draws the head, tail and train.
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    // Plane: x −0.5 … 0.5, y −0.5 … 0.5 → y 0 … 1.
    geo.translate(0, 0.5, 0);
    this.start = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.end = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.time = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2).fill(-1e6), 2).setUsage(THREE.DynamicDrawUsage);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX; i++) (this.time.array as Float32Array)[i * 2 + 1] = 1;
    geo.setAttribute('aStart', this.start);
    geo.setAttribute('aEnd', this.end);
    geo.setAttribute('aTime', this.time);
    geo.setAttribute('aSeed', this.seed);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uTrain: { value: METEOR_TRAIN }, uViewH: { value: 1000 }, uDayLight: shared.uDayLight },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...FIRE_BLENDING,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.name = 'meteor-shower';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
  }

  /** Launches one from (sx, sy, sz) to (ex, ey, ez), from shader time `t0` for `dur` s. */
  launch(sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, t0: number, dur: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const s = this.start.array as Float32Array;
    const e = this.end.array as Float32Array;
    const t = this.time.array as Float32Array;
    s[i * 3] = sx;
    s[i * 3 + 1] = sy;
    s[i * 3 + 2] = sz;
    e[i * 3] = ex;
    e[i * 3 + 1] = ey;
    e[i * 3 + 2] = ez;
    t[i * 2] = t0;
    t[i * 2 + 1] = dur;
    (this.seed.array as Float32Array)[i] = Math.random();
    this.start.needsUpdate = true;
    this.end.needsUpdate = true;
    this.time.needsUpdate = true;
    this.seed.needsUpdate = true;
    this.lastEnd = Math.max(this.lastEnd, t0 + dur + METEOR_TRAIN);
    this.mesh.visible = true;
  }

  /** The drawing buffer's height (px): the head and tail are sized in pixels. */
  setViewport(heightPx: number): void {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uViewH.value = heightPx;
  }

  /** Hides the mesh once the last train has faded. */
  update(now: number): void {
    if (this.mesh.visible && now > this.lastEnd + 0.1) this.mesh.visible = false;
  }

  /** The shader clock was reset (see Loop.resetElapsed): forget the ones in flight. */
  reset(): void {
    (this.time.array as Float32Array).fill(-1e6);
    for (let i = 0; i < MAX; i++) (this.time.array as Float32Array)[i * 2 + 1] = 1;
    this.time.needsUpdate = true;
    this.lastEnd = -1e9;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
