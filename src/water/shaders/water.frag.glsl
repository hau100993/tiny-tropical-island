// Water shading: Fresnel blend of sky reflection and the water body.
// REFRACTION: the body is the captured scene behind the surface, distorted by the normal and
// tinted by how much water the view ray crosses. Otherwise: alpha blending over the seabed.
uniform float uTime;
uniform sampler2D uWake;
uniform vec2 uWakeCenter;
uniform float uWakeSize;
uniform float uWakeOn;
uniform vec3 uUnderColor;
uniform float uCamUnder; // 1 while the camera is under the surface
uniform float uWaveStrength;
uniform float uRain;
uniform vec3 uLightColor;
uniform vec3 uShallowColor;

#ifdef REFRACTION
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
#include <packing>
#endif
#ifdef REFLECTION
uniform sampler2D uReflection;
varying vec4 vReflCoord;
#endif

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vCrest;
varying float vCloudShadow;
varying vec2 vSwash;
varying vec3 vSurf;
varying vec2 vSlopeVar;

#include <fog_pars_fragment>

// Area of one glinting wave facet (m²). Real capillary facets are ~1 cm², but our sun disc is
// drawn ~6× wider than the real one; this keeps the near sparkles few and bright at orbit range.
#define GLINT_FACET 0.0008

// Fine wave detail for the normal only (1.3 m … 0.27 m). Each wave shows while a pixel can hold
// it and fades as the footprint `pix` (m) grows; what fades, and the ripples smaller still, stays
// in the glitter lobe as roughness. Carries 35% of the capillary slope variance `capMss`.
// Returns the slope gradient (xy) and the mean square slope drawn (z).
vec3 detailWaves(vec2 p, float t, float pix, float capMss) {
  // Pixels wider than half the longest wave (1.3 m) hold none of them (the far sea).
  if (pix > 0.66) return vec3(0.0);
  float a = sqrt(2.0 * capMss * 0.35 / 6.0);
  // Wave groups: two slow patch fields modulate the amplitudes (mean square ≈ 1), so the
  // crests don't run on as endless parallel stripes.
  vec2 grp = vec2(valueNoise(p * 0.11 + vec2(t * 0.05, 3.7)), valueNoise(p * 0.13 - vec2(5.1, t * 0.04)));
  grp = 0.3 + 1.3 * grp;
  vec3 r = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float k = 4.8 * pow(1.38, fi);
    // Spread widely around the swell's direction (gerstner.ts), so no stripes line up.
    float ang = 3.6 + sin(fi * 2.4) * 1.4;
    vec2 D = vec2(cos(ang), sin(ang));
    float lambda = 6.2831853 / k;
    float w = (1.0 - smoothstep(lambda * 0.15, lambda * 0.5, pix)) * (mod(fi, 2.0) < 0.5 ? grp.x : grp.y);
    r.xy += D * (a * w * cos(k * dot(D, p) - sqrt(9.81 * k) * t + fi * 1.7));
    r.z += 0.5 * a * a * w * w;
  }
  return r;
}

// Near the camera the glitter's mean is carried by a few wave facets that happen to mirror the
// light into the eye: `lam` of them in this pixel on average (a Poisson count, after
// open-water). Few: sparse, full-brightness sparkles on dark water; many (far away): the smooth
// road. Each lives about 1/12 s. Returns the factor on the mean.
float glintSparkle(float lam, vec2 cell, float t) {
  if (lam < 1e-5 || lam > 400.0) return 1.0;
  float frame = mod(floor(t * 12.0 + hash12(cell * 0.37 + 1.3)), 4096.0);
  float u = hash12(cell + vec2(frame * 7.13, frame * 3.71));
  float k = 0.0;
  if (lam < 12.0) {
    // Inverse transform sampling of the Poisson distribution.
    float pk = exp(-lam);
    float cdf = pk;
    for (int i = 0; i < 24; i++) {
      if (u <= cdf) break;
      k += 1.0;
      pk *= lam / k;
      cdf += pk;
    }
  } else {
    // Many facets: Gaussian shot noise around the mean.
    float u2 = hash12(cell.yx + vec2(frame * 5.3, 11.0));
    k = max(lam + sqrt(lam) * sqrt(-2.0 * log(max(u, 1e-6))) * cos(6.2831853 * u2), 0.0);
  }
  // Lone sparkles vary in brightness (facet size and tilt); many average out.
  float u3 = hash12(cell * 1.7 + vec2(frame * 2.9, 5.0));
  return k / lam * mix(min(-log(max(u3, 1e-3)), 3.0) / 0.95, 1.0, min(k * 0.25, 1.0));
}

