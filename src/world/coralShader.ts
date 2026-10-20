import type * as THREE from 'three';

/**
 * Surface detail for the reef, painted in the fragment shader from the object-space position
 * (so it's the same on every copy, scaled with it, and costs no textures):
 *
 * - brain: meandering ridges and dark valleys;
 * - staghorn: pale growing tips, tiny polyp pits;
 * - table: radial growth lines, a pale rim, a dark underside;
 * - fan: a lattice of holes (discarded pixels), so it is a net, not a plate;
 * - tube: growth rings, a dark inside;
 * - anemone / soft coral: pale tentacle tips;
 * - bommie (the reef rock): crusts of pink and green coralline algae, dark crevices.
 *
 * Every kind also gets a darker base (light is blocked low down) and, for the soft ones, a
 * sway in the vertex shader (the swell moving them).
 */
export const CoralKind = {
  brain: 1,
  staghorn: 2,
  table: 3,
  fan: 4,
  tube: 5,
  star: 6,
  urchin: 7,
  anemone: 8,
  soft: 9,
  bommie: 10,
  seagrass: 11,
} as const;
export type CoralKind = (typeof CoralKind)[keyof typeof CoralKind];

const VERT_PARS = /* glsl */ `
varying vec3 vCoral;
`;

const VERT = /* glsl */ `
vCoral = position;
#ifdef CORAL_SWAY
{
  vec3 ip = vec3(instanceMatrix[3]);
  float ph = ip.x * 0.9 + ip.z * 0.7;
  float k = max(transformed.y, 0.0);
  float bend = k * k;
  transformed.x += sin(uTime * 1.1 + ph + transformed.y * 3.0) * CORAL_SWAY * bend;
  transformed.z += cos(uTime * 0.8 + ph * 1.3 + transformed.y * 2.0) * CORAL_SWAY * 0.6 * bend;
}
#endif
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vCoral;
float cHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float cNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cHash(i), cHash(i + vec3(1, 0, 0)), f.x), mix(cHash(i + vec3(0, 1, 0)), cHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(cHash(i + vec3(0, 0, 1)), cHash(i + vec3(1, 0, 1)), f.x), mix(cHash(i + vec3(0, 1, 1)), cHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Distance to the nearest random point (cells).
float cCell(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 1.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 o = vec3(float(x), float(y), float(z));
        vec3 r = o + vec3(cHash(i + o), cHash(i + o + 7.7), cHash(i + o + 3.3)) - f;
        d = min(d, dot(r, r));
      }
  return sqrt(d);
}
`;

const FRAG = /* glsl */ `
{
  vec3 p = vCoral;
  vec3 col = diffuseColor.rgb;
  // Low down, less light gets in.
  col *= mix(0.55, 1.0, smoothstep(-0.02, 0.3, p.y));
#if CORAL_KIND == 1
  // Meanders: a warped noise sliced into thin bands.
  float w = cNoise(p * 7.0) * 2.0;
  float band = abs(sin((cNoise(p * 4.0 + w) * 6.0 + p.y * 3.0) * 6.2831));
  col *= mix(0.45, 1.12, smoothstep(0.15, 0.7, band));
  col = mix(col, col * vec3(1.15, 1.05, 0.8), smoothstep(0.85, 1.0, band) * 0.5);
#elif CORAL_KIND == 2
  float tip = smoothstep(0.45, 0.95, p.y);
  col = mix(col, vec3(0.93, 0.9, 0.82), tip * 0.65);
  col *= mix(0.75, 1.0, smoothstep(0.08, 0.2, cCell(p * 45.0)));
#elif CORAL_KIND == 3
  float r = length(p.xz);
  float a = atan(p.z, p.x);
  col *= 0.86 + 0.14 * sin(a * 70.0 + cNoise(p * 12.0) * 4.0);
  col = mix(col, col * 1.35 + 0.05, smoothstep(0.48, 0.6, r));
  // The plate's underside (its bottom face sits at y ≈ 0.39) stays in shade.
  col *= mix(1.0, 0.45, step(p.y, 0.41) * step(0.3, p.y) * step(0.12, r));
#elif CORAL_KIND == 4
  // A net: a hole around every cell point, thin veins left along the cell borders; the
  // main veins (radiating from the stem) stay solid.
  float holes = cCell(vec3(p.xy * 24.0, 0.0));
  float rib = abs(fract(atan(p.y, p.x) * 2.5) - 0.5);
  if (holes < 0.5 && rib > 0.05 && length(p.xy) > 0.07) discard;
  col *= mix(0.8, 1.1, smoothstep(0.5, 0.7, holes));
#elif CORAL_KIND == 5
  col *= 0.8 + 0.2 * smoothstep(0.3, 0.7, fract(p.y * 16.0 + cNoise(p * 10.0)));
  if (!gl_FrontFacing) col *= 0.35;
#elif CORAL_KIND == 6
  col *= 0.8 + 0.35 * (1.0 - smoothstep(0.05, 0.12, cCell(p * 60.0)));
#elif CORAL_KIND == 8 || CORAL_KIND == 9
  float tip = smoothstep(0.25, 0.65, p.y);
  col = mix(col, vec3(0.97, 0.94, 0.9), tip * 0.55);
#elif CORAL_KIND == 10
  // Reef rock: grey-brown, crusted with pink and green coralline algae, dark cracks.
  vec3 q = p * vec3(1.0, 2.0, 1.0);
  float n = cNoise(q * 9.0) * 0.55 + cNoise(q * 23.0) * 0.45;
  vec3 pink = vec3(0.72, 0.42, 0.5);
  vec3 green = vec3(0.4, 0.52, 0.32);
  col *= 0.75 + 0.4 * cNoise(q * 40.0);
  // Crusts: soft-edged, only partly covering, so the rock still reads as rock.
  col = mix(col, pink, smoothstep(0.55, 0.8, n) * 0.45);
  col = mix(col, green, smoothstep(0.6, 0.85, cNoise(q * 12.0 + 13.0)) * 0.35);
  // Pits and cracks.
  col *= mix(0.45, 1.0, smoothstep(0.04, 0.14, cCell(q * 16.0)));
#elif CORAL_KIND == 11
  col = mix(col * 0.7, col * 1.25, smoothstep(0.0, 1.0, p.y));
#endif
  diffuseColor.rgb = col;
}
`;

/**
 * Adds the coral detail on top of a material already patched by `patchWorldMaterial`
 * (wet look, caustics...): wraps its `onBeforeCompile`. `sway` (m): how far the top moves.
 */
export function addCoralDetail(material: THREE.MeshStandardMaterial, kind: CoralKind, sway = 0): void {
  const base = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer);
    const defs = `#define CORAL_KIND ${kind}\n${sway > 0 ? `#define CORAL_SWAY ${sway.toFixed(3)}\n` : ''}`;
    shader.vertexShader = defs + shader.vertexShader
      .replace('void main() {', `${VERT_PARS}\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT}`);
    shader.fragmentShader = defs + shader.fragmentShader
      .replace('void main() {', `${FRAG_PARS}\nvoid main() {`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`);
  };
  material.customProgramCacheKey = () => `${baseKey}:coral${kind}:${sway}`;
}
