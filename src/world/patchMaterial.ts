import * as THREE from 'three';
import type { SharedUniforms } from '../core/uniforms';
import clouds from './shaders/clouds.glsl?raw';
import swash from '../water/shaders/swash.glsl?raw';

/**
 * One place where weather touches the world's materials. `onBeforeCompile` splices GLSL into
 * three's MeshStandardMaterial at known `#include` points, keeping all of three's lighting and
 * shadows. Chunk names are checked against three 0.186.1 (pinned in package.json).
 *
 * - sway: vertex displacement by wind (palms, grass) — done on the GPU, zero per-object JS.
 * - wet: rain darkens and glosses surfaces; optional puddles on flat ground.
 * - snow: settled snow whitens upward-facing surfaces.
 * - caustics: underwater light patterns from the water system.
 * - ground: procedural detail for the terrain (no textures).
 */

export interface CausticsUniforms {
  uCaustics: { value: THREE.Texture | null };
  uCausticsSize: { value: number };
  uCausticsOn: { value: number };
  uSunColor: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
}

export interface WorldMaterialFeatures {
  /**
   * 'plant': bends by the geometry's `aSway` attribute and flutters by `aTip` (see
   * vegetation/plantBuilder.ts); 'grass': bends per blade by height.
   */
  sway?: 'plant' | 'grass';
  wet?: boolean;
  /** How much rain darkens the surface (sand 1, wood 0.7, leaves 0.4). */
  porosity?: number;
  puddles?: boolean;
  snow?: boolean;
  /** Double-sided foliage: snow settles on either face. */
  twoSided?: boolean;
  /** Stays dry and snow-free under the house roof (see uShelter). */
  sheltered?: boolean;
  /**
   * Terrain: blends the per-vertex sand and land colors with ragged, noise-driven edges, adds
   * sand grain/ripples and mottled grass, and a wet band that follows the surf up the beach.
   * Needs the `aSandColor` and `aGrass` attributes (see terrain.ts).
   */
  ground?: boolean;
  /** Rocks: triplanar grain, cracks, lichen and a wet band above the sea (no textures). */
  stone?: boolean;
  /** House wood: grain lines along the boards (axes from the house frame in uShelter). */
  wood?: boolean;
  caustics?: CausticsUniforms;
}

type Uniforms = Record<string, THREE.IUniform>;

const SWAY_GLSL = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uGust;
uniform vec2 uWindDir;
#ifdef SWAY_PLANT
attribute float aSway;
attribute float aTip;
#endif