// Distance to the nearest of a jittered grid of points (Worley / cellular noise), 0 … ~0.8.
float cellDist(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 h = vec2(hash12(i + o), hash12(i + o + 19.19));
      vec2 r = o + h - f;
      d = min(d, dot(r, r));
    }
  }
  return sqrt(d);
}

// Foam "lace": the threshold foam must exceed to show. High at bubble centers (holes), low
// along the walls between bubbles, so thin foam breaks up into a bubbly net, like real surf.
float foamLace(vec2 p, float t) {
  vec2 drift = vec2(t * 0.06, t * 0.035);
  float a = cellDist(p * 2.6 + drift);
  float b = cellDist(p * 6.5 - drift * 1.7);
  return 1.0 - smoothstep(0.0, 0.75, a * 0.6 + b * 0.4);
}

void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 xz = vWorldPos.xz;
  float t = uTime;

  // Per-pixel detail: small moving ripples (faded with distance to avoid shimmer) and the
  // simulated ripples (clicks, later rain).
  vec2 g = rippleGradient(xz, t) * (0.4 + uWaveStrength) * (1.0 - smoothstep(40.0, 160.0, dist));
  vec4 sim = sampleSim(xz);
  // Simulated slopes are amplified so ripple rings stay readable from orbit distance.
  g += sim.yz * sim.w * 4.0;
  // Kayak wake (see WakeMap.ts): fine foam and bumps; slopes from the height channel.
  float wakeFoam = 0.0;
  vec2 wuv = (xz - uWakeCenter) / uWakeSize + 0.5;
  if (uWakeOn > 0.5 && all(lessThan(abs(wuv - 0.5), vec2(0.5)))) {
    float e = 0.12 / uWakeSize;
    vec2 wk = texture2D(uWake, wuv).rg;
    float hx = texture2D(uWake, wuv + vec2(e, 0.0)).g - texture2D(uWake, wuv - vec2(e, 0.0)).g;
    float hz = texture2D(uWake, wuv + vec2(0.0, e)).g - texture2D(uWake, wuv - vec2(0.0, e)).g;
    // Fade out at the map's edge so its square never shows.
    float edge = 1.0 - smoothstep(0.4, 0.5, max(abs(wuv.x - 0.5), abs(wuv.y - 0.5)));
    g += vec2(hx, hz) / 0.24 * 2.2 * edge;
    // Saturates gently: many overlapping marks make thick foam, never a solid sheet.
    wakeFoam = (1.0 - exp(-wk.r * 1.6)) * 0.85 * edge;
  }
  // Rain pitting: fine, fast-changing roughness (the sim adds the bigger splash rings).
  if (uRain > 0.001) {
    vec2 rp = xz * 3.3;
    vec2 pit = vec2(valueNoise(rp + vec2(t * 7.1, 0.0)), valueNoise(rp + vec2(13.7, -t * 6.3))) - 0.5;
    g += pit * 0.22 * uRain * (1.0 - smoothstep(30.0, 120.0, dist));
  }
  // Pixel footprint on the water: its two edges (m) and area (m²).
  vec2 ex = dFdx(xz);
  vec2 ey = dFdy(xz);
  float footA = max(length(cross(dFdx(vWorldPos), dFdy(vWorldPos))), 1e-6);
  float capMss = capillaryMss(uWaveStrength, uRain);
  vec3 det = detailWaves(xz, t, max(length(ex), length(ey)), capMss);
  g += det.xy;
  vec3 N = normalize(vNormalW + vec3(-g.x, 0.0, -g.y));
  // Far away, many steep wave facets per pixel average out to a flatter surface; without this
  // the sun glint and reflections turn into blocky blobs when seen from high above.
  float far = smoothstep(80.0, 400.0, dist);
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), far * 0.7));

  // Under water (the camera, see Underwater.ts) every face of the surface is its underside. Above
  // it, a back face is the far side of a wave crest higher than your eyes (swimming, surfing):
  // it is shaded like the top, not as the dark underside.
  if (uCamUnder > 0.5) {
    // Seen from below, diving. Rays steeper than ~48.6° from straight up leave the water
    // (Snell's window: the whole sky squeezed into a bright disc overhead, wobbling with the
    // waves); flatter rays are reflected back down (total internal reflection), so the rest
    // of the surface mirrors the dim water below.
    vec3 d = -V;
    vec3 n = -N;
    float cosI = -dot(n, d);
    // A front face seen from "under water": the surface dips below the eyes right there (the
    // eyes are at the waterline). No window: just the water mirrored from below.
    float k = gl_FrontFacing ? -1.0 : 1.0 - 1.333 * 1.333 * (1.0 - cosI * cosI);
    vec3 col = uUnderColor * 0.85;
    // Soft edge: the waves blur the window's rim.
    float win = smoothstep(-0.12, 0.25, k);
    if (k > 0.0) {
      vec3 r = normalize(1.333 * d + (1.333 * cosI - sqrt(k)) * n);
      vec3 sky = skyColor(r) * vec3(0.75, 0.95, 1.0);
      float sun = pow(max(dot(r, uSunDir), 0.0), 60.0) * 4.0 * step(0.0, uSunDir.y) * uDayLight;
      col = mix(col, sky + uLightColor * sun, win);
    }
    // A bright rim right at the window's edge.
    col += uUnderColor * 1.2 * exp(-k * k * 60.0) * uDayLight;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    return;
  }

  float depth = max(vWorldPos.y - terrainHeight(xz), 0.0);

  // Fresnel (Schlick, water F0 ≈ 0.02): grazing angles reflect more sky.
  // Far away it is capped like the open sea beyond (FAR_SEA_FRESNEL, farSea.glsl), so the far
  // water stays a little darker than the sky and the horizon reads as a line.
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  fres = min(fres, mix(1.0, FAR_SEA_FRESNEL, far));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  // The sky (seaSkyReflection: rougher far away, cooler away from a low sun), aurora
  // included: its ribbons shimmer on the waves as green streaks.
  vec3 refl = seaSkyReflection(R, far) + aurora(R, uTime) * uAurora;
  float golden = goldenHour();
