import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';
import { TrailRibbon, type RibbonProfile } from './trailRibbon';

/** Seconds a stretch of wind stays visible behind the wing tip. */
const LIFE = 1.1;
/** Points per wing (one every STEP m: ~35 m of trail at a sprint, more than a second's worth). */
const POINTS = 96;
const STEP = 0.8;

/** A narrow strip across the path (s: which way it spirals, h: across the strip). */
const left: RibbonProfile = { verts: [[-1, -1], [-1, 1]], bands: [[0, 1]] };
const right: RibbonProfile = { verts: [[1, -1], [1, 1]], bands: [[0, 1]] };

// The wing-tip vortex: the strip winds round the path in a spiral that widens and fades as it
// ages (the two wings turn opposite ways, as real tip vortices do). The side vector's length
// carries how strong the wind was there (the speed when it was laid).
const VERT = /* glsl */ `
attribute vec2 aSide;
attribute vec2 aProf;
attribute float aBirth;
attribute float aAlong;
uniform float uTime;
uniform float uLife;
varying float vK;
varying float vAcross;
varying float vAlong;
varying float vPower;
void main() {
  float age = uTime - aBirth;
  float k = clamp(age / uLife, 0.0, 1.0);
  float power = length(aSide);
  vec3 side = vec3(aSide.x, 0.0, aSide.y) / max(power, 1e-4);
  float th = aProf.x * (aAlong * 1.1 + age * 6.0);
  float r = 0.08 + 0.7 * k;
  vec3 radial = side * cos(th) + vec3(0.0, 1.0, 0.0) * sin(th);
  vec3 tangent = -side * sin(th) + vec3(0.0, 1.0, 0.0) * cos(th);
  vec3 p = position + radial * r + tangent * aProf.y * (0.16 + 0.3 * k);
  vK = k;
  vAcross = aProf.y;
  vAlong = aAlong;
  vPower = power;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uDayLight;
varying float vK;
varying float vAcross;
varying float vAlong;
varying float vPower;
${FIRE_BLEND_GLSL}
void main() {
  // Soft across the strip, streaky along it, fading in at the tip and out with age.
  float soft = 1.0 - vAcross * vAcross;
  // A bright thread down the middle in a softer haze.
  float core = exp(-vAcross * vAcross * 18.0);
  float streak = 0.6 + 0.4 * sin(vAlong * 2.7 + vK * 4.0);
  float a = (soft * 0.55 + core) * streak * smoothstep(0.0, 0.03, vK) * (1.0 - vK) * (1.0 - vK) * vPower;
  if (a < 0.004) discard;
  vec3 col = mix(vec3(0.95, 1.0, 1.0), vec3(0.55, 0.85, 1.0), vK);
  gl_FragColor = fireBlend(col * 1.3, a, uDayLight);
}
`;

/**
 * Cold wind off the wing tips while the manta flies (an ice creature): a pale spiralling streak
 * behind each tip, stronger the faster it goes. Two ribbons (one per wing), one shared material;
 * the CPU lays a point every STEP m, the vertex shader winds and fades them.
 */
export class WingTrails {
  readonly meshes: THREE.Mesh[];
  private readonly ribbons: TrailRibbon[];
  private readonly last = [new THREE.Vector3(Infinity, 0, 0), new THREE.Vector3(Infinity, 0, 0)];
  private lastBirth = -1e9;
  private readonly material: THREE.ShaderMaterial;

  constructor(shared: SharedUniforms) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uLife: { value: LIFE }, uDayLight: shared.uDayLight },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...FIRE_BLENDING,
    });
    this.ribbons = [new TrailRibbon(POINTS, left), new TrailRibbon(POINTS, right)];
    this.meshes = this.ribbons.map((r, i) => {
      const m = new THREE.Mesh(r.geometry, this.material);
      m.name = `wing-trail-${i}`;
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 4;
      return m;
    });
  }

  /**
   * Every frame while flying: the wing tip `i` (0 left, 1 right) is at `tip`, the side vector
   * (sx, sz) (unit, horizontal), `power` 0 … 1 (0: too slow, the trail breaks off).
   */
  follow(i: number, tip: THREE.Vector3, sx: number, sz: number, power: number, now: number): void {
    const r = this.ribbons[i];
    if (power <= 0.02) {
      r.cut();
      this.last[i].x = Infinity;
      return;
    }
    if (tip.distanceTo(this.last[i]) < STEP) return;
    r.push(tip.x, tip.y, tip.z, sx * power, sz * power, now);
    this.last[i].copy(tip);
    this.lastBirth = now;
    this.meshes[i].visible = true;
  }

  /** Hides them once the last stretch has faded. */
  update(now: number): void {
    if ((this.meshes[0].visible || this.meshes[1].visible) && now - this.lastBirth > LIFE + 0.1) {
      for (const m of this.meshes) m.visible = false;
      for (const r of this.ribbons) r.clear();
    }
  }

  clear(): void {
    this.lastBirth = -1e9;
    for (const r of this.ribbons) r.clear();
    for (const m of this.meshes) m.visible = false;
  }

  dispose(): void {
    for (const r of this.ribbons) r.dispose();
    this.material.dispose();
  }
}
