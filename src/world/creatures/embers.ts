import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';

/** Pool sizes: a rainbow arc is drawn with many motes at once. */
const MAX = 400;
const MAX_RAINBOW = 3000;
/** Hỏa Long's ring of fire and meteors throw many sparks at once. */
const MAX_EMBER = 1500;

/** Anything that throws embers (or puffs of steam). */
export interface EmberSink {
  /**
   * One particle at (x, y, z), thrown at (vx, vy, vz) m/s, radius in metres. `seed` (0..1,
   * random if left out): a rainbow mote's hue (0 red … 0.8 violet).
   */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number, seed?: number): void;
}

/**
 * Glowing sparks that rise and wink out; soft white steam that swells and thins away; or pollen
 * (Mầm's spores): little yellow-green motes that drift up slowly and twinkle; or sea sparkle
 * (Bé Mập's fin at night): cyan glints that stay on the water and fade; or rainbow motes (Bé
 * Mập's celebration): glittering drops in every colour that hang in the air and sink slowly; or
 * dandelion seeds (Mầm): white fluffy stars that float on the breeze for seconds.
 */
export type EmberKind = 'ember' | 'steam' | 'spore' | 'sea' | 'rainbow' | 'fluff';

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
#elif defined(SPORE)
  // A mote of pollen: a soft glowing dot, lime to gold, twinkling, fading in and out.
  float glow = exp(-r2 * 3.5);
  float tw = 0.6 + 0.4 * sin(uTime * 6.0 + vSeed * 40.0);
  vec3 col = mix(vec3(0.75, 1.0, 0.35), vec3(1.0, 0.9, 0.4), vSeed);
  float a = glow * tw * smoothstep(0.0, 0.15, vLife) * (1.0 - vLife);
  gl_FragColor = fireBlend(col * (1.0 + exp(-r2 * 12.0)), a, uDayLight);
#elif defined(SEA)
  // Sea sparkle (bioluminescence): a cyan glow on the water, lit up then fading; pure light
  // (additive at any hour, it is only spawned at night).
  float glow = exp(-r2 * 3.0);
  float tw = 0.7 + 0.3 * sin(uTime * 9.0 + vSeed * 30.0);
  vec3 col = mix(vec3(0.2, 0.9, 1.0), vec3(0.45, 1.0, 0.85), vSeed);
  float a = glow * tw * smoothstep(0.0, 0.08, vLife) * (1.0 - vLife) * 0.9;
  gl_FragColor = vec4(col * (1.0 + exp(-r2 * 10.0)) * a, 0.0);
#elif defined(RAINBOW)
  // A rainbow mote: its hue from the seed (the band of the arc it belongs to), a soft glow with
  // a white glint, twinkling; fades in fast and out slowly.
  vec3 hue = clamp(abs(mod(vSeed * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  float glow = exp(-r2 * 3.0);
  float glint = exp(-r2 * 14.0);
  float tw = 0.75 + 0.25 * sin(uTime * 11.0 + vSeed * 90.0 + vLife * 20.0);
  vec3 col = mix(hue, vec3(1.0), glint * 0.7);
  float a = glow * tw * smoothstep(0.0, 0.06, vLife) * (1.0 - vLife * vLife);
  gl_FragColor = fireBlend(col * 1.3, a, uDayLight);
#elif defined(FLUFF)
  // A dandelion seed seen end-on: a small core and a star of fine hairs (the pappus), turning
  // slowly; soft white, faintly glowing at night.
  float ang = atan(c.y, c.x) + vSeed * 6.283 + uTime * (vSeed - 0.5);
  float r = sqrt(r2);
  float hairs = pow(abs(cos(ang * 4.0)), 18.0) * smoothstep(1.0, 0.25, r) * smoothstep(0.0, 0.2, r);
  float core = exp(-r2 * 40.0);
  float a = clamp(hairs * 1.3 + core + exp(-r2 * 4.0) * 0.2, 0.0, 1.0);
  a *= smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.7, 1.0, vLife));
  gl_FragColor = fireBlend(vec3(1.0, 0.99, 0.95), a, uDayLight);
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
  private readonly max: number;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly radius: Float32Array;
  private next = 0;
  private live = false;
  private readonly scale = { value: 600 };

  constructor(
    shared: SharedUniforms,
    private readonly kind: EmberKind,
  ) {
    const max = (this.max = kind === 'rainbow' ? MAX_RAINBOW : kind === 'ember' ? MAX_EMBER : MAX);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(Infinity);
    this.life = new Float32Array(max);
    this.radius = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.lifeAttr = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.seed = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aLife', this.lifeAttr);
    geo.setAttribute('aSeed', this.seed);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.scale, uTime: shared.uTime, uDayLight: shared.uDayLight },
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: kind === 'steam' ? { STEAM: '' } : kind === 'spore' ? { SPORE: '' } : kind === 'sea' ? { SEA: '' } : kind === 'rainbow' ? { RAINBOW: '' } : kind === 'fluff' ? { FLUFF: '' } : {},
      transparent: true,
      depthWrite: false,
      ...(kind === 'steam' ? { blending: THREE.NormalBlending } : FIRE_BLENDING),
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

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number, seed?: number): void {
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
    const k = this.kind;
    this.life[i] = k === 'ember' ? 0.5 + Math.random() * 1.1 : k === 'spore' || k === 'sea' ? 2 + Math.random() * 2 : k === 'rainbow' ? 1.8 + Math.random() * 0.9 : k === 'fluff' ? 4 + Math.random() * 2.5 : 1.4 + Math.random() * 1.6;
    this.radius[i] = radius;
    (this.seed.array as Float32Array)[i] = seed ?? Math.random();
    this.seed.needsUpdate = true;
    this.live = true;
  }

  update(dt: number): void {
    if (!this.live) return;
    const p = this.pos.array as Float32Array;
    const s = this.size.array as Float32Array;
    const l = this.lifeAttr.array as Float32Array;
    const ember = this.kind === 'ember';
    const spore = this.kind === 'spore';
    const sea = this.kind === 'sea';
    const rainbow = this.kind === 'rainbow';
    const fluff = this.kind === 'fluff';
    // Embers: quick drag and a strong lift (hot air); steam: slower on both; pollen: barely lifts.
    // Sea sparkle stays on the water: strong drag, no lift. Rainbow motes sink slowly.
    // Dandelion seeds keep drifting with the breeze they were given (little drag), barely sinking.
    const drag = Math.exp(-(ember ? 2.2 : spore ? 1.8 : sea ? 3 : rainbow ? 1.6 : fluff ? 0.3 : 1.2) * dt);
    const lift = (ember ? 2.4 : spore ? 0.18 : sea ? 0 : rainbow ? -1.1 : fluff ? -0.04 : 0.9) * dt;
    let last = -1;
    for (let i = 0; i < this.max; i++) {
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
      s[i] = this.radius[i] * (ember ? 1 - 0.6 * k : spore || sea || rainbow || fluff ? 1 : 1 + 2.2 * k);
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