// World-space wind displacement. 'local' is the vertex in object space (before instancing),
// 'origin' the instance position (used as a per-plant phase so plants don't move in lockstep).
vec3 windOffset(vec3 local, vec3 origin) {
  vec3 dir = vec3(uWindDir.x, 0.0, uWindDir.y);
  float phase = dot(origin.xz, vec2(0.37, 0.71));
#if defined(SWAY_PLANT)
  // aSway was baked per vertex (≈ quadratic with height, scaled by how flexible the species
  // is), so a stiff giant and a soft banana use the same code. Plus a slow idle sway.
  float sway = uGust * 0.9 + sin(uTime * 1.1 + phase) * (0.1 + 0.25 * uWind);
  vec3 off = dir * sway * aSway;
  // Leaves flutter on top of the bend, strongest at their tips.
  float flutter = sin(uTime * (4.5 + uWind * 4.0) + phase * 3.0 + local.x * 1.7 + local.z * 1.3);
  off += dir * aTip * aTip * (0.3 * uGust + 0.04);
  off.y += flutter * aTip * (0.04 + 0.2 * uGust);
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
  // Cloud shadow is evaluated per vertex: shadows are ~100 m across, so this is plenty of
  // detail, and it avoids running the cloud noise for every (overdrawn) leaf pixel.
  vCloudShadow = cloudShadow(wPos.xz, uSunDir);
#endif
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

const GROUND_VERT_PARS = /* glsl */ `
#ifdef WORLD_GROUND
attribute vec3 aSandColor;
attribute float aGrass;
varying vec3 vSandColor;
varying float vGrass;
#endif
`;

const GROUND_VERT = /* glsl */ `
#ifdef WORLD_GROUND
  vSandColor = aSandColor;
  vGrass = aGrass;
#endif
`;

const FRAG_PARS = /* glsl */ `
uniform float uWetness;
uniform float uSnowCover;
uniform float uPorosity;
uniform vec3 uSunDir;
uniform float uDayLight;
uniform float uNight;
uniform vec4 uShelter;
uniform vec4 uShelterSize;
#ifdef WORLD_GROUND
uniform float uTime;
uniform float uWaveStrength;
varying vec3 vSandColor;
varying float vGrass;
#endif
varying vec3 vWorldPosW;
varying vec3 vWorldNormalW;
varying float vCloudShadow;
#ifdef WORLD_CAUSTICS
uniform sampler2D uCaustics;
uniform float uCausticsSize;
uniform float uCausticsOn;
uniform vec3 uSunColor;
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

const STONE_FRAG_FNS = /* glsl */ `
#ifdef WORLD_STONE
// World-space noise seen from the three axes, blended by the normal weights 'w'.
float triNoise(vec3 p, vec3 w, float s) {
  return wNoise(p.yz * s) * w.x + wNoise(p.xz * s + 17.0) * w.y + wNoise(p.xy * s - 31.0) * w.z;
}
#endif
`;

const GROUND_FRAG_FNS = /* glsl */ `
#ifdef WORLD_GROUND
${swash}
// Round specks scattered on a grid: one in each cell whose random value exceeds 'rarity',
// at a random spot and size inside the cell (so the grid never shows). 'id' returns the value.
float speck(vec2 p, float rarity, out float id) {
  vec2 c = floor(p);
  id = wHash(c);
  vec2 center = 0.25 + 0.5 * vec2(wHash(c + 5.3), wHash(c + 9.1));
  float r = 0.08 + 0.14 * wHash(c + 2.7);
  return (1.0 - smoothstep(r * 0.6, r, length(fract(p) - center))) * step(rarity, id);
}
#endif
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
#ifdef WORLD_GROUND
  {
    vec2 gp = vWorldPosW.xz;
    // Three octaves of world-space noise: patches (2 m), tufts (60 cm), grain (15 cm).
    float n1 = wNoise(gp * 0.45);
    float n2 = wNoise(gp * 1.7 + 11.0);
    float n3 = wNoise(gp * 6.3 - 7.0);
    // Ragged sand/grass edge: noise pushes the blend weight around, then it is sharpened, so
    // grass reaches onto the sand in tufts and sand shows through in bare patches.
    float edge = n1 * 0.5 + n2 * 0.33 + n3 * 0.17;
    float g = smoothstep(0.4, 0.6, vGrass + (edge - 0.5) * 0.9);
    // Sand: fine grain and soft wind ripples (bent by the noise so they never look ruled).
    float grain = 0.93 + 0.05 * n3 + 0.06 * wNoise(gp * 14.0);
    float ripple = sin(dot(gp, vec2(2.3, 1.2)) * 2.2 + n1 * 6.0) * 0.03 * smoothstep(0.35, 1.5, vWorldPosW.y);
    // Close-up detail fades out with distance (it would only shimmer far away).
    float fine = 1.0 - smoothstep(8.0, 45.0, length(cameraPosition - vWorldPosW));
    // Fine grain plus scattered pebbles (darker) and shell bits (lighter), ~8 cm cells.
    grain += (wNoise(gp * 38.0) - 0.5) * 0.12 * fine;
    float bit;
    float dotMask = speck(gp * 12.0, 0.965, bit) * fine;
    vec3 sand = vSandColor * (grain + ripple) * (1.0 + dotMask * (bit > 0.983 ? 0.18 : -0.3));
    // Land: lighter and darker patches and tufts on top of the per-vertex color.
    vec3 land = diffuseColor.rgb * (0.82 + 0.3 * n2) * (0.94 + 0.12 * n3);
    land = mix(land, land * vec3(1.08, 1.04, 0.86), smoothstep(0.55, 0.8, n1) * 0.5);
    // Close up: blade-like streaks (stretched noise, direction varying by patch) and soil specks.
    // (Two fixed directions blended by patch: rotating the coordinates instead would swirl.)
    float bladesA = wNoise(gp * vec2(30.0, 4.0)) * 0.6 + wNoise(gp * vec2(55.0, 7.0) + 3.0) * 0.4;
    float bladesB = wNoise(gp * vec2(4.0, 30.0) + 9.0) * 0.6 + wNoise(gp * vec2(7.0, 55.0) - 3.0) * 0.4;
    float blades = mix(bladesA, bladesB, smoothstep(0.3, 0.7, n1));
    land *= 1.0 + (blades - 0.5) * 0.35 * fine;
    float soil;
    land *= 1.0 - 0.3 * speck(gp * 7.0 + 31.0, 0.94, soil) * fine;
    diffuseColor.rgb = mix(sand, land, g);

    // Wet sand from the swash (same function as the water surface): dark up to where the last
    // wave reached, with a ragged edge, and glossy right behind the draining water.
    vec3 sw = swash(gp, uTime, uWaveStrength);
    float y = vWorldPosW.y + (n2 - 0.5) * 0.03;
    // (Sand under the water is wet too: no cut-off, or the seabed would show a hard line.)
    float wet = smoothstep(sw.y + 0.05, sw.y - 0.01, y) * (1.0 - g);
    float fresh = (1.0 - smoothstep(sw.x, sw.x + 0.06, y)) * smoothstep(-0.4, 0.0, y) * wet;
    diffuseColor.rgb *= 1.0 - 0.25 * wet - 0.08 * fresh;
    roughnessFactor = mix(roughnessFactor, mix(0.4, 0.12, fresh), wet);
  }
#endif
#ifdef WORLD_STONE
  {
    // Rock grain, projected from three sides and blended by the normal ("triplanar"), so it
    // never stretches on steep faces. Big blotches, grain, then fine speckle up close.
    vec3 tw = abs(wn);
    tw /= tw.x + tw.y + tw.z;
    vec3 sp = vWorldPosW;
    float b1 = triNoise(sp, tw, 1.6);
    float b2 = triNoise(sp, tw, 5.5);
    float b3 = triNoise(sp, tw, 17.0);
    float near = 1.0 - smoothstep(10.0, 50.0, length(cameraPosition - sp));
    diffuseColor.rgb *= 0.75 + 0.4 * b1 + 0.32 * (b2 - 0.5) + 0.3 * (b3 - 0.5) * near;
    // Dark cracks where the mid-scale noise dips.
    diffuseColor.rgb *= 1.0 - 0.35 * (1.0 - smoothstep(0.12, 0.26, b2));
    // Small, muted lichen flecks on faces that look up; a darker, wetter band at the waterline.
    float lichen = smoothstep(0.76, 0.8, triNoise(sp + 3.7, tw, 11.0)) * smoothstep(0.2, 0.7, wn.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.72, 0.6), lichen * 0.3);
    float splash = 1.0 - smoothstep(0.02, 0.25, sp.y);
    diffuseColor.rgb *= 1.0 - 0.3 * splash;
    roughnessFactor = mix(roughnessFactor, 0.45, splash);
  }
