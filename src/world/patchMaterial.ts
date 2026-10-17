import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';

/**
 * One place where weather touches the world's materials. `onBeforeCompile` splices GLSL into
 * three's MeshStandardMaterial at known `#include` points, keeping all of three's lighting and
 * shadows. Chunk names are checked against three 0.186.1 (pinned in package.json).
 *
 * - sway: vertex displacement by wind (palms, grass) — done on the GPU, zero per-object JS.
 * - wet: rain darkens and glosses surfaces; optional puddles on flat ground.
 * - snow: settled snow whitens upward-facing surfaces.
 * - caustics: underwater light patterns from the water system.
 */

export interface CausticsUniforms {
  uCaustics: { value: THREE.Texture | null };
  uCausticsSize: { value: number };
  uCausticsOn: { value: number };
  uSunColor: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
}

export interface WorldMaterialFeatures {
  /** 'palm' bends with height (+ leaf flutter if the geometry has `aTip`); 'grass' bends per blade. */
  sway?: 'palm' | 'grass';
  /** Geometry has an `aTip` attribute (0 at the frond base … 1 at the tip). */
  tip?: boolean;
  wet?: boolean;
  /** How much rain darkens the surface (sand 1, wood 0.7, leaves 0.4). */
  porosity?: number;
  puddles?: boolean;
  snow?: boolean;
  /** Double-sided foliage: snow settles on either face. */
  twoSided?: boolean;
  caustics?: CausticsUniforms;
}

type Uniforms = Record<string, THREE.IUniform>;

const SWAY_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uGust;
uniform vec2 uWindDir;
#ifdef HAS_TIP
attribute float aTip;
#endif

// World-space wind displacement. 'local' is the vertex in object space (before instancing),
// 'origin' the instance position (used as a per-plant phase so plants don't move in lockstep).
vec3 windOffset(vec3 local, vec3 origin) {
  vec3 dir = vec3(uWindDir.x, 0.0, uWindDir.y);
  float phase = dot(origin.xz, vec2(0.37, 0.71));
#if defined(SWAY_PALM)
  // Trunk bends quadratically with height (≈ cantilever beam), plus a slow idle sway.
  float h = max(local.y, 0.0) * 0.1;
  float sway = uGust * 0.9 + sin(uTime * 1.1 + phase) * (0.1 + 0.25 * uWind);
  vec3 off = dir * sway * h * h;
  #ifdef HAS_TIP
    float flutter = sin(uTime * (4.5 + uWind * 4.0) + phase * 3.0 + local.x * 1.7 + local.z * 1.3);
    off += dir * aTip * aTip * (0.3 * uGust + 0.04);
    off.y += flutter * aTip * (0.04 + 0.2 * uGust);
  #endif
  return off;
#elif defined(SWAY_GRASS)
  float tip = clamp(local.y / 0.6, 0.0, 1.0);
  float s = uGust * 0.35 + sin(uTime * 2.3 + phase * 2.0) * (0.04 + 0.1 * uWind);
  vec3 off = dir * s * tip * tip;
  off.y -= abs(s) * tip * tip * 0.3;
  return off;
#else
  return vec3(0.0);
#endif
}
`;

const PROJECT_GLSL = /* glsl */ `
vec4 wPos = vec4(transformed, 1.0);
vec3 swayOrigin = vec3(0.0);
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
  swayOrigin = instanceMatrix[3].xyz;
#endif
wPos = modelMatrix * wPos;
#ifdef WORLD_SWAY
  wPos.xyz += windOffset(transformed, swayOrigin);
#endif
#ifdef WORLD_VARYINGS
  vWorldPosW = wPos.xyz;
#endif
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

const FRAG_PARS = /* glsl */ `
uniform float uWetness;
uniform float uSnowCover;
uniform float uPorosity;
varying vec3 vWorldPosW;
varying vec3 vWorldNormalW;
#ifdef WORLD_CAUSTICS
uniform sampler2D uCaustics;
uniform float uCausticsSize;
uniform float uCausticsOn;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
#endif

float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const SURFACE_GLSL = /* glsl */ `
{
  vec3 wn = normalize(vWorldNormalW);
#ifdef SNOW_TWO_SIDED
  float up = abs(wn.y);
#else
  float up = wn.y;
#endif
  float aboveWater = smoothstep(-0.05, 0.12, vWorldPosW.y);
#ifdef WORLD_WET
  float wet = uWetness * aboveWater * (0.6 + 0.4 * clamp(up, 0.0, 1.0));
  diffuseColor.rgb *= 1.0 - 0.35 * wet * uPorosity;
  roughnessFactor = mix(roughnessFactor, 0.35, wet);
  #ifdef WORLD_PUDDLES
    float puddle = smoothstep(0.55, 0.75, wNoise(vWorldPosW.xz * 0.35)) * smoothstep(0.97, 0.995, up) * uWetness * aboveWater;
    diffuseColor.rgb *= 1.0 - 0.3 * puddle;
    roughnessFactor = mix(roughnessFactor, 0.05, puddle);
  #endif
#endif
#ifdef WORLD_SNOW
  // Noise only ever subtracts, so zero snow cover means no white at all; partial cover
  // starts as patches in the noise "hollows" and fills in as it grows.
  float sn = wNoise(vWorldPosW.xz * 1.3) + 0.5 * wNoise(vWorldPosW.xz * 4.1);
  float cover = smoothstep(0.0, 0.3, uSnowCover * 1.25 - (1.0 - up) * 1.6 - (1.5 - sn) * 0.55);
  cover *= smoothstep(0.02, 0.2, vWorldPosW.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), cover);
  roughnessFactor = mix(roughnessFactor, 0.85, cover);
