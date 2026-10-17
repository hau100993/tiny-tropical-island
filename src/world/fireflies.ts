import * as THREE from 'three';
import type { Heightmap } from './heightmap';
import { createRng } from '../core/rng';
import type { SharedUniforms } from '../core/uniforms';

const COUNT = 420;

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPixelRatio;
varying float vGlow;

void main() {
  // Each firefly wanders around its home point on slow, looping paths.
  float t = uTime * (0.25 + aSeed.w * 0.2);
  vec3 p = position + vec3(
    sin(t + aSeed.x * 40.0) * 1.6 + sin(t * 2.3 + aSeed.y * 13.0) * 0.4,
    sin(t * 1.3 + aSeed.z * 21.0) * 0.5,
    cos(t * 0.9 + aSeed.y * 31.0) * 1.6 + cos(t * 1.9 + aSeed.x * 17.0) * 0.4);
  // Blink: short bright pulses with long dark gaps, each on its own rhythm.
  float phase = uTime * (0.5 + aSeed.x * 0.6) + aSeed.z * 50.0;
  vGlow = pow(max(0.0, sin(phase)), 10.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.35 + 0.65 * vGlow) * 9.0 * uPixelRatio * (12.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uVisible;
varying float vGlow;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * (0.15 + 0.85 * vGlow) * uVisible;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.85, 1.0, 0.35) * (1.0 + 2.0 * vGlow) * a, 1.0);
}
`;

/**
 * Fireflies: glowing points along the forest edge and around the garden, visible at night.
 * Additive blending, entirely animated in the shader.
 */
export class Fireflies {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly visible = { value: 0 };

  constructor(hm: Heightmap, seed: number, shared: SharedUniforms) {
    const rng = createRng(seed);
    const pos = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT * 4);
    let n = 0;
    for (let attempt = 0; attempt < COUNT * 50 && n < COUNT; attempt++) {
      const x = (rng() * 2 - 1) * hm.config.radius;
      const z = (rng() * 2 - 1) * hm.config.radius;
      const inland = hm.inlandAt(x, z);
      // Forest edge and garden: not on the beach, not deep in the dark rainforest.
      if (hm.heightAt(x, z) < 0.6 || inland < 0.1 || inland > 0.65) continue;
      pos.set([x, hm.heightAt(x, z) + 0.4 + rng() * 2.2, z], n * 3);
      seeds.set([rng(), rng(), rng(), rng()], n * 4);
      n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds.subarray(0, n * 4), 4));
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uPixelRatio: { value: 1 }, uVisible: this.visible },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, material);
    this.points.name = 'fireflies';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.visible = false;
  }

  setPixelRatio(ratio: number): void {
    this.points.material.uniforms.uPixelRatio.value = ratio;
  }

  /** @param amount 0..1 (night × option × no rain). */
  update(amount: number): void {
    this.visible.value = amount;
    this.points.visible = amount > 0.01;
  }
}