#endif
#ifdef WORLD_WOOD
  {
    // Wood grain without textures: noise stretched along the boards. Boards run along the
    // house's local x on floors and tabletops, and upward on walls, posts and legs. The house
    // axes come from the shelter frame (uShelter.zw = cos, sin of the house rotation).
    vec2 rel = vWorldPosW.xz - uShelter.xy;
    vec2 lxz = vec2(rel.x * uShelter.z - rel.y * uShelter.w, rel.x * uShelter.w + rel.y * uShelter.z);
    vec2 nxz = vec2(wn.x * uShelter.z - wn.z * uShelter.w, wn.x * uShelter.w + wn.z * uShelter.z);
    float across = abs(nxz.x) > abs(nxz.y) ? lxz.y : lxz.x;
    // gp.x runs along the grain, gp.y across it (in metres × frequency).
    vec2 gp = abs(wn.y) > 0.6 ? vec2(lxz.x, lxz.y) : vec2(vWorldPosW.y, across);
    float warp = wNoise(gp * vec2(1.2, 9.0)) * 4.0;
    // Grain lines about 6 mm apart, wavy along the board; finer fibres; soft large blotches.
    float lines = 0.5 + 0.5 * sin(gp.y * 160.0 + warp);
    lines = smoothstep(0.35, 1.0, lines);
    float fine = wNoise(gp * vec2(6.0, 420.0));
    float blotch = wNoise(gp * vec2(0.9, 3.0) + 9.1);
    float near = 1.0 - smoothstep(3.0, 18.0, length(cameraPosition - vWorldPosW));
    diffuseColor.rgb *= 1.0 - near * (0.05 * lines + 0.05 * (fine - 0.5)) + 0.08 * (blotch - 0.5);
  }
