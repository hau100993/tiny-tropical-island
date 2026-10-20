import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';

const MAX = 400;
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
  // A bright glint toward the top of each drop, soft edge.
  float glint = exp(-dot(c - vec2(-0.3, -0.35), c - vec2(-0.3, -0.35)) * 6.0);
  vec3 col = mix(vec3(0.75, 0.88, 0.95), vec3(1.0), glint) * (0.08 + 0.92 * uDayLight) * mix(vec3(1.0), uSunColor, 0.25);
  gl_FragColor = vec4(col, (1.0 - r2) * 0.75 * vFade);
}
`;

/**
 * Water droplets thrown by the paddle: a few hundred points with ballistic motion (CPU, tiny
 * arrays, no allocation per frame), drawn as soft round sprites. A droplet ends when it falls
 * back below the water it came from or after a second and a half.
 */
export class Spray implements SpraySink {
  readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;
  private readonly fade: THREE.BufferAttribute;
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX);
  private readonly floor = new Float32Array(MAX);
  private readonly radius = new Float32Array(MAX);
  private next = 0;
  private readonly scale: { value: number };

  constructor(shared: SharedUniforms) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.fade = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aFade', this.fade);
    geo.setDrawRange(0, 0);
    this.scale = { value: 600 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.scale, uDayLight: shared.uDayLight, uSunColor: shared.uSunColor },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'spray';
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    for (let i = 0; i < MAX; i++) this.age[i] = Infinity;
  }

  /** Viewport height in pixels and vertical field of view, for the point size. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  drop(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
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
  }

  update(dt: number): void {
    const p = this.pos.array as Float32Array;
    const s = this.size.array as Float32Array;
    const f = this.fade.array as Float32Array;
    let last = -1;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] === Infinity) {
        s[i] = 0;
        continue;
      }
      this.age[i] += dt;
      this.vel[i * 3 + 1] -= GRAVITY * dt;
      p[i * 3] += this.vel[i * 3] * dt;
      p[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      p[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.age[i] > 1.5 || (p[i * 3 + 1] < this.floor[i] && this.vel[i * 3 + 1] < 0)) {
        this.age[i] = Infinity;
        s[i] = 0;
        continue;
      }
      s[i] = this.radius[i];
      f[i] = 1 - Math.max(0, this.age[i] - 1) * 2;
      last = i;
    }
    this.points.geometry.setDrawRange(0, last + 1);
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}
