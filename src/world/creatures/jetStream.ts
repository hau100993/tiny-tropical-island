import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';

/** Rings along the stream and vertices around each ring. */
const ALONG = 48;
const AROUND = 8;

const VERT = /* glsl */ `
attribute float aT;
attribute float aA;
uniform vec3 uOrigin;
uniform vec3 uVel;
uniform float uGravity;
uniform float uTail;
uniform float uHead;
uniform float uFlight;
uniform float uTime;
uniform float uR0;
uniform float uR1;
varying float vK;
varying float vA;
varying vec3 vN;
varying vec3 vView;
void main() {
  // Time of flight of this ring along the arc: p(t) = O + V·t − ½·g·t²·ŷ.
  float t = mix(uTail, uHead, aT);
  vec3 p = uOrigin + uVel * t + vec3(0.0, -0.5 * uGravity * t * t, 0.0);
  // A frame round the tangent (never vertical here: the jet always flies sideways).
  vec3 tang = normalize(uVel + vec3(0.0, -uGravity * t, 0.0));
  // (A flame aimed nearly straight down would make the cross product vanish: another axis then.)
  vec3 ref = abs(tang.y) > 0.97 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(tang, ref));
  vec3 up = cross(side, tang);
  float k = clamp(t / max(uFlight, 1e-3), 0.0, 1.0);
  // Thin at the mouth, fattening as it flies; pulses run down it (water does not flow evenly).
  float pulse = 1.0 + 0.22 * sin(t * 38.0 - uTime * 26.0 + aA * 2.0) + 0.12 * sin(t * 91.0 - uTime * 47.0);
  float rad = mix(uR0, uR1, k) * pulse;
  // The head end closes to a point.
  rad *= smoothstep(1.0, 0.82, aT) * 0.85 + 0.15;
  vec3 n = cos(aA) * side + sin(aA) * up;
  p += n * rad;
  vK = k;
  vA = aA;
  vN = n;
  vView = cameraPosition - p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
uniform vec3 uSunColor;
uniform float uOpacity;
varying float vK;
varying float vA;
varying vec3 vN;
varying vec3 vView;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // The stream frays into drops toward its end: pieces drop out, more and more, flickering.
  float cell = hash(vec2(floor(vK * 60.0 - uTime * 18.0), floor(vA * 1.3)));
  if (cell < smoothstep(0.55, 1.0, vK) * 0.85) discard;
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  float ndv = abs(dot(n, v));
  // Fresnel: clear through the middle, bright at the edges, like a glass rod of water.
  float fres = pow(1.0 - ndv, 2.0);
  // Streaks rushing along (light caught in ripples on its surface).
  float streak = smoothstep(0.6, 1.0, sin(vK * 70.0 - uTime * 32.0 + vA * 3.0) * 0.5 + 0.5);
  float light = 0.2 + 0.8 * uDayLight;
  vec3 deep = vec3(0.16, 0.5, 0.86);
  vec3 col = mix(deep, vec3(0.92, 0.98, 1.0), fres * 0.8 + streak * 0.35) * light * mix(vec3(1.0), uSunColor, 0.25);
  float a = (0.32 + 0.6 * fres + 0.25 * streak) * uOpacity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

const FIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
uniform float uOpacity;
${FIRE_BLEND_GLSL}
varying float vK;
varying float vA;
varying vec3 vN;
varying vec3 vView;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(vView);
  // 1 where the tube faces you (its core), 0 at its outline.
  float ndv = abs(dot(n, v));
  // Turbulence rushing out along the flame (two octaves, wrapping round the tube).
  float a = vA / 6.2832;
  float turb = noise(vec2(vK * 9.0 - uTime * 7.0, a * 6.0 + uTime * 0.7)) * 0.6
             + noise(vec2(vK * 23.0 - uTime * 13.0, a * 12.0)) * 0.4;
  // Heat: hottest at the mouth and in the core, cooling outward and toward the tip.
  float heat = ((1.0 - vK) * 0.8 + turb * 0.4) * mix(0.55, 1.0, ndv);
  // Ragged: the outline and the tip burn away in tongues.
  float alpha = smoothstep(0.18, 0.5, ndv * 0.55 + turb * 0.65 - vK * 0.4);
  if (alpha < 0.02) discard;
  vec3 col = mix(vec3(0.55, 0.04, 0.0), vec3(1.0, 0.42, 0.04), smoothstep(0.2, 0.55, heat));
  col = mix(col, vec3(1.0, 0.93, 0.62), smoothstep(0.62, 0.95, heat));
  gl_FragColor = fireBlend(col * 1.3, alpha * uOpacity, uDayLight);
}
`;

