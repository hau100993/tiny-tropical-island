import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FLAME_VERT = /* glsl */ `
uniform vec3 uPos;
uniform float uSize;
varying vec2 vUv;
void main() {
  // Turned to the camera about the vertical (a flame always points up): the camera's right
  // vector from the view matrix, world up.
  vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vec3 p = uPos + right * position.x * uSize * 0.65 + vec3(0.0, (position.y + 0.32) * uSize, 0.0);
  vUv = position.xy + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
uniform float uOpacity;
uniform float uSeed;
varying vec2 vUv;
${NOISE}
${FIRE_BLEND_GLSL}
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float t = uTime + uSeed;
  // Noise rising through the flame bends and tears it.
  float n = noise(vec2(x * 3.0, y * 4.0 - t * 6.0));
  float n2 = noise(vec2(x * 7.0 + 3.0, y * 9.0 - t * 11.0));
  float xx = x + (n - 0.5) * 0.7 * y;
  // A teardrop: round at the bottom, a tongue at the top; it breathes a little.
  float w = 0.85 * pow(max(1.0 - y, 0.0), 0.9) * (0.35 + 0.65 * smoothstep(0.0, 0.3, y)) * (0.9 + 0.1 * sin(t * 13.0));
  float shape = 1.0 - abs(xx) / max(w, 1e-3) - n2 * 0.45 * y;
  float a = smoothstep(0.0, 0.3, shape) * smoothstep(0.0, 0.08, y);
  if (a < 0.01) discard;
  float heat = shape * (1.0 - 0.55 * y);
  vec3 col = mix(vec3(0.7, 0.08, 0.0), vec3(1.0, 0.45, 0.05), smoothstep(0.05, 0.4, heat));
  col = mix(col, vec3(1.0, 0.95, 0.7), smoothstep(0.45, 0.85, heat));
  gl_FragColor = fireBlend(col * 1.25, a * uOpacity, uDayLight);
}
`;

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  if (r > 1.0) discard;
  float flick = 0.88 + 0.12 * sin(uTime * 17.0) * sin(uTime * 7.3);
  float a = pow(1.0 - r, 2.2) * uIntensity * flick;
  gl_FragColor = vec4(vec3(1.0, 0.5, 0.15) * a, 1.0);
}
`;

/**
 * A small fire burning at a point (Hỏa Long's tail tip): one camera-facing quad whose flame is
 * drawn in the fragment shader (noise rising through a teardrop, colour by heat). Additive, two
 * triangles, no texture. `flare` makes it bigger and brighter (excited, breathing fire); rain
 * makes it smaller.
 */
export class FlameSprite {
  readonly mesh: THREE.Mesh;
  private readonly u = {
    uPos: { value: new THREE.Vector3() },
    uSize: { value: 0.2 },
    uOpacity: { value: 1 },
    uSeed: { value: Math.random() * 100 },
  };

  constructor(shared: SharedUniforms) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.u, uTime: shared.uTime, uDayLight: shared.uDayLight },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      ...FIRE_BLENDING,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.name = 'tail-flame';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** At world `p`, `size` m tall. */
  set(p: THREE.Vector3, size: number, opacity: number): void {
    this.u.uPos.value.copy(p);
    this.u.uSize.value = size;
    this.u.uOpacity.value = opacity;
  }
}

/**
 * The fire's light on the ground under it, faked: an additive disc of warm light lying on the
 * sand (stronger at night and when the flame flares). A real three.js light would change every
 * lit material's shader (all recompiled when it appears) and cost every pixel; this is one quad.
 */
export class GroundGlow {
  readonly mesh: THREE.Mesh;
  private readonly intensity = { value: 0 };

  constructor(shared: SharedUniforms) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uIntensity: this.intensity, uTime: shared.uTime },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'fire-glow';
    this.mesh.frustumCulled = false;
  }

  /** Centred at (x, groundY, z), `radius` m, brightness 0..1 (0 hides it). */
  set(x: number, groundY: number, z: number, radius: number, intensity: number): void {
    this.mesh.visible = intensity > 0.01;
    this.mesh.position.set(x, groundY + 0.04, z);
    this.mesh.scale.setScalar(radius * 2);
    this.intensity.value = intensity;
  }
}
