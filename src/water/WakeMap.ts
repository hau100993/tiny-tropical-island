import * as THREE from 'three';

/** Side of the square the wake map covers, centered on what it follows (m). */
export const WAKE_SIZE = 48;
/** Most marks alive at once. */
const MAX = 512;

/** Mark shapes: a soft foam blob, a paddle eddy (dimple + swirled foam ring), a splash ring. */
export const WakeKind = { Blob: 0, Eddy: 1, Ring: 2 } as const;
export type WakeKind = (typeof WakeKind)[keyof typeof WakeKind];

/** Anything that can leave marks on the water (the kayak now; swimmers and boards later). */
export interface WakeSink {
  /**
   * A mark at (x, z) drifting with (vx, vz) m/s, living `life` s, growing from `size0` to
   * `size1` m (radius), with `foam` (0..1) and `height` (m, signed) at its start.
   */
  emit(kind: WakeKind, x: number, z: number, vx: number, vz: number, life: number, size0: number, size1: number, foam: number, height: number): void;
}

const VERT = /* glsl */ `
attribute vec2 iPos;
attribute vec4 iShape; // size (m), kind, foam, height
attribute float iAge;  // 0 … 1 of its life
uniform vec2 uCenter;
uniform float uHalf;
varying vec2 vLocal;
varying vec2 vWorld;
varying vec4 vShape;
varying float vAge;
void main() {
  vLocal = position.xy * 2.0;          // −1 … 1 across the mark
  vec2 w = iPos + position.xy * 2.0 * iShape.x;
  vWorld = w;
  vShape = iShape;
  vAge = iAge;
  gl_Position = vec4((w - uCenter) / uHalf, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec2 vLocal;
varying vec2 vWorld;
varying vec4 vShape;
varying float vAge;
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float kind = vShape.y;
  float fade = 1.0 - vAge;
  // Foam breaks up into patches as it ages (fixed to the water, not to the mark).
  float n = vnoise(vWorld * 4.0) * 0.6 + vnoise(vWorld * 11.0) * 0.4;
  float foam;
  float height;
  if (kind < 0.5) {
    float shape = exp(-r * r * 3.5);
    foam = vShape.z * shape * smoothstep(0.15 + 0.6 * vAge, 0.9, n + 0.35 * shape) * fade * fade;
    height = vShape.w * shape * fade;
  } else if (kind < 1.5) {
    // Eddy: a dimple in the middle, foam dragged round in a spiral at the rim.
    float a = atan(vLocal.y, vLocal.x);
    float spiral = 0.5 + 0.5 * sin(a * 2.0 + r * 9.0 - vAge * 6.0);
    float rim = smoothstep(0.25, 0.6, r) * (1.0 - smoothstep(0.75, 1.0, r));
    foam = vShape.z * rim * spiral * smoothstep(0.3, 0.8, n + 0.2) * fade;
    height = -vShape.w * exp(-r * r * 5.0) * fade + vShape.w * 0.4 * rim * fade;
  } else {
    // Splash ring: a thin crest running outward.
    float ring = exp(-pow((r - 0.75) / 0.12, 2.0));
    foam = vShape.z * ring * (0.4 + 0.6 * n) * fade;
    height = vShape.w * (ring - 0.5 * exp(-r * r * 6.0)) * fade;
  }
  gl_FragColor = vec4(foam, height, 0.0, 1.0);
}
`;

/**
 * Wake map: a small, sharp texture of foam and little bumps on the water around the kayak
 * (0.09 m per texel, vs 0.8 m for the ripple simulation, which also only covers the island's
 * shore). Marks are CPU particles (bow waves sliding out into a V, stern wash, paddle swirls,
 * splash rings); every frame the map is cleared and each mark is drawn as a soft quad, added
 * up (blending "dst += src"). The water shader reads it: R = foam, G = height for the normals.
 *
 * For a C/C++ mind: a ring buffer of structs on the CPU, one instanced draw into a float
 * render target per frame. Nothing is allocated per frame.
 */
export class WakeMap implements WakeSink {
  readonly target: THREE.WebGLRenderTarget;
  /** World center of the map; the water shader maps world xz → uv with it. */
  readonly center = new THREE.Vector2(1e5, 1e5);
  private readonly px = new Float32Array(MAX);
  private readonly pz = new Float32Array(MAX);
  private readonly vx = new Float32Array(MAX);
  private readonly vz = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly s0 = new Float32Array(MAX);
  private readonly s1 = new Float32Array(MAX);
  private readonly kind = new Float32Array(MAX);
  private readonly foam = new Float32Array(MAX);
  private readonly height = new Float32Array(MAX);
  private next = 0;
  private readonly iPos: THREE.InstancedBufferAttribute;
  private readonly iShape: THREE.InstancedBufferAttribute;
  private readonly iAge: THREE.InstancedBufferAttribute;
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly mesh: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.Camera();
  private readonly material: THREE.ShaderMaterial;
  private live = false;
  private readonly savedColor = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer, res: number) {
    this.target = new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.iShape = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iAge = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iShape', this.iShape);
    this.geo.setAttribute('iAge', this.iAge);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uCenter: { value: this.center }, uHalf: { value: WAKE_SIZE / 2 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.clear();
  }

  emit(kind: WakeKind, x: number, z: number, vx: number, vz: number, life: number, size0: number, size1: number, foam: number, height: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.px[i] = x;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.kind[i] = kind;
    this.foam[i] = foam;
    this.height[i] = height;
  }

  /**
   * Ages and moves the marks, re-centers the map on (x, z) and redraws it. Marks slow down as
   * they drift (the water calms them).
   */
  update(dt: number, x: number, z: number): void {
    // Snap the center to whole texels so the marks don't shimmer as the map follows.
    const texel = WAKE_SIZE / this.target.width;
    this.center.set(Math.round(x / texel) * texel, Math.round(z / texel) * texel);
    const pos = this.iPos.array as Float32Array;
    const shape = this.iShape.array as Float32Array;
    const ages = this.iAge.array as Float32Array;
    const slow = Math.exp(-0.6 * dt);
    let n = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const a = this.age[i] / this.life[i];
      if (a >= 1) {
        this.life[i] = 0;
        continue;
      }
      this.px[i] += this.vx[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.vx[i] *= slow;
      this.vz[i] *= slow;
      pos[n * 2] = this.px[i];
      pos[n * 2 + 1] = this.pz[i];
      // Grows fast at first, then slowly.
      shape[n * 4] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(a);
      shape[n * 4 + 1] = this.kind[i];
      shape[n * 4 + 2] = this.foam[i];
      shape[n * 4 + 3] = this.height[i];
      ages[n] = a;
      n++;
    }
    if (n === 0 && !this.live) return;
    this.live = n > 0;
    this.geo.instanceCount = n;
    this.iPos.needsUpdate = true;
    this.iShape.needsUpdate = true;
    this.iAge.needsUpdate = true;
    this.clear();
    if (n === 0) return;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.target);
    r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.autoClear = autoClear;
  }

  private clear(): void {
    const prev = this.renderer.getRenderTarget();
    const prevColor = this.renderer.getClearColor(this.savedColor);
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(prev);
    this.renderer.setClearColor(prevColor, prevAlpha);
  }

  dispose(): void {
    this.target.dispose();
    this.geo.dispose();
    this.material.dispose();
  }
}