#ifdef REFLECTION
  // Mirror image of the scene (alpha 0 where only sky would be reflected). Waves bend it; far
  // away the distortion fades with the flattened normal.
  vec2 reflUV = vReflCoord.xy / vReflCoord.w + N.xz * 0.06 * (1.0 - far);
  vec4 mirrored = texture2D(uReflection, reflUV);
  refl = mix(refl, mirrored.rgb, mirrored.a);
#endif

  // Shore foam. "coverage" says how much foam there should be; the lace pattern then decides
  // where: thin coverage leaves scattered bubbles, thick coverage solid white water.
  float n = valueNoise(xz * 0.9 + vec2(t * 0.15, -t * 0.1));
  float n2 = valueNoise(xz * 3.1 - vec2(t * 0.3, t * 0.2));
  // Distances to the shore wander with noise, so foam lines never trace the depth contour.
  float wd = depth + (valueNoise(xz * 0.35 + vec2(t * 0.04, -t * 0.03)) - 0.5) * 0.25 + (n2 - 0.5) * 0.1;
  // The swash (see swash.glsl and the vertex shader) moves the waterline itself; here it
  // decides the foam: a thick white front while a wave runs up, thin streaky lace while the
  // sheet drains back.
  float rising = vSwash.x;
  float nearShore = vSwash.y;
  float phase = swNoise(xz * 0.08 + 7.3) * 6.2831;
  float sea = 0.5 + uWaveStrength;
  // Breaking bands rolling in toward the beach, broken into segments along the shore.
  float bands = 0.5 + 0.5 * sin(wd * 9.0 - t * 1.3 + phase + n * 2.5);
  float segs = smoothstep(0.25, 0.7, valueNoise(xz * 0.22 + vec2(t * 0.05, 0.0)));
  float coverage = (1.0 - smoothstep(0.0, 0.35 * sea, wd)) * smoothstep(0.55, 0.95, bands) * (0.3 + 0.6 * segs);
  // The running-up front: a white rim at the edge that widens while the wave advances.
  coverage = max(coverage, (0.6 + 0.35 * rising) * (1.0 - smoothstep(0.0, 0.025 + 0.11 * rising * sea, wd)));
  // Backwash: the draining sheet leaves streaks of foam (noise stretched along the shore slope).
  float streaks = valueNoise(vec2(xz.x * 1.3 + xz.y * 0.4, xz.y * 1.3 - xz.x * 0.4) + vec2(0.0, t * 0.25));
  coverage = max(coverage, nearShore * (1.0 - rising) * (1.0 - smoothstep(0.0, 0.12, wd)) * smoothstep(0.45, 0.8, streaks) * 0.75);
  coverage += smoothstep(0.55, 0.95, vCrest) * smoothstep(0.5, 1.0, uWaveStrength) * n2;
  // A little white water on strong ripples (splashes).
  coverage += smoothstep(0.06, 0.2, sim.x) * sim.w * 0.6 * (0.4 + n2);
  coverage += wakeFoam;
  // Surf break: white water on the broken face, the soup behind it, spray feathering the lip.
  // Patchy (noise), so its edges never draw straight lines.
  coverage += vSurf.x * (0.65 + 0.7 * valueNoise(xz * 0.5 + vec2(t * 0.2, 0.0)) * n);
  float foam = 0.0;
  if (coverage > 0.01) {
    // Thin foam is see-through bubbles; only thick coverage turns solid white.
    float near = smoothstep(0.15, 0.25, foamLace(xz, t) - coverage + 0.2);
    float laced = (1.0 - near) * (0.55 + 0.4 * smoothstep(0.5, 1.0, coverage));
    // Far away the lace would shimmer (many cells per pixel): use a soft, thinner average.
    foam = mix(laced, smoothstep(0.35, 1.0, coverage) * 0.6, smoothstep(25.0, 110.0, dist));
  }
  // Foam and water body follow the light level (dark sea at night).
  vec3 foamColor = vec3(0.92, 0.96, 0.97) * (0.03 + 0.97 * uDayLight * uDayLight);
  // Cloud shadows darken the water body (reflections of the sky stay).
  // At golden hour the water body keeps some clear blue under the low sun.
  float lit = max(uDayLight, 0.55 * golden) * (1.0 - 0.55 * vCloudShadow);
  vec3 deep = uDeepColor * lit;
  vec3 shallow = uShallowColor * lit;
  // The thin face of a standing wave glows turquoise with the light coming through it.
  vec3 faceGlow = mix(uShallowColor, uDeepColor, 0.35) * lit * 1.25;

  // Glint of the light (uGlintDir: the sun while any of its disc shows, else the moon's silver
  // path). The slopes the normal doesn't carry (waves faded out with distance, ripples below a
  // pixel, the flattening far away) widen a Beckmann lobe instead (glitter.glsl), so the road is
  // as wide as the sea is rough. Specular anti-aliasing (Kaplanyan & Hoffman 2016): the normal's
  // change across the pixel counts as roughness too, so sub-pixel ripples don't flicker.
  float flatK = 1.0 - 0.7 * far;
  float mssTotal = vSlopeVar.x + capMss;
  float mssDrawn = (vSlopeVar.y + det.z) * flatK * flatK;
  // (Derivatives outside the branches below: they need all pixels of a 2×2 quad.)
  vec3 dNx = dFdx(N);
  vec3 dNy = dFdy(N);
  float kv = min(0.5 * (dot(dNx, dNx) + dot(dNy, dNy)), 0.08);
  float sigmaSq = min(0.5 * max(mssTotal - mssDrawn, 2e-4) + kv, 0.5 * mssTotal);
  // Further out the waves are no longer drawn: the road is statistical, with the crests' dashes,
  // as on the open sea beyond (farSea.glsl, the same lobe). Each part is computed only where it
  // shows; the BRDF itself stops early outside the lobe (most of the sea).
  float sigma = seaRoughness(uWaveStrength);
  float roadFar = smoothstep(120.0, 450.0, dist);
  vec3 glint = vec3(0.0);
  if (roadFar < 1.0 && uGlintDir.y >= 0.0) {
    vec3 Lg = glintAim(reflect(-V, N), uGlintDir, uGlintSize);
    float brdf = glitterBRDF(Lg, V, N, sigmaSq);
    if (brdf > 0.0) {
      // Facets glinting in this pixel: the mean over (Fresnel × the light's disc, π r² sr) ×
      // facets in the footprint. A night exposure is longer: more facets per frame, a calmer path.
      vec3 Hg = normalize(Lg + V);
      float fH = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hg), 0.0), 5.0);
      float lam = brdf * 3.14159 * uGlintSize * uGlintSize / fH * (footA / GLINT_FACET) * mix(1.0, 6.0, uNight);
      // Cells of about one pixel, laid out along the footprint, so sparkles stay pixel-sized.
      vec2 qc = xz - cameraPosition.xz;
      vec2 cell = floor(vec2(dot(qc, ex) / max(dot(ex, ex), 1e-12), dot(qc, ey) / max(dot(ey, ey), 1e-12)));
      glint = uGlintColor * brdf * GLINT_IRRADIANCE * glintSparkle(lam, cell, t) * (1.0 - roadFar);
    }
  }
  if (roadFar > 0.0) glint += farGlint(-V, sigma, t) * roadFar;
  glint *= 1.0 - vCloudShadow;
  // Glint fades in with water thickness so the waterline blends into the sand.
  float glintMask = 1.0;

