// Cloud density field shared by the sky (what you see) and the ground (cloud shadows).
uniform float uCloudCover;
uniform vec2 uCloudOffset;

float cHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float cNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float cFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * cNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}

// 0 = clear … 1 = thick cloud, at cloud-layer coordinate p. Higher cover lowers the threshold.
float cloudDensity(vec2 p) {
  float n = cFbm(p);
  return smoothstep(1.0 - uCloudCover * 0.95 - 0.12, 1.0 - uCloudCover * 0.95 + 0.25, n);
}

// Shadow of the clouds on the ground/sea at world position xz (patches of roughly 80 m),
// cast along the sun direction and drifting with the same offset as the sky's clouds.
float cloudShadow(vec2 xz, vec3 sunDir) {
  if (uCloudCover < 0.01 || sunDir.y <= 0.0) return 0.0;
  vec2 p = (xz + sunDir.xz / max(sunDir.y, 0.25) * 120.0) * 0.012 + uCloudOffset * 3.0;
  return cloudDensity(p) * smoothstep(0.0, 0.15, sunDir.y);
}
