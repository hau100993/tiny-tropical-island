import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIELD, type BubbleField } from '../../activities/flight/bubbleField';
import { BUBBLE_FILM_GLSL } from './bubbleFilm.glsl';
import { FIRE_BLEND_GLSL, FIRE_BLENDING } from './fireBlend';

/** Burst droplets: how long one flies (s), its drag (1/s) and gravity (m/s²). */
const DROP_LIFE = 0.7;
const DROP_DRAG = 2.5;
const DROP_GRAVITY = 6;
/** Droplets thrown per burst. */
const PER_BURST = 40;

/**
 * The hunt bubbles: one instanced sphere. Each instance carries its spawn parameters; the vertex
 * shader evaluates the same motion as BubbleField.posAt, so the CPU only uploads on a change.
 */
const VERT = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aFreq;
attribute vec3 aPhase;
/** born, radius, burstAt, fadeAt */
attribute vec4 aInfo;
attribute vec3 aBurstDir;
uniform float uTime;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
varying vec3 vDir;
varying float vRim;
varying float vFade;
const float DRIFT = ${FIELD.drift.toFixed(3)};
const float RISE = ${FIELD.rise.toFixed(3)};
const float GROW = ${FIELD.grow.toFixed(3)};
const float BURST = ${FIELD.burst.toFixed(3)};
void main() {
  float tau = uTime - aInfo.x;
  float r = aInfo.y;
  float burstAt = aInfo.z;
  float fadeAt = aInfo.w;
  float fade = fadeAt < 0.0 ? 1.0 : 1.0 - clamp((uTime - fadeAt) / GROW, 0.0, 1.0);
  if (r <= 0.0 || fade <= 0.0 || tau < 0.0 || (burstAt >= 0.0 && uTime > burstAt + BURST)) {
    // Empty, faded or gone: outside the clip volume, nothing drawn.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 c = aP0 + vec3(
    DRIFT * sin(aFreq.x * tau + aPhase.x),
    RISE * tau + 0.5 * DRIFT * sin(aFreq.y * tau + aPhase.y),
    DRIFT * sin(aFreq.z * tau + aPhase.z));
  // Grows in with a little overshoot (ease-out-back).
  float g = clamp(tau / GROW, 0.0, 1.0) - 1.0;
  float grow = 1.0 + 2.70158 * g * g * g + 1.70158 * g * g;
  // A soap film wobbles: the sphere pushed in and out by a few slow waves.
  vec3 p = position;
  float w = sin(p.x * 3.0 + uTime * 4.0 + aPhase.x) * sin(p.y * 2.5 + uTime * 3.1) * sin(p.z * 3.3 + uTime * 3.7);
  p *= 1.0 + w * 0.04;
  float k = burstAt >= 0.0 ? clamp((uTime - burstAt) / BURST, 0.0, 1.0) : 0.0;
  // Bursting, the film swells a little as it tears.
  vec3 world = c + p * r * grow * (1.0 + 0.08 * k);
  vN = normal;
  vView = cameraPosition - world;
  vLocal = position;
  vDir = aBurstDir;
  vRim = burstAt >= 0.0 ? 3.14159265 * smoothstep(0.0, 1.0, k) : -1.0;
  vFade = fade;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

/**
 * Bursting (vRim ≥ 0), a hole opens round the hit point: film nearer than the rim angle to it is
 * gone, the rim is jagged (the film tearing into ligaments) and bright.
 */
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
varying vec3 vN;
varying vec3 vView;
varying vec3 vLocal;
varying vec3 vDir;
varying float vRim;
varying float vFade;
${BUBBLE_FILM_GLSL}
void main() {
  vec3 l = normalize(vLocal);
  vec4 f = bubbleFilm(normalize(vN), normalize(vView), l, uTime, uDayLight);
  vec3 col = f.rgb;
  float a = f.a;
  if (vRim >= 0.0) {
    float ang = acos(clamp(dot(l, vDir), -1.0, 1.0));
    // Angle round the hit axis, for the ragged edge.
    vec3 b1 = normalize(abs(vDir.y) < 0.9 ? cross(vDir, vec3(0.0, 1.0, 0.0)) : cross(vDir, vec3(1.0, 0.0, 0.0)));
    vec3 b2 = cross(vDir, b1);
    float az = atan(dot(l, b2), dot(l, b1));
    float rag = 0.5 * sin(az * 9.0) + 0.3 * sin(az * 17.0 + 1.3) + 0.2 * sin(az * 31.0 + 2.1);
    float edge = vRim + 0.28 * rag * (vRim / 3.14159265);
    if (ang < edge) discard;
    float band = 1.0 - smoothstep(0.0, 0.14, ang - edge);
    col += band * vec3(0.85, 0.97, 1.0) * 1.4;
    a = max(a, band * 0.9);
  }
  gl_FragColor = vec4(col, a * vFade);
}
`;

const DROP_VERT = /* glsl */ `
attribute vec3 aVel;
attribute float aBirth;
attribute float aSeed;
uniform float uTime;
uniform float uPx;
varying float vLife;
varying float vSeed;
const float LIFE = ${DROP_LIFE.toFixed(3)};
const float DRAG = ${DROP_DRAG.toFixed(3)};
const float GRAVITY = ${DROP_GRAVITY.toFixed(3)};
void main() {
  float t = uTime - aBirth;
  if (aBirth < 0.0 || t < 0.0 || t > LIFE) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec3 p = position + aVel * (1.0 - exp(-DRAG * t)) / DRAG;
  p.y -= 0.5 * GRAVITY * t * t;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  // A drop 6–12 cm across (the frost crystals, a seed over 0.8, twice that), at least 1.5 px.
  float size = mix(0.06, 0.12, fract(aSeed * 7.31)) * (aSeed > 0.8 ? 2.0 : 1.0);
  gl_PointSize = clamp(size * uPx / max(0.1, -mv.z), 1.5, 14.0);
  vLife = t / LIFE;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}
`;

const DROP_FRAG = /* glsl */ `
uniform float uDayLight;
varying float vLife;
varying float vSeed;
${FIRE_BLEND_GLSL}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float core = exp(-d * 3.0);
  // Frost-aurora palette: white-cyan drops, a few violet crystals.
  vec3 col = vSeed > 0.8 ? vec3(0.78, 0.6, 1.0) : mix(vec3(0.75, 0.95, 1.0), vec3(1.0), core);
  float a = core * (1.0 - vLife) * (1.0 - vLife);
  gl_FragColor = fireBlend(col * 1.3, a, uDayLight);
}
`;

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

/** Draws BubbleField's bubbles and their burst droplets (2 draw calls, none when hidden). */
export class HuntBubbles {
  private readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly drops: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly p0: THREE.InstancedBufferAttribute;
  private readonly freq: THREE.InstancedBufferAttribute;
  private readonly phase: THREE.InstancedBufferAttribute;
  private readonly info: THREE.InstancedBufferAttribute;
  private readonly dir: THREE.InstancedBufferAttribute;
  private readonly dStart: THREE.BufferAttribute;
  private readonly dVel: THREE.BufferAttribute;
  private readonly dBirth: THREE.BufferAttribute;
  private readonly dSeed: THREE.BufferAttribute;
  private readonly dropCount: number;
  private dropNext = 0;
  private version = -1;

  constructor(
    private readonly scene: THREE.Scene,
    shared: SharedUniforms,
    capacity: number,
    droplets: number,
  ) {
    const sphere = new THREE.SphereGeometry(1, 32, 20);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = sphere.index;
    geo.setAttribute('position', sphere.getAttribute('position'));
    geo.setAttribute('normal', sphere.getAttribute('normal'));
    const inst = (n: number): THREE.InstancedBufferAttribute => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
    this.p0 = inst(3);
    this.freq = inst(3);
    this.phase = inst(3);
    this.info = inst(4);
    this.dir = inst(3);
    geo.setAttribute('aP0', this.p0);
    geo.setAttribute('aFreq', this.freq);
    geo.setAttribute('aPhase', this.phase);
    geo.setAttribute('aInfo', this.info);
    geo.setAttribute('aBurstDir', this.dir);
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uDayLight: shared.uDayLight },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        // Through the hole you see the far side of the film.
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;

    this.dropCount = droplets;
    const dg = new THREE.BufferGeometry();
    this.dStart = new THREE.BufferAttribute(new Float32Array(droplets * 3), 3);
    this.dVel = new THREE.BufferAttribute(new Float32Array(droplets * 3), 3);
    this.dBirth = new THREE.BufferAttribute(new Float32Array(droplets).fill(-1), 1);
    this.dSeed = new THREE.BufferAttribute(new Float32Array(droplets), 1);
    dg.setAttribute('position', this.dStart);
    dg.setAttribute('aVel', this.dVel);
    dg.setAttribute('aBirth', this.dBirth);
    dg.setAttribute('aSeed', this.dSeed);
    this.drops = new THREE.Points(
      dg,
      new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uDayLight: shared.uDayLight, uPx: { value: 800 } },
        vertexShader: DROP_VERT,
        fragmentShader: DROP_FRAG,
        transparent: true,
        depthWrite: false,
        ...FIRE_BLENDING,
      }),
    );
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 5;
    this.drops.visible = false;
    scene.add(this.mesh, this.drops);
  }

  /** Pixels per metre at 1 m away: the view's height / (2·tan(fov/2)). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.drops.material.uniforms.uPx.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /** Uploads the slots when the field changed; `on` shows the meshes. */
  sync(field: BubbleField, on: boolean, now: number): void {
    this.mesh.visible = on;
    this.drops.visible = on || this.dropsFlying(now);
    if (!on || field.version === this.version) return;
    this.version = field.version;
    const n = field.slots.length;
    for (let i = 0; i < n; i++) {
      const s = field.slots[i];
      this.p0.setXYZ(i, s.p0[0], s.p0[1], s.p0[2]);
      this.freq.setXYZ(i, s.freq[0], s.freq[1], s.freq[2]);
      this.phase.setXYZ(i, s.phase[0], s.phase[1], s.phase[2]);
      this.info.setXYZW(i, s.born, s.live ? s.radius : 0, s.burstAt, s.fadeAt);
      this.dir.setXYZ(i, s.burstDir[0], s.burstDir[1], s.burstDir[2]);
    }
    this.p0.needsUpdate = this.freq.needsUpdate = this.phase.needsUpdate = true;
    this.info.needsUpdate = this.dir.needsUpdate = true;
    this.mesh.geometry.instanceCount = n;
  }

  /**
   * A burst at the bubble (c, r), hit on the side `d` (unit, from the centre): droplets fly off the
   * tearing rim, outward and round it.
   */
  splash(cx: number, cy: number, cz: number, r: number, dx: number, dy: number, dz: number, now: number): void {
    const axis = tmpA.set(dx, dy, dz);
    const b1 = tmpB.set(0, 1, 0);
    if (Math.abs(axis.y) > 0.9) b1.set(1, 0, 0);
    b1.crossVectors(axis, b1).normalize();
    const b2 = tmpC.crossVectors(axis, b1);
    for (let k = 0; k < PER_BURST; k++) {
      const i = this.dropNext;
      this.dropNext = (this.dropNext + 1) % this.dropCount;
      // A point on the opening rim: round the axis at a polar angle growing with k.
      const pol = 0.2 + Math.random() * 2.6;
      const az = Math.random() * Math.PI * 2;
      const sp = Math.sin(pol);
      const ux = axis.x * Math.cos(pol) + (b1.x * Math.cos(az) + b2.x * Math.sin(az)) * sp;
      const uy = axis.y * Math.cos(pol) + (b1.y * Math.cos(az) + b2.y * Math.sin(az)) * sp;
      const uz = axis.z * Math.cos(pol) + (b1.z * Math.cos(az) + b2.z * Math.sin(az)) * sp;
      this.dStart.setXYZ(i, cx + ux * r, cy + uy * r, cz + uz * r);
      const v = 3 + Math.random() * 4;
      this.dVel.setXYZ(i, ux * v + (Math.random() - 0.5) * 1.5, uy * v + Math.random() * 1.5, uz * v + (Math.random() - 0.5) * 1.5);
      this.dBirth.setX(i, now);
      this.dSeed.setX(i, Math.random());
    }
    this.dStart.needsUpdate = this.dVel.needsUpdate = this.dBirth.needsUpdate = this.dSeed.needsUpdate = true;
    this.lastSplash = now;
    this.drops.visible = true;
  }

  private lastSplash = -Infinity;

  /** The shared clock went back to 0: droplets born on the old clock are forgotten. */
  reset(): void {
    (this.dBirth.array as Float32Array).fill(-1);
    this.dBirth.needsUpdate = true;
    this.lastSplash = -Infinity;
    this.version = -1;
  }

  private dropsFlying(now: number): boolean {
    return now - this.lastSplash < DROP_LIFE;
  }

  dispose(): void {
    this.scene.remove(this.mesh, this.drops);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.drops.geometry.dispose();
    this.drops.material.dispose();
  }
}
