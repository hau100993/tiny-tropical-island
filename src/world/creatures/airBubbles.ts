import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';

const MAX = 800;
/** Bubbles rise slowly toward this speed (m/s) and drift with the wind. */
const RISE = 0.12;
const DRIFT = 0.5;
/** The pop: the last this many seconds, a quick swell and fade. */
const POP = 0.12;

/** Anything that blows bubbles. */
export interface BubbleSink {
  /** One bubble at (x, y, z), thrown at (vx, vy, vz) m/s (air soon slows it), radius in metres. */
  blow(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number): void;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aFade;
attribute float aSeed;
uniform float uScale;
varying float vFade;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // World radius → pixels (see Spray); larger cap than droplets, bubbles come close.
  gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 72.0);
  vFade = aFade;
  vSeed = aSeed;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
uniform vec3 uSunColor;
varying float vFade;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  // Thin-film colours: the phase follows the film's thickness, which varies over the bubble and
  // swirls with time; three phase-shifted cosines give the rainbow bands.
  float phase = r * 4.0 + c.y * 2.0 + vSeed * 6.283 + uTime * 0.8;
  vec3 film = 0.5 + 0.5 * cos(phase + vec3(0.0, 2.1, 4.2));
  // Fresnel: the rim reflects most, the middle is nearly clear.
  float rim = smoothstep(0.45, 0.98, r);
  // A window-like highlight up-left and a faint one opposite.
  float glint = exp(-dot(c - vec2(-0.38, -0.38), c - vec2(-0.38, -0.38)) * 22.0);
  float glint2 = exp(-dot(c - vec2(0.42, 0.45), c - vec2(0.42, 0.45)) * 40.0) * 0.5;
  float light = 0.2 + 0.8 * uDayLight;
  vec3 col = mix(vec3(0.85, 0.95, 1.0), film, 0.7) * light * mix(vec3(1.0), uSunColor, 0.25);
  col += vec3(glint + glint2) * (0.3 + 0.7 * uDayLight);
  float a = 0.05 + rim * 0.7 + glint * 0.9 + glint2;
  // Soft outer edge (no hard pixel ring).
  a *= smoothstep(1.0, 0.9, r);
  gl_FragColor = vec4(col, min(1.0, a) * vFade);
}
`;

/**
 * Soap-like air bubbles (Bọt blows them): a few hundred sprites with a thin-film rainbow rim and
 * highlights, drawn in one call. They are thrown, slowed by the air, rise and wobble, drift with
 * the wind and pop after a few seconds. CPU motion on small typed arrays, no allocation per frame;
 * idle frames (no bubble alive) cost nothing.
 */
export class AirBubbles implements BubbleSink {
  readonly points: THREE.Points;
  private readonly pos: THREE.BufferAttribute;
  private readonly size: THREE.BufferAttribute;
  private readonly fade: THREE.BufferAttribute;
  private readonly seed: THREE.BufferAttribute;
  private readonly vel = new Float32Array(MAX * 3);
  private readonly age = new Float32Array(MAX).fill(Infinity);
  private readonly life = new Float32Array(MAX);
  private readonly radius = new Float32Array(MAX);
  private next = 0;
  private live = false;
  private readonly scale = { value: 600 };

  constructor(
    private readonly shared: SharedUniforms,
    /** Ground height at (x, z): a bubble that touches it pops. */
    private readonly groundAt: (x: number, z: number) => number,
  ) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.size = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.fade = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.seed = new THREE.BufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aFade', this.fade);
    geo.setAttribute('aSeed', this.seed);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.scale, uTime: shared.uTime, uDayLight: shared.uDayLight, uSunColor: shared.uSunColor },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'air-bubbles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Viewport height in pixels and vertical field of view, for the sprite size. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.scale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  blow(x: number, y: number, z: number, vx: number, vy: number, vz: number, radius: number): void {
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
    this.life[i] = 2 + Math.random() * 3.5;
    this.radius[i] = radius;
    (this.seed.array as Float32Array)[i] = Math.random();
    this.seed.needsUpdate = true;
    this.live = true;
  }

  update(dt: number): void {
    if (!this.live) return;
    const p = this.pos.array as Float32Array;
    const s = this.size.array as Float32Array;
    const f = this.fade.array as Float32Array;
    const wind = this.shared.uWind.value;
    const wd = this.shared.uWindDir.value;
    const drag = Math.exp(-3 * dt);
    const ease = 1 - Math.exp(-1.5 * dt);
    let last = -1;
    for (let i = 0; i < MAX; i++) {
      if (this.age[i] === Infinity) continue;
      const a = (this.age[i] += dt);
      const x = p[i * 3];
      const z = p[i * 3 + 2];
      if (a > this.life[i] || p[i * 3 + 1] < this.groundAt(x, z) + this.radius[i] * 0.5) {
        this.age[i] = Infinity;
        s[i] = 0;
        continue;
      }
      // Air drag on the throw, then a slow rise; the wind carries it; a gentle wobble.
      const v = this.vel;
      v[i * 3] = v[i * 3] * drag + wd.x * wind * DRIFT * ease;
      v[i * 3 + 2] = v[i * 3 + 2] * drag + wd.y * wind * DRIFT * ease;
      v[i * 3 + 1] += (RISE - v[i * 3 + 1]) * ease;
      p[i * 3] = x + (v[i * 3] + Math.sin(a * 3.1 + i) * 0.06) * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] = z + (v[i * 3 + 2] + Math.cos(a * 2.7 + i) * 0.06) * dt;
      // Grows in over a moment; at the end a quick swell and fade (the pop).
      const end = this.life[i] - a;
      const pop = end < POP ? 1 - end / POP : 0;
      s[i] = this.radius[i] * Math.min(1, a * 8) * (1 + 0.4 * pop);
      f[i] = 1 - pop;
      last = i;
    }
    this.points.geometry.setDrawRange(0, last + 1);
    this.live = last >= 0;
    this.pos.needsUpdate = true;
    this.size.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}