/** Water (a glassy stream) or fire (a flickering, additive tongue of flame). */
export type StreamLook = 'water' | 'fire';

/** Where the stream is, set each frame by the jet (all in world units and seconds of flight). */
export interface StreamState {
  ox: number;
  oy: number;
  oz: number;
  vx: number;
  vy: number;
  vz: number;
  /** Flight times of the stream's two ends along the arc (tail ≤ head), and of the whole arc. */
  tail: number;
  head: number;
  flight: number;
  /** 0 = nothing to draw. */
  opacity: number;
}

/**
 * The water jet drawn as one continuous tube bent along its ballistic arc in the vertex shader
 * (one draw call, the geometry never changes: only a dozen uniforms per frame). Its ends move
 * along the arc in time of flight, so the water visibly leaves the mouth, reaches the target and,
 * when the jet stops, detaches and falls.
 */
export class JetStream {
  readonly mesh: THREE.Mesh;
  private readonly u: {
    uOrigin: { value: THREE.Vector3 };
    uVel: { value: THREE.Vector3 };
    uGravity: { value: number };
    uTail: { value: number };
    uHead: { value: number };
    uFlight: { value: number };
    uR0: { value: number };
    uR1: { value: number };
    uOpacity: { value: number };
  };

  /**
   * `gravity` (m/s², down): 9.81 for water; negative for a flame, whose hot gas bends upward.
   */
  constructor(shared: SharedUniforms, gravity: number, look: StreamLook = 'water') {
    const geo = new THREE.BufferGeometry();
    const t = new Float32Array((ALONG + 1) * (AROUND + 1));
    const a = new Float32Array((ALONG + 1) * (AROUND + 1));
    for (let i = 0; i <= ALONG; i++) {
      for (let j = 0; j <= AROUND; j++) {
        t[i * (AROUND + 1) + j] = i / ALONG;
        a[i * (AROUND + 1) + j] = (j / AROUND) * Math.PI * 2;
      }
    }
    const index: number[] = [];
    for (let i = 0; i < ALONG; i++) {
      for (let j = 0; j < AROUND; j++) {
        const p = i * (AROUND + 1) + j;
        const q = p + AROUND + 1;
        index.push(p, q, p + 1, q, q + 1, p + 1);
      }
    }
    // Positions are made in the shader; this attribute only gives the vertex count.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(t.length * 3), 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    geo.setAttribute('aA', new THREE.BufferAttribute(a, 1));
    geo.setIndex(index);
    this.u = {
      uOrigin: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
      uGravity: { value: gravity },
      uTail: { value: 0 },
      uHead: { value: 0 },
      uFlight: { value: 1 },
      // A thin stream of water; a flame flaring wide from the mouth.
      uR0: { value: look === 'fire' ? 0.08 : 0.05 },
      uR1: { value: look === 'fire' ? 0.85 : 0.22 },
      uOpacity: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.u, uTime: shared.uTime, uDayLight: shared.uDayLight, uSunColor: shared.uSunColor },
      vertexShader: VERT,
      fragmentShader: look === 'fire' ? FIRE_FRAG : FRAG,
      transparent: true,
      depthWrite: false,
      ...(look === 'fire' ? FIRE_BLENDING : {}),
      // Both sides: through the clear middle you see the far wall's bright edge.
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = look === 'fire' ? 'flame-jet' : 'water-jet';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Thickness at the start and at the end of the arc (m): Bọt's geyser is a thick column. */
  setRadius(r0: number, r1: number): void {
    this.u.uR0.value = r0;
    this.u.uR1.value = r1;
  }

  update(s: StreamState): void {
    const show = s.opacity > 0.001 && s.head > s.tail + 1e-3;
    this.mesh.visible = show;
    if (!show) return;
    this.u.uOrigin.value.set(s.ox, s.oy, s.oz);
    this.u.uVel.value.set(s.vx, s.vy, s.vz);
    this.u.uTail.value = s.tail;
    this.u.uHead.value = s.head;
    this.u.uFlight.value = s.flight;
    this.u.uOpacity.value = s.opacity;
  }
}
