import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';

/** Meteors in flight at once (instances of one quad: one draw call). */
const MAX = 64;
/** Tail length (m) and width (m) at full burn. */
const TAIL = 70;
const WIDTH = 2.6;

// The quad: x −0.5 … 0.5 across, y 0 (tail end) … 1 (head). Each meteor flies from aStart to
// aEnd between aTime.x and aTime.x + aTime.y (shader time); turned to face the camera across
// its width. Before or after that it collapses to nothing (off-screen).
const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aTime;
attribute float aSeed;
uniform float uTime;
uniform float uTail;
uniform float uWidth;
varying vec2 vUv;
varying float vK;
varying float vSeed;
void main() {
  float k = (uTime - aTime.x) / aTime.y;
  if (k < 0.0 || k > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 dir = normalize(aEnd - aStart);
  // Speeding up a little as it falls.
  vec3 head = mix(aStart, aEnd, k * (0.7 + 0.3 * k));
  // The tail grows out of the head at first, and burns shorter at the end.
  float tail = uTail * (0.4 + 0.6 * aSeed) * min(1.0, k * 5.0) * (1.0 - 0.5 * k);
  vec3 p = head - dir * tail * (1.0 - position.y);
  vec3 side = normalize(cross(dir, p - cameraPosition));
  p += side * position.x * uWidth * (0.6 + 0.6 * aSeed);
  vUv = vec2(position.x * 2.0, position.y);
  vK = k;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uDayLight;
varying vec2 vUv;
varying float vK;
varying float vSeed;
${FIRE_BLEND_GLSL}
void main() {
  float across = 1.0 - vUv.x * vUv.x;
  float y = vUv.y;
  // A white-hot head, an icy blue tail turning violet toward its end.
  float head = smoothstep(0.86, 1.0, y) * across;
  float tail = pow(y, 1.3) * pow(across, 2.0);
  vec3 col = mix(vec3(0.55, 0.45, 1.0), vec3(0.45, 0.85, 1.0), smoothstep(0.2, 0.8, y));
  col = mix(col, vec3(1.0), head);
  col = mix(col, vec3(1.0, 0.75, 0.9), 0.35 * vSeed * (1.0 - y));
  float a = clamp(tail + head * 1.5, 0.0, 1.0);
  // Fades in at the start, flares and burns out at the end.
  a *= smoothstep(0.0, 0.08, vK) * (1.0 - smoothstep(0.85, 1.0, vK));
  if (a < 0.004) discard;
  gl_FragColor = fireBlend(col * (1.6 + 0.8 * head), a, uDayLight);
}
`;

/**
 * Mưa Sao Băng's shooting stars: streaks of light across the sky, white-hot heads with icy
 * tails. All on the GPU: launching one writes its start, end and times into its instance
 * slot; the shader flies it. Nothing per frame on the CPU.
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
    const geo = new THREE.PlaneGeometry(1, 1, 1, 4);
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
      uniforms: { uTime: shared.uTime, uTail: { value: TAIL }, uWidth: { value: WIDTH }, uDayLight: shared.uDayLight },
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
    this.lastEnd = Math.max(this.lastEnd, t0 + dur);
    this.mesh.visible = true;
  }

  /** Hides the mesh once the last one has burnt out. */
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
