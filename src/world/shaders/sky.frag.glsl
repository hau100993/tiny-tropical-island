// Sky dome: gradient + sun/moon, stars and Milky Way, aurora, shooting stars, rainbow, clouds.
uniform float uTime;
uniform float uDayLight;
uniform float uStars;
uniform float uAurora;
uniform float uRainbow;
uniform float uStarRotation;
// Size must match METEOR_SLOTS in core/uniforms.ts.
#define METEOR_SLOTS 8
uniform vec4 uMeteorA[METEOR_SLOTS];
uniform vec4 uMeteorB[METEOR_SLOTS];

varying vec3 vDir;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// Rodrigues rotation of v around unit axis k by angle a.
vec3 rotateAxis(vec3 v, vec3 k, float a) {
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}

vec3 stars(vec3 dir) {
  // The star field turns around the same axis as the sun's daily arc.
  vec3 d = rotateAxis(dir, normalize(vec3(0.0, -0.343, 0.939)), -uStarRotation);
  vec3 col = vec3(0.0);
  // Two layers: many faint stars and a few bright ones.
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 260.0 : 90.0;
    vec3 p = d * scale;
    vec3 cell = floor(p);
    float h = hash13(cell + float(layer) * 17.0);
    float chance = layer == 0 ? 0.955 : 0.985;
    if (h > chance) {
      vec3 c = vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1));
      float dist = length(fract(p) - c);
      float size = layer == 0 ? 0.16 : 0.12;
      float s = 1.0 - smoothstep(0.0, size, dist);
      float bright = (layer == 0 ? 0.6 : 2.2) * (0.3 + pow(hash13(cell + 7.7), 2.0));
      float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + h * 6.0) + h * 120.0);
      vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.88, 0.7), hash13(cell + 9.1));
      col += tint * s * bright * twinkle;
    }
  }
  // Milky Way: a faint, mottled band across the sky.
  float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.25, 0.9))), 2.0) * 22.0);
  float dust = cFbm(vec2(atan(d.x, d.z) * 3.0, d.y * 6.0));
  col += vec3(0.55, 0.6, 0.85) * band * smoothstep(0.35, 0.8, dust) * 0.22;
  return col;
}

vec3 aurora(vec3 dir) {
  if (dir.y < 0.0) return vec3(0.0);
  // North is −Z (the sun culminates toward +Z).
  float az = atan(dir.x, -dir.z);
  // Broad bell-shaped falloff away from north: no hard sides.
  float north = exp(-az * az * 0.8);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = uTime * (0.012 + 0.006 * fi);
    // The curtain's lower edge meanders up and down along the horizon.
    float base = 0.07 + 0.05 * fi + 0.1 * (cNoise(vec2(az * 0.9 + t * 0.6, fi * 7.3)) - 0.5);
    float hgt = dir.y - base;
    // Brightness drifts in slow patches along the curtain, so no even, box-like bands.
    float patchy = smoothstep(0.2, 0.8, cNoise(vec2(az * 1.4 - t * 0.8, fi * 3.1 + t * 0.15)));
    // Soft folds (gentle sine, not a sharp spike) bent by noise.
    float fold = 0.5 + 0.5 * sin(az * (4.0 + fi * 2.0) + cNoise(vec2(az * 2.0 + t, fi)) * 4.0 + t * 2.5);
    fold = 0.35 + 0.65 * fold * fold;
    // Faint vertical rays, low contrast.
    float rays = 0.75 + 0.25 * cNoise(vec2(az * 45.0 + t * 1.5, fi * 3.0));
    // Soft lower edge, then a long fade upward (thinner air glows less).
    float vert = smoothstep(-0.03, 0.04, hgt) * exp(-max(hgt, 0.0) * (5.5 - fi * 1.2));
    // Green at the bottom → teal → violet at the top.
    vec3 c = mix(vec3(0.12, 1.0, 0.45), vec3(0.1, 0.75, 0.65), smoothstep(0.0, 0.12, hgt));
    c = mix(c, vec3(0.55, 0.22, 0.95), smoothstep(0.1, 0.4, hgt));
    acc += c * patchy * fold * rays * vert * (1.0 - fi * 0.25);
  }
  // A diffuse green glow low over the horizon blends the curtains into the sky.
  acc += vec3(0.06, 0.35, 0.18) * exp(-dir.y * 7.0) * 0.18;
  return acc * north * 0.55;
}