#endif
#ifdef WORLD_SHELTER
  // Under the roof (floor, porch, furniture): no rain or snow reaches it.
  vec2 shd = vWorldPosW.xz - uShelter.xy;
  vec2 shl = vec2(shd.x * uShelter.z - shd.y * uShelter.w, shd.x * uShelter.w + shd.y * uShelter.z);
  aboveWater *= 1.0 - step(abs(shl.x), uShelterSize.x) * step(abs(shl.y), uShelterSize.y) * step(vWorldPosW.y, uShelterSize.z);
#endif
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
#ifdef WORLD_SHELTER
  cover *= aboveWater;
#endif
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.93, 0.97), cover);
  roughnessFactor = mix(roughnessFactor, 0.85, cover);
#endif
  // Cloud shadows drifting over the island (computed per vertex, see PROJECT_GLSL).
  diffuseColor.rgb *= 1.0 - 0.6 * vCloudShadow;
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
  if (f.sway) d.push('WORLD_SWAY', f.sway === 'plant' ? 'SWAY_PLANT' : 'SWAY_GRASS');
  if (f.wet) d.push('WORLD_WET');
  if (f.puddles) d.push('WORLD_PUDDLES');
  if (f.snow) d.push('WORLD_SNOW');
  if (f.twoSided) d.push('SNOW_TWO_SIDED');
  if (f.caustics) d.push('WORLD_CAUSTICS');
  if (f.sheltered) d.push('WORLD_SHELTER');
  if (f.ground) d.push('WORLD_GROUND');
  if (f.stone) d.push('WORLD_STONE');
  if (f.wood) d.push('WORLD_WOOD');
  return d;
}

/**
 * Night vision (the Purkinje shift): in dim light the eye sees with rods, which see no color
 * and are most sensitive to blue-green. So at night, dark surfaces lose their color and lean
 * toward a cool blue-grey of the same brightness; bright things (lamps, lit windows) keep
 * theirs. Runs on the final linear color, before tone mapping.
 */
const NIGHT_VISION_GLSL = /* glsl */ `
{
  float lum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float rods = uNight * (1.0 - smoothstep(0.02, 0.2, lum)) * 0.65;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.78, 0.92, 1.18) * lum, rods);
}
`;

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
    uSunDir: shared.uSunDir,
    uDayLight: shared.uDayLight,
    uNight: shared.uNight,
    uCloudCover: shared.uCloudCover,
    uCloudOffset: shared.uCloudOffset,
    uShelter: shared.uShelter,
    uShelterSize: shared.uShelterSize,
    uWaveStrength: shared.uWaveStrength,
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
          `${SWAY_GLSL}\n${clouds}\n${GROUND_VERT_PARS}\nuniform vec3 uSunDir;\nvarying vec3 vWorldPosW;\nvarying vec3 vWorldNormalW;\nvarying float vCloudShadow;\nvoid main() {`,
        )
        .replace('#include <color_vertex>', `#include <color_vertex>\n${GROUND_VERT}`)
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
        .replace('void main() {', `${FRAG_PARS}\n${GROUND_FRAG_FNS}\n${STONE_FRAG_FNS}\nvoid main() {`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${SURFACE_GLSL}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${CAUSTICS_GLSL}`)
        .replace('#include <tonemapping_fragment>', `${NIGHT_VISION_GLSL}\n#include <tonemapping_fragment>`);
  };
  material.customProgramCacheKey = () => `world:${d.join(',')}`;
}

/**
 * Depth material for shadow casting that sways like the visible mesh, so shadows of palms
 * and grass move with the wind instead of staying frozen.
 */
export function createSwayDepthMaterial(
  features: Pick<WorldMaterialFeatures, 'sway'>,
  shared: SharedUniforms,
): THREE.MeshDepthMaterial {
  const d = defines({ sway: features.sway }).filter((x) => x !== 'WORLD_VARYINGS');
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
