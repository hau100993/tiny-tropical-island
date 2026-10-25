import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';

/** Pool size; Bọt's geyser throws a column of thousands of drops. */
const MAX = 1000;
const MAX_JET = 3000;
const GRAVITY = 9.81;

/** Anything that throws droplets (the paddle now). */
export interface SpraySink {
  /** One droplet at (x, y, z) with velocity (vx, vy, vz) m/s and a radius in meters. */
  drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aFade;
uniform float uScale;
varying float vFade;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // World size → pixels (perspective): radius · (viewport height / 2) / (tan(fov/2) · depth).
  gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 24.0);
  vFade = aFade;
}
`;

const FRAG = /* glsl */ `
uniform float uDayLight;
uniform vec3 uSunColor;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  // A bright glint toward the top of each drop.
  float glint = exp(-dot(c - vec2(-0.3, -0.35), c - vec2(-0.3, -0.35)) * 6.0);
  vec3 col = mix(vec3(0.75, 0.88, 0.95), vec3(1.0), glint) * (0.08 + 0.92 * uDayLight) * mix(vec3(1.0), uSunColor, 0.25);
#ifdef BUBBLE
  // An air bubble: a silvery rim (the light bent at its edge) around a clear middle.
  float a = smoothstep(0.45, 0.95, r2) * 0.85 + glint * 0.6;
#elif defined(JET)
  // A creature's water jet: deeper blue and nearly opaque, so the stream reads on bright sand.
  col = mix(vec3(0.22, 0.55, 0.9), vec3(1.0), glint * 0.8) * (0.15 + 0.85 * uDayLight) * mix(vec3(1.0), uSunColor, 0.2);
  float a = (1.0 - 0.5 * r2) * 0.92;
#else
  float a = (1.0 - r2) * 0.75;
#endif
  gl_FragColor = vec4(col, a * vFade);
}
`;

/** Droplets fall (spray, and jet: the same, in a stronger blue); bubbles rise and wobble until they reach the surface. */
export type SprayKind = 'spray' | 'jet' | 'bubbles';

/**
 * Water droplets thrown by the paddle (or air bubbles under water, kind 'bubbles'): a few hundred points with ballistic motion (CPU, tiny
 * arrays, no allocation per frame), drawn as soft round sprites. A droplet ends when it falls
 * back below the water it came from or after a second and a half.
 */
export class Spray implements SpraySink {
  readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;
  private readonly fade: THREE.BufferAttribute;
  private readonly max: number;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly floor: Float32Array;
  private readonly radius: Float32Array;
  private next = 0;
  private readonly scale: { value: number };

  constructor(
    shared: SharedUniforms,
    private readonly kind: SprayKind = 'spray',
    /** Bubbles: the sea surface above (x, z), where they pop. */
    private readonly ceiling: (x: number, z: number) => number = () => 0,
  ) {
    const max = (this.max = kind === 'jet' ? MAX_JET : MAX);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.radius = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.fade = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aFade', this.fade);
    geo.setDrawRange(0, 0);
    this.scale = { value: 600 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.scale, uDayLight: shared.uDayLight, uSunColor: shared.uSunColor },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: kind === 'bubbles' ? { BUBBLE: '' } : kind === 'jet' ? { JET: '' } : {},
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = kind;
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.age.fill(Infinity);
  }

  /** Viewport height in pixels and vertical field of view, for the point size. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const p = this.pos.array as Float32Array;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.floor[i] = Math.min(y, 0) - 0.05;
    this.radius[i] = size;
    this.live = true;
  }

  /** Any particle alive since the last update that found none (skips idle frames entirely). */
  private live = false;

  update(dt: number): void {
    if (!this.live) return;
    const p = this.pos.array as Float32Array;
    const s = this.size.array as Float32Array;
    const f = this.fade.array as Float32Array;
    let last = -1;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] === Infinity) {
        s[i] = 0;
        continue;
      }
      this.age[i] += dt;
      let dead: boolean;
      if (this.kind === 'bubbles') {
        // Rise toward a terminal speed (bigger bubbles rise faster), wobbling side to side.
        const top = 0.45 + this.radius[i] * 20;
        this.vel[i * 3 + 1] += (top - this.vel[i * 3 + 1]) * (1 - Math.exp(-2 * dt));
        this.vel[i * 3] *= Math.exp(-1.5 * dt);
        this.vel[i * 3 + 2] *= Math.exp(-1.5 * dt);
        const wob = Math.sin(this.age[i] * 9 + i) * 0.12 * dt;
        p[i * 3] += this.vel[i * 3] * dt + wob;
        p[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        p[i * 3 + 2] += this.vel[i * 3 + 2] * dt + Math.cos(this.age[i] * 7 + i) * 0.12 * dt;
        dead = this.age[i] > 20 || p[i * 3 + 1] > this.ceiling(p[i * 3], p[i * 3 + 2]) - 0.03;
      } else {
        this.vel[i * 3 + 1] -= GRAVITY * dt;
        p[i * 3] += this.vel[i * 3] * dt;
        p[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        p[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        dead = this.age[i] > 1.5 || (p[i * 3 + 1] < this.floor[i] && this.vel[i * 3 + 1] < 0);
      }
      if (dead) {
        this.age[i] = Infinity;
        s[i] = 0;
        continue;
      }
      s[i] = this.radius[i];
      f[i] = this.kind === 'bubbles' ? Math.min(1, this.age[i] * 6) : 1 - Math.max(0, this.age[i] - 1) * 2;
      last = i;
    }
    this.points.geometry.setDrawRange(0, last + 1);
    this.live = last >= 0;
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}
