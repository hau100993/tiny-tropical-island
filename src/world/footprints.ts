import * as THREE from 'three';
import type { Heightmap } from './heightmap';
import type { SharedUniforms } from '../core/uniforms';

/** Footprints kept at once (a ring buffer: the oldest one is reused). */
const MAX = 256;
/** Seconds a print lasts on dry sand, in the wet band near the water, and in snow. */
const LIFE_DRY = 150;
const LIFE_WET = 25;
const LIFE_SNOW = 240;
/** Below this ground height the swash reaches: prints there are washed away quickly. */
const WET_BAND = 0.55;
/** A bare foot: length and width of the quad (m). */
const FOOT_L = 0.29;
const FOOT_W = 0.13;

const VERT = /* glsl */ `
attribute vec4 iPos;    // x, y, z, yaw
attribute vec4 iInfo;   // side (−1 left, 1 right), birth time, life (s), snow (0/1)
attribute vec2 iSlope;  // dy/dx, dy/dz of the ground
uniform float uClock;
uniform float uRain;
varying vec2 vFoot;     // across (−1..1, mirrored for the left foot), along (0 heel … 1 toes)
varying float vFade;
varying float vSnow;
#include <fog_pars_vertex>
void main() {
  float yaw = iPos.w;
  vec2 fwd = vec2(-sin(yaw), -cos(yaw));
  vec2 right = vec2(cos(yaw), -sin(yaw));
  vec2 xz = iPos.xz + right * position.x * ${FOOT_W.toFixed(3)} + fwd * position.y * ${FOOT_L.toFixed(3)};
  vec2 d = xz - iPos.xz;
  // On the ground's slope, a hair above it (polygon offset does the rest).
  float y = iPos.y + d.x * iSlope.x + d.y * iSlope.y + 0.01;
  vFoot = vec2(position.x * 2.0 * iInfo.x, position.y + 0.5);
  // Rain wears prints down three times faster; they fade over their last 40 %.
  float age = (uClock - iInfo.y) * (1.0 + 2.0 * uRain * (1.0 - iInfo.w));
  vFade = (1.0 - smoothstep(0.6, 1.0, age / iInfo.z)) * step(0.0, age) * step(0.001, iInfo.z);
  vSnow = iInfo.w;
  vec4 mvPosition = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
  // The terrain mesh is made of 1.5 m triangles while heightAt() interpolates smoothly: they can
  // differ by a few cm. Pull the decal 6 cm toward the eye along its own view ray: same place on
  // screen, but in front of the ground in the depth test.
  mvPosition.xyz -= normalize(mvPosition.xyz) * 0.06;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uDayLight;
varying vec2 vFoot;
varying float vFade;
varying float vSnow;
#include <fog_pars_fragment>
// Ellipse "inside" measure: < 1 inside.
float ell(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return dot(q, q); }
void main() {
  if (vFade <= 0.0) discard;
  vec2 p = vec2(vFoot.x, vFoot.y);
  // Pressure of a bare foot: heel, the outer edge of the arch joining it to the ball, the ball,
  // five toes just ahead of it. Soft edges, so the parts flow into one print.
  float heel = 1.0 - smoothstep(0.3, 1.0, ell(p, vec2(0.02, 0.17), vec2(0.62, 0.18)));
  float arch = 1.0 - smoothstep(0.3, 1.0, ell(p, vec2(0.36, 0.42), vec2(0.44, 0.27)));
  float ball = 1.0 - smoothstep(0.3, 1.0, ell(p, vec2(-0.04, 0.64), vec2(0.82, 0.15)));
  float toes = 0.0;
  for (int i = 0; i < 5; i++) {
    float t = float(i) / 4.0;
    vec2 c = vec2(mix(-0.5, 0.62, t), mix(0.835, 0.76, t * t));
    float r = mix(0.26, 0.14, t);
    // Round toes: the same radius in metres across (×0.065 m) and along (×0.29 m).
    toes = max(toes, 1.0 - smoothstep(0.35, 1.0, ell(p, c, vec2(r, r * 0.224))));
  }
  float press = max(max(heel, arch * 0.8), max(ball, toes * 0.85));
  // Sand pushed up round the print catches a little light; the hollow is in shade.
  float rim = smoothstep(0.0, 0.35, max(max(heel, arch), max(ball, toes))) * (1.0 - press);
  float a = (press * mix(0.55, 0.6, vSnow) + rim * 0.08) * vFade;
  if (a < 0.003) discard;
  // Darker hollow in sand; blue-grey shade in snow. Rim slightly lighter.
  vec3 hollow = mix(vec3(0.3, 0.22, 0.13), vec3(0.42, 0.52, 0.68), vSnow) * (0.25 + 0.75 * uDayLight);
  vec3 lit = vec3(1.0, 0.97, 0.9) * 0.8 * uDayLight;
  vec3 col = mix(hollow, lit, rim / (press + rim + 1e-3));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * Bare footprints left on sand (and on anything under fresh snow): one instanced draw call of
 * small decals on the ground, each fading away by itself on the GPU. They wear off faster in
 * rain and in the wet band the waves reach.
 */
export class Footprints {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly iPos: THREE.InstancedBufferAttribute;
  private readonly iInfo: THREE.InstancedBufferAttribute;
  private readonly iSlope: THREE.InstancedBufferAttribute;
  private next = 0;
  private count = 0;
  private readonly clock: { value: number };

  constructor(
    private readonly hm: Heightmap,
    shared: SharedUniforms,
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSlope = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iInfo', this.iInfo);
    geo.setAttribute('iSlope', this.iSlope);
    geo.instanceCount = 0;
    this.clock = { value: 0 };
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uClock: this.clock,
        uRain: shared.uRain,
        uDayLight: shared.uDayLight,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.name = 'footprints';
    this.mesh.frustumCulled = false;
  }

  /** Seconds on the same clock as the prints' birth times (the render clock). */
  setClock(seconds: number): void {
    this.clock.value = seconds;
  }

  /** The render clock started again from 0: old birth times no longer mean anything. */
  clear(): void {
    this.count = 0;
    this.next = 0;
    this.mesh.geometry.instanceCount = 0;
  }

  /**
   * A footfall at the body's position (x, z) facing `yaw` (walker convention: forward is
   * (−sin, −cos)). `side` −1 left, 1 right; the foot lands ~9 cm to that side.
   */
  add(x: number, z: number, yaw: number, side: number, snow: boolean): void {
    const fx = x + Math.cos(yaw) * 0.09 * side;
    const fz = z - Math.sin(yaw) * 0.09 * side;
    const h = this.hm.heightAt(fx, fz);
    const life = snow ? LIFE_SNOW : h < WET_BAND ? LIFE_WET : LIFE_DRY;
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.count = Math.min(MAX, this.count + 1);
    this.iPos.setXYZW(i, fx, h, fz, yaw + (Math.random() - 0.5) * 0.12);
    this.iInfo.setXYZW(i, side, this.clock.value, life, snow ? 1 : 0);
    const e = 0.25;
    this.iSlope.setXY(
      i,
      (this.hm.heightAt(fx + e, fz) - this.hm.heightAt(fx - e, fz)) / (2 * e),
      (this.hm.heightAt(fx, fz + e) - this.hm.heightAt(fx, fz - e)) / (2 * e),
    );
    this.iPos.needsUpdate = true;
    this.iInfo.needsUpdate = true;
    this.iSlope.needsUpdate = true;
    this.mesh.geometry.instanceCount = this.count;
  }
}