#endif
}
`;

const CAUSTICS_GLSL = /* glsl */ `
#ifdef WORLD_CAUSTICS
if (uCausticsOn > 0.5 && vWorldPosW.y < 0.0) {
  vec2 cuv = vWorldPosW.xz / uCausticsSize + 0.5;
  if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) {
    float c = texture2D(uCaustics, cuv).r;
    float d = -vWorldPosW.y;
    // Fade in just below the waterline, fade out with depth (light gets absorbed).
    float fade = smoothstep(0.0, 0.3, d) * exp(-d * 0.28) * max(uSunDir.y, 0.0);
    totalEmissiveRadiance += diffuseColor.rgb * uSunColor * max(c - 0.75, 0.0) * 1.1 * fade;
  }
}
#endif
`;

function defines(f: WorldMaterialFeatures): string[] {
  const d: string[] = ['WORLD_VARYINGS'];
  if (f.sway) d.push('WORLD_SWAY', f.sway === 'palm' ? 'SWAY_PALM' : 'SWAY_GRASS');
  if (f.tip) d.push('HAS_TIP');
  if (f.wet) d.push('WORLD_WET');
  if (f.puddles) d.push('WORLD_PUDDLES');
  if (f.snow) d.push('WORLD_SNOW');
  if (f.twoSided) d.push('SNOW_TWO_SIDED');
  if (f.caustics) d.push('WORLD_CAUSTICS');
  return d;
}

function header(d: string[]): string {
  return d.map((x) => `#define ${x}`).join('\n') + '\n';
}

/** Patches a MeshStandardMaterial with the requested weather features. */
export function patchWorldMaterial(
  material: THREE.MeshStandardMaterial,
  features: WorldMaterialFeatures,
  shared: SharedUniforms,
): void {
  const d = defines(features);
  const uniforms: Uniforms = {
    uTime: shared.uTime,
    uWind: shared.uWind,
    uGust: shared.uGust,
    uWindDir: shared.uWindDir,
    uWetness: shared.uWetness,
    uSnowCover: shared.uSnowCover,
    uPorosity: { value: features.porosity ?? 1 },
    ...(features.caustics ?? {}),
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader =
      header(d) +
      shader.vertexShader
        .replace(
          'void main() {',
          `${SWAY_GLSL}\nvarying vec3 vWorldPosW;\nvarying vec3 vWorldNormalW;\nvoid main() {`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          {
            vec3 wn = objectNormal;
            #ifdef USE_INSTANCING
              wn = mat3(instanceMatrix) * wn;
            #endif
            vWorldNormalW = normalize(mat3(modelMatrix) * wn);
          }`,
        )
        .replace('#include <project_vertex>', PROJECT_GLSL);
    shader.fragmentShader =
      header(d) +
      shader.fragmentShader
        .replace('void main() {', `${FRAG_PARS}\nvoid main() {`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${SURFACE_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${CAUSTICS_GLSL}`);
  };
  material.customProgramCacheKey = () => `world:${d.join(',')}`;
}

/**
 * Depth material for shadow casting that sways like the visible mesh, so shadows of palms
 * and grass move with the wind instead of staying frozen.
 */
export function createSwayDepthMaterial(
  features: Pick<WorldMaterialFeatures, 'sway' | 'tip'>,
  shared: SharedUniforms,
): THREE.MeshDepthMaterial {
  const d = defines({ sway: features.sway, tip: features.tip }).filter((x) => x !== 'WORLD_VARYINGS');
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: shared.uTime,
      uWind: shared.uWind,
      uGust: shared.uGust,
      uWindDir: shared.uWindDir,
    });
    shader.vertexShader =
      header(d) +
      shader.vertexShader.replace('void main() {', `${SWAY_GLSL}\nvoid main() {`).replace('#include <project_vertex>', PROJECT_GLSL);
  };
  m.customProgramCacheKey = () => `world-depth:${d.join(',')}`;
  return m;
}