vec3 meteors(vec3 dir) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < METEOR_SLOTS; i++) {
    float p = (uTime - uMeteorA[i].w) / uMeteorB[i].w;
    if (p < 0.0 || p > 1.0) continue;
    vec3 s = uMeteorA[i].xyz;
    vec3 e = uMeteorB[i].xyz;
    // Per-meteor brightness and tint from its start time (mostly faint, a few bright ones).
    float h = fract(sin(uMeteorA[i].w * 12.9898) * 43758.5453);
    float bright = 0.6 + 2.2 * h * h;
    vec3 head = normalize(mix(s, e, p));
    vec3 tail = normalize(mix(s, e, max(0.0, p - 0.5)));
    vec3 ab = head - tail;
    float t = clamp(dot(dir - tail, ab) / max(dot(ab, ab), 1e-7), 0.0, 1.0);
    float d = length(dir - (tail + ab * t));
    // Fade in fast, burn out at the end.
    float life = smoothstep(0.0, 0.1, p) * (1.0 - smoothstep(0.6, 1.0, p));
    // About as thin as a star (1 px ≈ 0.001 rad at 1080p): a soft Gaussian line whose width
    // and brightness taper from the head to nothing at the end of the tail.
    float w = mix(0.00035, 0.0007, t);
    float line = exp(-(d * d) / (w * w));
    float grad = t * t * t;
    // Tail colors: faint blue-green at the end, warm white near the head.
    vec3 c = mix(vec3(0.45, 0.75, 1.0), mix(vec3(1.0, 0.9, 0.75), vec3(1.0), h), smoothstep(0.4, 1.0, t));
    col += c * line * grad * life * bright;
    // The head: a star-sized point.
    float hd = length(dir - head);
    col += vec3(1.0, 0.97, 0.92) * exp(-(hd * hd) / 0.0000006) * life * bright * 1.5;
  }
  return col;
}

vec3 rainbow(vec3 dir) {
  float ang = degrees(acos(clamp(dot(dir, -uSunDir), -1.0, 1.0)));
  float r = (ang - 40.4) / 2.4; // 0 = violet (inner) … 1 = red (outer)
  if (r < 0.0 || r > 1.0 || dir.y < 0.0) return vec3(0.0);
  float hue = (1.0 - r) * 0.78;
  vec3 rgb = clamp(abs(fract(vec3(hue) + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return rgb * smoothstep(0.0, 0.2, r) * (1.0 - smoothstep(0.8, 1.0, r)) * smoothstep(0.0, 0.08, dir.y);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);

  float above = smoothstep(-0.02, 0.04, dir.y);
  col += stars(dir) * uStars * uNight * above;
  col += aurora(dir) * uAurora;

  // Moon disc, faintly visible by day too.
  float md = dot(dir, uMoonDir);
  float moonDisc = smoothstep(0.99955, 0.99968, md) * smoothstep(-0.03, 0.03, uMoonDir.y);
  float craters = cNoise((dir.xz - uMoonDir.xz) * 900.0 + 3.0);
  vec3 moonCol = vec3(0.95, 0.96, 1.0) * (0.8 + 0.2 * craters);
  col = mix(col, moonCol * mix(1.6, 0.9, uDayLight), moonDisc * mix(1.0, 0.35, uDayLight));

  // Sun disc with a soft edge.
  col += uSunColor * smoothstep(0.9994, 0.9998, dot(dir, uSunDir)) * 6.0 * step(-0.02, uSunDir.y);

  col += meteors(dir) * uStars;
  col += rainbow(dir) * uRainbow * 0.35;

  // Clouds on a flat layer: project the view ray onto it, shade from the sun's side.
  if (dir.y > 0.0 && uCloudCover > 0.01) {
    vec2 cp = dir.xz / (dir.y + 0.06) * 0.6 + uCloudOffset;
    float dens = cloudDensity(cp) * smoothstep(0.0, 0.15, dir.y);
    float selfShadow = cloudDensity(cp + uSunDir.xz * 0.12);
    vec3 lit = mix(vec3(0.05, 0.06, 0.09), mix(vec3(1.0), uSunColor, 0.35), uDayLight) * (1.0 - 0.4 * uCloudCover);
    vec3 shade = lit * mix(1.0, 0.55, selfShadow);
    // Silver lining where the sun shines through thin edges; moonlit rims at night.
    shade += uSunColor * pow(max(dot(dir, uSunDir), 0.0), 8.0) * (1.0 - dens) * 0.8 * uDayLight;
    shade += vec3(0.2, 0.24, 0.38) * pow(max(dot(dir, uMoonDir), 0.0), 4.0) * uNight * 0.35;
    col = mix(col, shade, dens * 0.93);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