#ifdef REFRACTION
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  float surfaceZ = perspectiveDepthToViewZ(gl_FragCoord.z, uCameraNear, uCameraFar);
  float sceneZ = perspectiveDepthToViewZ(texture2D(uSceneDepth, screenUV).x, uCameraNear, uCameraFar);
  // The capture is half resolution without MSAA. Right next to something standing in the water
  // (a rock, a stilt, the kayak) its texel can belong to that object, which lies in front of the
  // surface: the water there would show the object's colour as a bright or dark rim. Look one
  // capture texel around for a sample that really lies behind the water and use that instead.
  if (sceneZ > surfaceZ - 0.02) {
    vec2 px = 2.0 / uResolution;
    vec2 offs[4];
    offs[0] = vec2(px.x, 0.0);
    offs[1] = vec2(-px.x, 0.0);
    offs[2] = vec2(0.0, px.y);
    offs[3] = vec2(0.0, -px.y);
    for (int i = 0; i < 4; i++) {
      vec2 uv = screenUV + offs[i];
      float z = perspectiveDepthToViewZ(texture2D(uSceneDepth, uv).x, uCameraNear, uCameraFar);
      if (z < surfaceZ - 0.02) {
        sceneZ = z;
        screenUV = uv;
        break;
      }
    }
  }
  // Distance the view ray travels under water (view-space Z is negative in front of the camera).
  float thickness = max(surfaceZ - sceneZ, 0.0);
  vec2 refrUV = screenUV + N.xz * 0.04 * clamp(thickness / 3.0, 0.0, 1.0);
  float refrZ = perspectiveDepthToViewZ(texture2D(uSceneDepth, refrUV).x, uCameraNear, uCameraFar);
  // If the distorted sample lands on something above the water, fall back to the straight one.
  if (refrZ > surfaceZ) refrUV = screenUV;
  vec3 behind = texture2D(uSceneColor, refrUV).rgb;
  // Turquoise tint grows quickly, then deep blue takes over.
  vec3 tint = mix(vec3(1.0), uShallowColor * 1.8, 1.0 - exp(-thickness * 0.6));
  // Clear tropical water: the reef shows through a few meters of it. Rescaled so it reaches
  // exactly 1 by ~35 m: deep seabed and "no seabed" look identical.
  float absorb = min(1.0, (1.0 - exp(-thickness * 0.1)) / 0.97);
  vec3 body = mix(behind * tint, deep, absorb);
  // Reflection fades in with water thickness so the waterline blends into the sand.
  float reflAmount = fres * smoothstep(0.0, 0.3, thickness);
  vec3 col = mix(body, refl, reflAmount);
  glintMask = smoothstep(0.0, 0.3, thickness);
  col = mix(col, faceGlow, vSurf.y * 0.3);
  col = mix(col, foamColor, foam);
  float alpha = 1.0;
