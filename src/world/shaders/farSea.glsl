// The open sea far away. No waves are drawn there, so it is shaded statistically. Shared by
// the water surface (its far end) and the sky dome below the horizon (the sea beyond the
// water mesh, out to the true horizon), so the two meet without a seam. Needs skyCommon.glsl.
uniform vec3 uDeepColor;
uniform vec3 uGlintDir;
uniform vec3 uGlintColor;
uniform float uGlintSize;
uniform float uSunGlint;

// A rough sea seen at a grazing angle reflects less than a flat mirror would (Fresnel → 1):
// the wave facets you see there tilt toward you. So it stays darker than the sky above it
// and the horizon reads as a line.
#define FAR_SEA_FRESNEL 0.8
// How much the far sea melts into the haze over the horizon.
#define FAR_SEA_HAZE 0.8

float seaHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float seaNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), f.x),
             mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// 0..1 around sunrise and sunset, while the sun is up.
float goldenHour() {
  return (1.0 - smoothstep(0.0, 0.25, abs(uSunDir.y))) * smoothstep(-0.03, 0.02, uSunDir.y);
}

// Spread of the wave slopes (std of the facet tilt, radians) for the wave strength.
float seaRoughness(float waveStrength) {
  return 0.04 + 0.09 * waveStrength;
}

// The sky as the sea mirrors it. `rough` 0..1: far away, the facets you see tilt toward you
// and mirror sky from a little higher up (bluer by day, less glowing at dusk). Golden hour:
// away from the sun the reflections cool to a clear blue; toward it they keep the golden light.
vec3 seaSkyReflection(vec3 R, float rough) {
  R = normalize(vec3(R.x, max(R.y, 0.07 * rough), R.z));
  vec3 refl = skyColor(R);
  float sunSide = pow(max(dot(normalize(R.xz + 1e-4), normalize(uSunDir.xz + 1e-4)), 0.0), 4.0);
  vec3 coolRefl = vec3(dot(refl, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.55, 0.85, 1.25);
  return mix(refl, coolRefl, goldenHour() * (1.0 - sunSide) * 0.55);
}

// Haze over the sea: the sky right at the horizon in the direction of the view ray `d`
// (orange under a low sun, blue-lilac away from it), not one fog colour all around.
vec3 seaHaze(vec3 d) {
  return skyColor(normalize(vec3(d.x, 1e-4, d.z)));
}

// Glitter road where the waves are too far to draw: the chance that a wave facet there tilts
// just right to mirror the light toward the eye (a Gaussian spread of slopes, `sigma`). The
// light has a size: aim at the point of its disc nearest the mirror direction, so the road is
// never thinner than the disc, and right under a low sun it is its mirror image.
// `d`: view ray (camera → sea), unit.
float glintRoad(vec3 d, float sigma) {
  vec3 Rm = vec3(d.x, -d.y, d.z);
  float ang = acos(clamp(dot(uGlintDir, Rm), -1.0, 1.0));
  vec3 L = ang <= uGlintSize ? Rm : normalize(mix(uGlintDir, Rm, uGlintSize / ang));
  // Half vector between the eye (−d) and the light; its tilt from straight up is the facet
  // tilt needed.
  vec3 H = normalize(L - d);
  float t2 = dot(H.xz, H.xz) / max(H.y * H.y, 1e-6);
  return exp(-t2 / (sigma * sigma)) * step(0.0, uGlintDir.y);
}

// The far road breaks into flickering dashes (wave crests, each a horizontal sliver at that
// distance). They are laid out in angles around the light, so they stay a few pixels big at
// any distance. Toward the horizon they merge into a banded strip.
float glintDashes(vec3 d, float t) {
  vec2 l = normalize(uGlintDir.xz + 1e-4);
  float az = atan(d.x * l.y - d.z * l.x, d.x * l.x + d.z * l.y);
  vec2 p = vec2(az * 110.0, d.y * 380.0);
  float n = seaNoise(p + vec2(t * 0.6, t * 1.7)) * seaNoise(p * vec2(1.6, 2.1) + vec2(-t * 0.9, t * 2.6));
  float dashes = smoothstep(0.1, 0.45, n);
  return mix(dashes, 0.6 + 0.4 * dashes, 1.0 - smoothstep(0.0, 0.015, -d.y));
}

// The far road's light, before tone mapping.
vec3 farGlint(vec3 d, float sigma, float t) {
  return uGlintColor * glintRoad(d, sigma) * glintDashes(d, t) * 2.5;
}

// The low sun's road in the disc's own display colour, screen-blended after tone mapping like
// the disc's glare: orange right under the disc, where ACES alone turns it pale yellow.
vec3 sunRoadDisplay(vec3 d, float sigma, float t) {
  if (uSunGlint <= 0.0) return vec3(0.0);
  float over;
  vec3 c = sunDiscExposed(sunDiscBase(uSunDir.y), over);
  return c * clamp(glintRoad(d, sigma) * glintDashes(d, t) * uSunGlint * 0.9, 0.0, 1.0);
}

// The far sea along the view ray `d` (d.y < 0), before tone mapping: the deep water body, the
// rough sky reflection (plus `extraRefl`, e.g. the aurora), the haze and the glitter road.
vec3 farSea(vec3 d, float sigma, float t, vec3 extraRefl) {
  vec3 R = vec3(d.x, -d.y, d.z);
  float fres = min(0.02 + 0.98 * pow(1.0 - R.y, 5.0), FAR_SEA_FRESNEL);
  float lit = max(uDayLight, 0.55 * goldenHour());
  vec3 col = mix(uDeepColor * lit, seaSkyReflection(R, 1.0) + extraRefl, fres);
  col = mix(col, seaHaze(d), FAR_SEA_HAZE);
  return col + farGlint(d, sigma, t) * (1.0 - 0.4 * FAR_SEA_HAZE);
}
