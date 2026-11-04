import * as THREE from 'three';
import type { SharedUniforms } from '../../core/uniforms';
import { FIRE_BLENDING, FIRE_BLEND_GLSL } from './fireBlend';
import { TrailRibbon, type RibbonProfile } from './trailRibbon';
import { segmentDistance } from './iceRoad';
import { MANTA_WINGSPAN } from '../../activities/flight/mantaSize';

/** Seconds a curtain hangs in the sky, then fades out. */
export const AURORA_LIFE = 45;
const AURORA_FADE = 8;
/** The curtains' height above the wings (m), and how far apart they hang (the wingtips, m). */
const HEIGHT = 16;
const WINGTIP = MANTA_WINGSPAN / 2 + 0.1;
const POINTS = 320;

/** Two curtains, one from each wingtip: from just under the path up to HEIGHT. */
const PROFILE: RibbonProfile = {
  verts: [
    [-WINGTIP, -0.06],
    [-WINGTIP, 1],
    [WINGTIP, -0.06],
    [WINGTIP, 1],
  ],
  bands: [
    [0, 1],
    [2, 3],
  ],
};

const VERT = /* glsl */ `
attribute vec2 aSide;
attribute vec2 aProf;
attribute float aBirth;
attribute float aAlong;
uniform float uTime;
uniform float uHeight;
uniform float uMotion;
varying float vH;
varying float vAge;
varying float vAlong;
varying float vSide;
void main() {
  float age = uTime - aBirth;
  // Unfurling upward behind the wings, then folding slowly like the real thing.
  float h = aProf.y * uHeight * smoothstep(0.0, 1.8, age);
  float t = uTime * uMotion;
  float fold = sin(aAlong * 0.09 + t * 0.35 + aProf.x) * 1.8 + sin(aAlong * 0.21 - t * 0.5) * 0.8;
  float lean = max(aProf.y, 0.0);
  vec3 p = position + vec3(aSide.x, 0.0, aSide.y) * (aProf.x + fold * (0.3 + lean)) + vec3(0.0, h, 0.0);
  vH = aProf.y;
  vAge = age;
  vAlong = aAlong;
  vSide = sign(aProf.x);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uLife;
uniform float uFade;
uniform float uMotion;
uniform float uDayLight;
varying float vH;
varying float vAge;
varying float vAlong;
varying float vSide;
${FIRE_BLEND_GLSL}
float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f));
}
void main() {
  float h = clamp(vH, 0.0, 1.0);
  float t = uTime * uMotion;
  // Rays: thin vertical streaks drifting along the curtain, of uneven strength.
  float x = vAlong * 0.9 + vSide * 17.0;
  float rays = noise1(x + t * 0.8) * 0.6 + noise1(x * 3.1 - t * 1.3) * 0.4;
  rays = pow(rays, 1.6);
  // Bright along the bottom edge, fading upward through the rays.
  float edge = smoothstep(-0.06, 0.02, vH) * exp(-h * 9.0);
  float body = rays * (1.0 - h) * (1.0 - h);
  // Green at the foot, teal then violet higher up; a slow pink drift along the length.
  vec3 col = mix(vec3(0.25, 1.0, 0.55), vec3(0.2, 0.75, 1.0), smoothstep(0.1, 0.5, h));
  col = mix(col, vec3(0.75, 0.35, 1.0), smoothstep(0.45, 1.0, h));
  col = mix(col, vec3(1.0, 0.45, 0.8), 0.3 * smoothstep(0.6, 1.0, sin(vAlong * 0.03 + t * 0.2)) * smoothstep(0.3, 0.8, h));
  float life = smoothstep(0.0, 0.6, vAge) * (1.0 - smoothstep(uLife, uLife + uFade, vAge));
  float a = (edge * 1.2 + body * 0.75) * life;
  // Daylight drowns an aurora: kept, but fainter.
  a *= 1.0 - 0.45 * uDayLight;
  if (a < 0.004) discard;
  gl_FragColor = fireBlend(col * 1.4, clamp(a, 0.0, 1.0), uDayLight);
}
`;

/**
 * Dải Lụa Cực Quang's curtains: while the skill lasts, an aurora unfurls up from each wingtip
 * along the flight path and hangs there, folding and shimmering, for AURORA_LIFE seconds.
 * Additive light (glowing at night, softer by day), drawn from both sides, no depth writes.
 * `near` tells whether a point flies along one (the aurora's wind carries the manta).
 */
export class AuroraTrail {
  readonly mesh: THREE.Mesh;
  readonly ribbon: TrailRibbon;
  private lastBirth = -1e9;
  private readonly motion = { value: 1 };

  constructor(shared: SharedUniforms) {
    this.ribbon = new TrailRibbon(POINTS, PROFILE);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uHeight: { value: HEIGHT },
        uLife: { value: AURORA_LIFE },
        uFade: { value: AURORA_FADE },
        uMotion: this.motion,
        uDayLight: shared.uDayLight,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...FIRE_BLENDING,
    });
    this.mesh = new THREE.Mesh(this.ribbon.geometry, mat);
    this.mesh.name = 'aurora-trail';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
  }

  /** Reduced motion: the folds and rays nearly stand still. */
  setMotion(full: boolean): void {
    this.motion.value = full ? 1 : 0.1;
  }

  /** A point of the path (the manta's middle) with its side vector, now. */
  add(x: number, y: number, z: number, sx: number, sz: number, now: number): void {
    this.ribbon.push(x, y, z, sx, sz, now);
    this.lastBirth = now;
    this.mesh.visible = true;
  }

  cut(): void {
    this.ribbon.cut();
  }

  update(now: number): void {
    if (this.mesh.visible && now - this.lastBirth > AURORA_LIFE + AURORA_FADE) {
      this.ribbon.clear();
      this.mesh.visible = false;
    }
  }

  /**
   * Flying along a curtain at least `minAge` s old: within `reach` m of its path sideways and
   * a few metres in height (its wind lies between the two curtains and along them).
   */
  near(x: number, y: number, z: number, now: number, minAge: number, reach: number): boolean {
    if (!this.mesh.visible) return false;
    const r = this.ribbon;
    for (let i = 0; i < r.max; i++) {
      if (!r.linked[i]) continue;
      const j = r.prev(i);
      const age = now - r.born[i];
      if (age < minAge || age > AURORA_LIFE) continue;
      if (Math.abs(y - r.cy[i]) > 5) continue;
      if (segmentDistance(x, z, r.cx[j], r.cz[j], r.cx[i], r.cz[i]) < reach) return true;
    }
    return false;
  }

  dispose(): void {
    this.ribbon.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
