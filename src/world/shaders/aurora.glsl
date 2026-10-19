// Aurora, shared by the sky dome and the sea's reflection (water.frag defines AURORA_LAYERS 1
// for a cheaper version). Self-contained: own noise, time passed in.
//
// The aurora is a ribbon (two in the sky): its lower edge is a wavy line along the horizon,
// and light streams up from it in vertical rays. Motion, from slow to fast:
//   1. sway   (~40 s): the ribbon's height drifts, so the edge bends into slow S-curves;
//   2. folds  (~7 s):  folds travel along the ribbon; where it folds toward you it is brighter
//                      and its edge dips, like a curtain rippling in the wind;
//   3. rays   (1–3 s): thin streaks slide sideways and flicker;
//   4. surges (~30 s): now and then a wave of brightness runs along the ribbon.
// Every angle along the horizon goes through cos/sin (noise sampled on a circle) or a whole
// multiple of it, so nothing has a seam all the way round.

#ifndef AURORA_LAYERS
#define AURORA_LAYERS 2
#endif

uniform float uAurora;
/** Where the desk window looks: azimuth atan(x, −z), radians. */
uniform float uAuroraAz;
/** 1 = full motion; small under prefers-reduced-motion (rays and folds nearly still). */
uniform float uAuroraMotion;

float auHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float auNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(auHash(i), auHash(i + vec2(1.0, 0.0)), u.x), mix(auHash(i + vec2(0.0, 1.0)), auHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

/** Wraps an angle to (−π, π]. */
float auWrap(float a) {
  return atan(sin(a), cos(a));
}

/** A brightness wave sweeping across the arc centred at `center`, once every `period` s. */
float auSurge(float a, float center, float t, float period, float offset) {
  float phase = fract(t / period + offset);
  float pos = center - 1.4 + 2.8 * phase;
  float d = auWrap(a - pos);
  return sin(3.14159 * phase) * exp(-d * d * 5.0);
}

/** Aurora light seen in direction `dir` at time `t` (unscaled; multiply by uAurora). */
vec3 aurora(vec3 dir, float t) {
  if (uAurora <= 0.001 || dir.y <= 0.0) return vec3(0.0);
  float a = atan(dir.x, -dir.z);
  vec2 cs = vec2(cos(a), sin(a));
  // Two bright arcs (a tropical aurora is make-believe anyway): over the sea in front of the
  // desk window and toward north (−Z), where the overview camera looks; a faint glow elsewhere.
  float rel = auWrap(a - uAuroraAz);
  float arcs = 0.15 + 0.85 * max(exp(-rel * rel * 0.7), 0.85 * exp(-a * a * 0.8));
  float tf = t * uAuroraMotion;

  vec3 acc = vec3(0.0);
  for (int i = 0; i < AURORA_LAYERS; i++) {
    float fi = float(i);
    vec2 seed = vec2(17.3, 5.1) * (fi + 1.0);
    // 1. Sway.
    float sway = auNoise(cs * 1.3 + seed + vec2(t * 0.025, -t * 0.018));
    // 2. Folds, bent by noise so they never look like a plain sine.
    float warp = auNoise(cs * 2.2 + seed.yx + vec2(0.0, t * 0.04)) * 4.0;
    float fold = sin(a * (9.0 + fi * 4.0) - tf * (0.9 - fi * 0.25) + warp);
    float base = 0.075 + 0.07 * fi + 0.09 * (sway - 0.5) - 0.018 * fold;
    float hgt = dir.y - base;
    if (hgt < -0.2) continue;
    float folds = 0.35 + 0.65 * pow(0.5 + 0.5 * fold, 2.0);
    // 3. Rays sliding sideways and flickering; each is a different height.
    float ray = smoothstep(0.25, 0.85, auNoise(cs * 70.0 + seed + vec2(tf * 0.5, 0.0)));
    float flick = auNoise(cs * 22.0 + seed.yx + vec2(0.0, tf * 0.8));
    float rays = 0.35 + 0.65 * ray * (0.5 + 0.8 * flick);
    float fall = mix(9.0, 3.2, auNoise(cs * 30.0 + seed + vec2(tf * 0.2, 3.0))) - fi * 0.8;
    // Below the edge a faint glow falls off quickly, so the sky under a ribbon never reads as a
    // dark band (like a silhouette of hills); the upper ribbon is softer still.
    float under = exp(min(hgt, 0.0) * (30.0 - fi * 18.0)) * (0.22 + fi * 0.2);
    float vert = mix(under, 1.0, smoothstep(-0.012 - fi * 0.03, 0.01, hgt)) * exp(-max(hgt, 0.0) * fall);
    // A sharp, bright lower edge on the main ribbon.
    float edge = (1.0 - fi) * smoothstep(-0.012, 0.004, hgt) * exp(-max(hgt, 0.0) * 40.0);
    // Slow bright and dim stretches along the ribbon.
    float patchy = smoothstep(0.15, 0.75, auNoise(cs * 1.6 + seed + vec2(-t * 0.03, t * 0.02)));
    // Green at the edge → teal → violet higher up.
    vec3 c = mix(vec3(0.12, 1.0, 0.45), vec3(0.1, 0.78, 0.62), smoothstep(0.0, 0.1, hgt));
    c = mix(c, vec3(0.52, 0.24, 0.95), smoothstep(0.08, 0.38, hgt));
    acc += c * patchy * folds * (1.0 - fi * 0.35) * (vert * rays + edge * 0.6);
  }
  // 4. Surges, one sweeping each arc, out of step.
  float surge = 1.0 + 0.9 * uAuroraMotion * (auSurge(a, uAuroraAz, t, 31.0, 0.0) + auSurge(a, 0.0, t, 37.0, 0.5));
  // A diffuse green glow low over the horizon blends the ribbons into the sky.
  acc += vec3(0.06, 0.35, 0.18) * exp(-dir.y * 7.0) * 0.18;
  // Fade out toward the zenith, where vertical rays would converge into a starburst.
  return acc * arcs * surge * 0.7 * (1.0 - smoothstep(0.55, 0.9, dir.y));
}
