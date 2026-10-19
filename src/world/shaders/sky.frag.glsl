// Sky dome: gradient + sun/moon, stars and Milky Way, aurora (aurora.glsl), shooting stars,
// rainbow, clouds.
uniform float uTime;
uniform float uDayLight;
uniform float uStars;
uniform float uRainbow;
uniform float uStarRotation;
uniform float uSkyTurn;
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
  // The star field turns around the same axis as the sun's daily arc, and with the scene's
  // sky turn (undone first: rotating around +Y by +a lowers the azimuth by a).
  vec3 d = rotateAxis(dir, vec3(0.0, 1.0, 0.0), uSkyTurn);
  d = rotateAxis(d, normalize(vec3(0.0, -0.343, 0.939)), -uStarRotation);
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
  // Milky Way: a faint, mottled band across the sky (the great circle around pole n). The
  // dust noise is sampled in the band's own frame: (u, v) go round the band, so there is no
  // seam, and the only pinch point is the pole n, where the band is invisible. (An atan()
  // angle around the star frame's Y axis pinched at the band's edge into a burst of rays.)
  vec3 n = normalize(vec3(0.35, 0.25, 0.9));
  vec3 u = normalize(cross(n, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(n, u);
  float lat = dot(d, n);
  float band = exp(-lat * lat * 22.0);
  // Polar noise coordinates: the angle round the band and the distance across it map to
  // perpendicular directions everywhere (angle → around a circle, latitude → its radius), at
  // about the same rate (≈6 per radian). With a fixed offset for latitude instead, both ran the
  // same way in some stretches of the band and the mottling turned into streaks (like rays).
  vec2 around = normalize(vec2(dot(d, u), dot(d, v)) + 1e-5);
  float dust = cFbm(around * (6.0 + lat * 6.0) + 10.0);
  col += vec3(0.55, 0.6, 0.85) * band * smoothstep(0.35, 0.8, dust) * 0.22;
  return col;
}

// ---- The moon's face -------------------------------------------------------------------
// Disc coordinates: p in the unit disc, +x right and +y up as you look at the moon. The dark
// "seas" (maria) sit roughly where they are on the real near side, so it reads as our moon.

float moonBlob(vec2 p, vec2 c, vec2 r) {
  return 1.0 - smoothstep(0.45, 1.05, length((p - c) / r));
}

float moonAlbedo(vec2 p) {
  // Wobbly shores, so the maria aren't perfect ellipses.
  vec2 w = p + (vec2(cNoise(p * 6.0 + 11.0), cNoise(p * 6.0 + 29.0)) - 0.5) * 0.12;
  float m = 0.0;
  m = max(m, moonBlob(w, vec2(-0.55, 0.05), vec2(0.28, 0.50))); // Oceanus Procellarum
  m = max(m, moonBlob(w, vec2(-0.28, 0.42), vec2(0.25, 0.20))); // Mare Imbrium
  m = max(m, moonBlob(w, vec2(0.00, 0.72), vec2(0.45, 0.07)));  // Mare Frigoris
  m = max(m, moonBlob(w, vec2(0.17, 0.40), vec2(0.14, 0.13)));  // Mare Serenitatis
  m = max(m, moonBlob(w, vec2(0.33, 0.13), vec2(0.18, 0.15)));  // Mare Tranquillitatis
  m = max(m, moonBlob(w, vec2(-0.05, 0.18), vec2(0.11, 0.08))); // Mare Vaporum / Insularum
  m = max(m, moonBlob(w, vec2(0.70, 0.30), vec2(0.10, 0.09)));  // Mare Crisium
  m = max(m, moonBlob(w, vec2(0.58, -0.12), vec2(0.12, 0.16))); // Mare Fecunditatis
  m = max(m, moonBlob(w, vec2(0.38, -0.30), vec2(0.08, 0.08))); // Mare Nectaris
  m = max(m, moonBlob(w, vec2(-0.17, -0.35), vec2(0.17, 0.13))); // Mare Nubium
  m = max(m, moonBlob(w, vec2(-0.45, -0.38), vec2(0.09, 0.09))); // Mare Humorum
  // Bright, crater-pocked highlands; the maria are darker and smoother.
  float highland = 0.8 + 0.12 * cNoise(p * 18.0) + 0.08 * cNoise(p * 47.0);
  float mare = 0.48 + 0.06 * cNoise(p * 12.0 + 5.0);
  float alb = mix(highland, mare, m * 0.92);
  // Tycho: a small bright crater in the south with long rays across the disc.
  vec2 ty = p - vec2(-0.13, -0.68);
  float r = length(ty);
  float a = atan(ty.y, ty.x);
  float rays = pow(0.5 + 0.5 * sin(a * 11.0 + cNoise(vec2(a * 2.0, 3.0)) * 4.0), 8.0);
  alb += exp(-r * r * 1500.0) * 0.35 + rays * exp(-r * 2.2) * smoothstep(0.04, 0.1, r) * 0.12;
  // Copernicus and Kepler: smaller bright spots in the west.
  alb += exp(-dot(p - vec2(-0.3, 0.2), p - vec2(-0.3, 0.2)) * 2500.0) * 0.2;
  alb += exp(-dot(p - vec2(-0.55, 0.17), p - vec2(-0.55, 0.17)) * 3500.0) * 0.15;
  return alb;
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
  col += aurora(dir, uTime) * uAurora;

  // 22° halo: ice crystals in a thin, high veil of cloud bend moonlight into a large faint
  // ring, with a sharp reddish inner edge and a soft outer one. It comes and goes over a few
  // minutes, and needs some (not much) cloud.
  float moonUp = smoothstep(-0.03, 0.05, uMoonDir.y) * uNight;
  if (moonUp > 0.0 && dir.y > 0.0) {
    float ang = degrees(acos(clamp(dot(dir, uMoonDir), -1.0, 1.0)));
    float x = ang - 22.0;
    float ring = exp(-x * x / (x < 0.0 ? 0.25 : 2.6));
    vec3 ringCol = mix(vec3(1.0, 0.72, 0.5), vec3(0.85, 0.9, 1.0), smoothstep(21.6, 23.5, ang));
    float veil = smoothstep(0.12, 0.28, uCloudCover) * (1.0 - smoothstep(0.55, 0.8, uCloudCover));
    float sometimes = smoothstep(0.45, 0.75, cNoise(vec2(uTime / 150.0, 4.2)));
    col += ringCol * moonTint() * ring * veil * sometimes * moonUp * (0.03 + 0.05 * uMoonGlow) * smoothstep(0.0, 0.08, dir.y);
  }

  // Moon disc (faintly visible by day too), with the real near side's light and dark areas.
  // A full moon (uMoonGlow > 0.3) grows up to ~1.5x wider and brighter.
  float grow = smoothstep(0.3, 1.0, uMoonGlow);
  float moonRadius = mix(0.0277, 0.0424, grow); // radians
  vec3 mR = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-5, 0.0, 0.0));
  vec3 mU = cross(mR, uMoonDir);
  vec2 mp = vec2(dot(dir, mR), dot(dir, mU)) / moonRadius;
  float mr = length(mp);
  if (mr < 1.1 && dot(dir, uMoonDir) > 0.0) {
    float moonDisc = (1.0 - smoothstep(0.93, 1.0, mr)) * smoothstep(-0.03, 0.03, uMoonDir.y);
    // A sphere: slightly dimmer toward the rim.
    float limb = 0.86 + 0.14 * sqrt(max(1.0 - mr * mr, 0.0));
    // Low over the horizon the moon is dimmer as well as more orange.
    float lowDim = mix(0.4, 1.0, smoothstep(0.0, 0.32, uMoonDir.y));
    vec3 moonCol = vec3(0.95, 0.96, 1.0) * moonTint() * moonAlbedo(mp) * limb * lowDim;
    // Kept below the tone mapper's white point so the maria stay visible.
    col = mix(col, moonCol * mix(1.45 + 0.4 * grow, 0.9, uDayLight), moonDisc * mix(1.0, 0.35, uDayLight));
  }

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
    // The moon behind cloud: thin cloud near it glows (light scattered forward through the
    // droplets), most right around the disc; medium-thick edges get a silver rim; thick cloud
    // swallows it.
    float mdot = max(dot(dir, uMoonDir), 0.0);
    float aureole = pow(mdot, 2000.0) * 1.4 + pow(mdot, 150.0) * 0.45 + pow(mdot, 20.0) * 0.08;
    float rim = smoothstep(0.05, 0.45, dens) * (1.0 - smoothstep(0.5, 0.95, dens)) * pow(mdot, 40.0);
    shade += moonTint() * moonUp * (aureole * (0.5 + uMoonGlow) * (1.0 - 0.8 * dens) + rim * 0.5);
    col = mix(col, shade, dens * 0.93);
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
