import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLEND_GLSL, FIRE_BLENDING } from './fireBlend';

/** The quad reaches this many core half-widths out, for the halo. */
const SPAN = 5;

/**
 * The beam: one quad between uFrom and uTo, turned about its own axis to face the camera (an
 * axial billboard), at least 1.5 px wide at any distance.
 */
const BEAM_VERT = /* glsl */ `
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uWidth;
uniform float uPx;
varying float vAcross;
varying float vAlong;
varying float vLen;
varying float vThin;
const float SPAN = ${SPAN.toFixed(1)};
void main() {
  vec3 axis = uTo - uFrom;
  float len = max(length(axis), 0.001);
  vec3 dir = axis / len;
  vec3 p = uFrom + axis * position.x;
  vec3 toCam = cameraPosition - p;
  float dist = length(toCam);
  vec3 side = cross(dir, toCam / max(dist, 0.001));
  side = length(side) > 1e-4 ? normalize(side) : vec3(0.0, 1.0, 0.0);
  float minW = 1.5 * dist / uPx;
  float hw = max(uWidth, minW);
  p += side * position.y * hw * SPAN;
  vAcross = position.y * SPAN;
  vAlong = position.x * len;
  vLen = len;
  // Held at the 1.5 px floor, it dims instead of growing: a thin beam far away stays thin.
  vThin = uWidth / hw;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
uniform float uStrength;
uniform float uHeat;
uniform float uFlicker;
varying float vAcross;
varying float vAlong;
varying float vLen;
varying float vThin;
${FIRE_BLEND_GLSL}
void main() {
  float d = abs(vAcross);
  // Near-white hot core, wider coloured halo (ice blue, toward violet as it heats).
  float core = exp(-d * d * 3.0);
  float halo = exp(-d * d * 0.32) * 0.55;
  vec3 hc = mix(vec3(0.45, 0.85, 1.0), vec3(0.72, 0.45, 1.0), uHeat);
  // Energy running along it, and the flicker of a held beam.
  float run = 0.85 + 0.15 * sin(vAlong * 0.9 - uTime * 40.0) * sin(vAlong * 0.37 - uTime * 23.0);
  float flick = 1.0 + uFlicker * 0.1 * sin(uTime * 188.5);
  // Soft at the mouth and at the tip.
  float ends = smoothstep(0.0, 0.4, vAlong) * smoothstep(0.0, 0.6, vLen - vAlong);
  vec3 col = vec3(1.0) * core * 1.6 + hc * halo * (1.0 + uHeat);
  float a = clamp((core + halo) * run * flick * ends * uStrength * mix(0.6, 1.0, vThin), 0.0, 1.0);
  gl_FragColor = fireBlend(col, a, uDayLight);
}
`;

/** Two flares: the muzzle (aKind 0) at the mouth and the impact (1) where the beam ends. */
const FLARE_VERT = /* glsl */ `
attribute float aKind;
uniform float uPx;
uniform float uStrength;
uniform float uHit;
varying float vKind;
void main() {
  vec4 mv = viewMatrix * vec4(position, 1.0);
  float size = aKind < 0.5 ? 0.7 : 1.6 * uHit;
  gl_PointSize = clamp(size * (0.6 + 0.4 * uStrength) * uPx / max(0.1, -mv.z), 0.0, 160.0);
  vKind = aKind;
  gl_Position = projectionMatrix * mv;
}
`;

const FLARE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDayLight;
uniform float uStrength;
uniform float uHeat;
varying float vKind;
${FIRE_BLEND_GLSL}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  if (r > 1.0) discard;
  float glow = exp(-r * r * 9.0);
  // A four-pointed star.
  float star = exp(-abs(q.x) * 14.0) * exp(-abs(q.y) * 2.0) + exp(-abs(q.y) * 14.0) * exp(-abs(q.x) * 2.0);
  float rays = 0.0;
  if (vKind > 0.5) {
    // Frost sparks: eight thin rays turning slowly.
    float an = atan(q.y, q.x) + uTime * 1.7;
    rays = pow(max(0.0, cos(an * 4.0)), 60.0) * (1.0 - r) * 1.2;
  }
  vec3 hc = mix(vec3(0.55, 0.9, 1.0), vec3(0.75, 0.5, 1.0), uHeat);
  vec3 col = vec3(1.0) * glow * 1.4 + hc * (star + rays);
  float a = clamp((glow + star * 0.8 + rays) * uStrength, 0.0, 1.0);
  gl_FragColor = fireBlend(col, a, uDayLight);
}
`;

/** The manta's frost laser: the beam and its two flares (2 draw calls while it shows). */
export class LaserBeam {
  private readonly beam: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly flares: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly flarePos: THREE.BufferAttribute;
  private readonly u: Record<string, THREE.IUniform>;

  constructor(
    private readonly scene: THREE.Scene,
    shared: SharedUniforms,
  ) {
    this.u = {
      uTime: shared.uTime,
      uDayLight: shared.uDayLight,
      uFrom: { value: new THREE.Vector3() },
      uTo: { value: new THREE.Vector3() },
      uWidth: { value: 0.06 },
      uPx: { value: 800 },
      uStrength: { value: 0 },
      uHeat: { value: 0 },
      uFlicker: { value: 0 },
      uHit: { value: 0 },
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const common = { uniforms: this.u, transparent: true, depthWrite: false, ...FIRE_BLENDING };
    this.beam = new THREE.Mesh(g, new THREE.ShaderMaterial({ ...common, vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, side: THREE.DoubleSide }));
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 6;
    this.beam.visible = false;

    const fg = new THREE.BufferGeometry();
    this.flarePos = new THREE.BufferAttribute(new Float32Array(6), 3);
    fg.setAttribute('position', this.flarePos);
    fg.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array([0, 1]), 1));
    this.flares = new THREE.Points(fg, new THREE.ShaderMaterial({ ...common, vertexShader: FLARE_VERT, fragmentShader: FLARE_FRAG }));
    this.flares.frustumCulled = false;
    this.flares.renderOrder = 7;
    this.flares.visible = false;
    scene.add(this.beam, this.flares);
  }

  /** Pixels per metre at 1 m away: the view's height / (2·tan(fov/2)). */
  setViewport(heightPx: number, fovDeg: number): void {
    this.u.uPx.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * From the mouth to the end point (world); strength and heat from LaserFire; `hit`: something
   * was struck there (the impact flare); `flicker` off with reduced motion.
   */
  set(from: THREE.Vector3, to: THREE.Vector3, strength: number, heat: number, hit: boolean, flicker: boolean): void {
    (this.u.uFrom.value as THREE.Vector3).copy(from);
    (this.u.uTo.value as THREE.Vector3).copy(to);
    this.u.uWidth.value = (0.06 + 0.1 * heat) * strength;
    this.u.uStrength.value = strength;
    this.u.uHeat.value = heat;
    this.u.uFlicker.value = flicker ? 1 : 0;
    this.u.uHit.value = hit ? 1 : 0;
    this.flarePos.setXYZ(0, from.x, from.y, from.z);
    this.flarePos.setXYZ(1, to.x, to.y, to.z);
    this.flarePos.needsUpdate = true;
    this.beam.visible = this.flares.visible = strength > 0.001;
  }

  hide(): void {
    this.beam.visible = this.flares.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.beam, this.flares);
    this.beam.geometry.dispose();
    this.beam.material.dispose();
    this.flares.geometry.dispose();
    this.flares.material.dispose();
  }
}