#else
  float absorb = 1.0 - exp(-depth * 0.22);
  vec3 body = mix(shallow, deep, absorb);
  vec3 col = mix(body, refl, fres);
  col = mix(col, faceGlow, vSurf.y * 0.3);
  col = mix(col, foamColor, foam);
  // Opacity saturates faster than color, so deep water fully hides the end of the seabed patch.
  float alpha = mix(0.5, 1.0, 1.0 - exp(-depth * 0.6)) + fres * 0.3;
  alpha *= smoothstep(0.0, 0.1, depth);
  alpha = clamp(max(alpha, foam * 0.9), 0.0, 1.0);
#endif

  // Haze instead of three's one-colour fog: the far sea melts into the sky right over the
  // horizon in the direction you look (orange under a low sun, blue-lilac away from it),
  // before tone mapping like the sky dome, so it meets the open sea drawn there (farSea.glsl).
  // The glint shines through it.
  float haze = 0.0;
#ifdef USE_FOG
  haze = smoothstep(fogNear, fogFar, vFogDepth) * FAR_SEA_HAZE;
  if (haze > 0.0) col = mix(col, seaHaze(-V), haze);
#endif
  col += glint * glintMask * (1.0 - foam) * (1.0 - 0.4 * haze);
  gl_FragColor = vec4(col, alpha);

  #include <tonemapping_fragment>
  // The low sun's road in the disc's own colour, after tone mapping like the disc (sky.frag).
  vec3 road = roadFar > 0.0 ? sunRoadDisplay(-V, sigma, t) * roadFar * glintMask * (1.0 - foam) * (1.0 - vCloudShadow) * (1.0 - 0.4 * haze) : vec3(0.0);
  gl_FragColor.rgb = 1.0 - (1.0 - gl_FragColor.rgb) * (1.0 - road);
  #include <colorspace_fragment>
}
