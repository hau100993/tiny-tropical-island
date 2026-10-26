// Sun (or moon) glitter on a rough sea: a slope-variance Beckmann BRDF after Bruneton, Neyret
// and Holzschuch, "Real-time Realistic Ocean Lighting using Seamless Transitions from Geometry
// to BRDF" (2010), ported from open-water by Leonxlnx (MIT, see README).
// The waves we draw tilt the normal; the slopes too small to draw (or faded out with distance)
// are not lost: their variance widens the reflection lobe instead. So the road of light is as
// wide as the sea is rough, near and far, with no hand-tuned exponents.
// Needs SEA_GERSTNER_MSS (gerstner.ts) defined by the material.

// Light reaching the water from the glint source, relative to uGlintColor (display units).
#define GLINT_IRRADIANCE 0.4

// Mean square slope (both axes) of the ripples too small to be geometry: grows with the wave
// strength; rain roughens the surface further. With the Gerstner part the default sea (0.45)
// totals ~0.024, Cox & Munk's (1954) slope variance for a ~4 m/s breeze.
float capillaryMss(float waveStrength, float rain) {
  return 0.003 + 0.022 * waveStrength + 0.012 * rain;
}

// Mean square slope of the whole open sea: the Gerstner waves plus the capillary ripples.
float seaMss(float waveStrength, float rain) {
  return SEA_GERSTNER_MSS * waveStrength * waveStrength + capillaryMss(waveStrength, rain);
}

float glitterErfc(float x) {
  return 2.0 * exp(-x * x) / (2.319 * x + sqrt(4.0 + 1.52 * x * x));
}

// Smith masking for Beckmann slopes: how much of the facets the eye (or light) can't see
// at a grazing angle because nearer waves hide them.
float glitterLambda(float cosT, float sigmaSq) {
  float v = cosT / sqrt(max(1.0 - cosT * cosT, 1e-6) * 2.0 * sigmaSq);
  return max(0.0, (exp(-v * v) - v * 1.7724539 * glitterErfc(v)) / (2.0 * v * 1.7724539));
}

// Reflected radiance per unit irradiance from a distant light L, seen along V, for a surface of
// mean normal N whose unresolved facets have slope variance `sigmaSq` per axis (isotropic).
float glitterBRDF(vec3 L, vec3 V, vec3 N, float sigmaSq) {
  vec3 H = normalize(L + V);
  float zH = dot(H, N);
  if (zH <= 0.0) return 0.0;
  float zH2 = zH * zH;
  float e = 0.5 * (1.0 - zH2) / (zH2 * sigmaSq);
  // Far outside the lobe (e^-12 ≈ 6e-6): nothing to see. Most pixels stop here, which skips the
  // masking terms below (the costly part).
  if (e > 12.0) return 0.0;
  float zL = clamp(dot(L, N), 0.01, 0.9999);
  float zV = clamp(dot(V, N), 0.01, 0.9999);
  float p = exp(-e) / (6.2831853 * sigmaSq);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  return F * p / ((1.0 + glitterLambda(zL, sigmaSq) + glitterLambda(zV, sigmaSq)) * 4.0 * zV * zH2 * zH2);
}

// The light has a size (radius in radians): aim at the point of its disc nearest the mirror
// direction Rm, so the reflection is never smaller than the disc's own mirror image.
vec3 glintAim(vec3 Rm, vec3 L, float size) {
  float ang = acos(clamp(dot(L, Rm), -1.0, 1.0));
  return ang <= size ? Rm : normalize(mix(L, Rm, size / ang));
}
