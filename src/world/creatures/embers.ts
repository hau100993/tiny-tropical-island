import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';

const MAX = 400;

/** Anything that throws embers (or puffs of steam). */
export interface EmberSink {
  /** One particle at (x, y, z), thrown at (vx, vy, vz) m/s, radius in metres. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number): void;
}

/** Glowing sparks that rise and wink out; or soft white steam that swells and thins away. */
export type EmberKind = 'ember' | 'steam';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute float aSeed;
uniform float uScale;
varying float vLife;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 96.0);
  vLife = aLife;
  vSeed = aSeed;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
varying float vLife;
varying float vSeed;
${FIRE_BLEND_GLSL}
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
#ifdef STEAM
  // A soft puff, a little lumpy, thinning as it ages; lit by the day.
  float lump = 0.85 + 0.15 * sin(atan(c.y, c.x) * 3.0 + vSeed * 6.283);
  float a = smoothstep(1.0, 0.2, r2 / lump) * 0.45 * (1.0 - vLife);
  // Still pale at night (lit by the fire that made it).
  vec3 col = vec3(0.92, 0.94, 0.96) * (0.5 + 0.5 * uDayLight);
  gl_FragColor = vec4(col, a);
#else
  // A spark: white-hot centre, orange glow, cooling to red as it dies; it flickers.
  float core = exp(-r2 * 9.0);
  float glow = exp(-r2 * 2.5);
  float flick = 0.75 + 0.25 * sin(uTime * 37.0 + vSeed * 50.0);
  vec3 hot = mix(vec3(1.0, 0.85, 0.45), vec3(1.0, 0.35, 0.05), vLife);
  vec3 col = hot * glow + vec3(1.0, 0.95, 0.8) * core * (1.0 - vLife);
  gl_FragColor = fireBlend(col * flick, glow * (1.0 - vLife * vLife), uDayLight);
#endif
}
`;

/**
 * Embers from Hỏa Long's flames (additive sparks) or steam where fire meets water (soft puffs):
 * a pool of sprites, one draw call, CPU motion on small typed arrays (no allocation per frame,
 * nothing at all when none is alive). Embers rise on the hot air and drift; steam rises slowly,
 * swells and thins.
 */
export class Embers implements EmberSink {
  readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;
  private readonly lifeAttr: THREE.BufferAttribute;
  private readonly seed: THREE.BufferAttribute;
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly life = new Float32Array(MAX);
  private readonly radius = new Float32Array(MAX);
  private next = 0;
  private live = false;
  private readonly scale = { value: 600 };

  constructor(
    shared: SharedUniforms,
    private readonly kind: EmberKind,
  ) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.seed = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aLife', this.lifeAttr);
    geo.setAttribute('aSeed', this.seed);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.scale, uTime: shared.uTime, uDayLight: shared.uDayLight },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: kind === 'steam' ? { STEAM: '' } : {},
      transparent: true,
      depthWrite: false,
      ...(kind === 'ember' ? FIRE_BLENDING : { blending: THREE.NormalBlending }),
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = kind;
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Viewport height in pixels and vertical field of view, for the sprite size. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number): void {
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
    this.life[i] = this.kind === 'ember' ? 0.5 + Math.random() * 1.1 : 1.4 + Math.random() * 1.6;
    this.radius[i] = radius;
    (this.seed.array as Float32Array)[i] = Math.random();
    this.seed.needsUpdate = true;
    this.live = true;
  }

  update(dt: number): void {
    if (!this.live) return;
    const p = this.pos.array as Float32Array;
    const s = this.size.array as Float32Array;
    const l = this.lifeAttr.array as Float32Array;
    const ember = this.kind === 'ember';
    // Embers: quick drag and a strong lift (hot air); steam: slower on both.
    const drag = Math.exp(-(ember ? 2.2 : 1.2) * dt);
    const lift = (ember ? 2.4 : 0.9) * dt;
    let last = -1;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] === Infinity) continue;
      const a = (this.age[i] += dt);
      const k = a / this.life[i];
      if (k >= 1) {
        this.age[i] = Infinity;
        s[i] = 0;
        continue;
      }
      const v = this.vel;
      v[i * 3] = v[i * 3] * drag + Math.sin(a * 6 + i) * 0.4 * dt;
      v[i * 3 + 1] = v[i * 3 + 1] * drag + lift;
      v[i * 3 + 2] = v[i * 3 + 2] * drag + Math.cos(a * 5 + i) * 0.4 * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      // Sparks shrink as they cool; steam swells as it spreads.
      s[i] = this.radius[i] * (ember ? 1 - 0.6 * k : 1 + 2.2 * k);
      l[i] = k;
      last = i;
    }
    this.points.geometry.setDrawRange(0, last + 1);
    this.live = last >= 0;
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }
}
