// Water shading: Fresnel blend of sky reflection and the water body.
// REFRACTION: the body is the captured scene behind the surface, distorted by the normal and
// tinted by how much water the view ray crosses. Otherwise: alpha blending over the seabed.
uniform float uTime;
uniform float uWaveStrength;
uniform float uRain;
uniform float uDayLight;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;

#ifdef REFRACTION
uniform sampler2D uSceneColor;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
#include <packing>
#endif

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vCrest;
varying float vCloudShadow;

#include <fog_pars_fragment>

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
  // Rain pitting: fine, fast-changing roughness (the sim adds the bigger splash rings).
  if (uRain > 0.001) {
    vec2 rp = xz * 3.3;
    vec2 pit = vec2(valueNoise(rp + vec2(t * 7.1, 0.0)), valueNoise(rp + vec2(13.7, -t * 6.3))) - 0.5;
    g += pit * 0.22 * uRain * (1.0 - smoothstep(30.0, 120.0, dist));
  }
  vec3 N = normalize(vNormalW + vec3(-g.x, 0.0, -g.y));
  // Far away, many steep wave facets per pixel average out to a flatter surface; without this
  // the sun glint and reflections turn into blocky blobs when seen from high above.
  float far = smoothstep(80.0, 400.0, dist);
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), far * 0.7));

  float depth = max(vWorldPos.y - terrainHeight(xz), 0.0);

  // Fresnel (Schlick, water F0 ≈ 0.02): grazing angles reflect more sky.
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);

  // Shore foam. "coverage" says how much foam there should be; the lace pattern then decides
  // where: thin coverage leaves scattered bubbles, thick coverage solid white water.
  float n = valueNoise(xz * 0.9 + vec2(t * 0.15, -t * 0.1));
  float n2 = valueNoise(xz * 3.1 - vec2(t * 0.3, t * 0.2));
  // Distances to the shore wander with noise, so foam lines never trace the depth contour.
  float wd = depth + (valueNoise(xz * 0.35 + vec2(t * 0.04, -t * 0.03)) - 0.5) * 0.25 + (n2 - 0.5) * 0.1;
  // Each stretch of coast surges on its own timing (same phase field as the wet sand).
  float phase = valueNoise(xz * 0.08 + 7.3) * 6.2831;
  float surge = 0.5 + 0.5 * sin(t * 0.7 + phase);
  float sea = 0.5 + uWaveStrength;
  // Breaking bands rolling in toward the beach, broken into segments along the shore.
  float bands = 0.5 + 0.5 * sin(wd * 9.0 - t * 1.3 + phase + n * 2.5);
  float segs = smoothstep(0.25, 0.7, valueNoise(xz * 0.22 + vec2(t * 0.05, 0.0)));
  float coverage = (1.0 - smoothstep(0.0, (0.2 + 0.3 * surge) * sea, wd)) * smoothstep(0.55, 0.95, bands) * (0.3 + 0.6 * segs);
  // Swash rim at the water's edge: its width surges with the waves and varies along the shore.
  coverage = max(coverage, 0.95 * (1.0 - smoothstep(0.0, (0.02 + 0.09 * surge * segs) * sea, wd)));
  coverage += smoothstep(0.55, 0.95, vCrest) * smoothstep(0.5, 1.0, uWaveStrength) * n2;
  // A little white water on strong ripples (splashes).
  coverage += smoothstep(0.06, 0.2, sim.x) * sim.w * 0.6 * (0.4 + n2);
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
  float lit = uDayLight * (1.0 - 0.55 * vCloudShadow);
  vec3 deep = uDeepColor * lit;
  vec3 shallow = uShallowColor * lit;

  // Glint of the main light (sun, or the moon's silver path at night); widens and dims with
  // distance like a rougher surface. No glint under a cloud.
  vec3 H = normalize(V + uLightDir);
  float spec = pow(max(dot(N, H), 0.0), mix(350.0, 120.0, far)) * mix(3.0, 0.5, far) * step(0.0, uLightDir.y);
  spec *= 1.0 - vCloudShadow;

#ifdef REFRACTION
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  float surfaceZ = perspectiveDepthToViewZ(gl_FragCoord.z, uCameraNear, uCameraFar);
  float sceneZ = perspectiveDepthToViewZ(texture2D(uSceneDepth, screenUV).x, uCameraNear, uCameraFar);
  // Distance the view ray travels under water (view-space Z is negative in front of the camera).
  float thickness = max(surfaceZ - sceneZ, 0.0);
  vec2 refrUV = screenUV + N.xz * 0.04 * clamp(thickness / 3.0, 0.0, 1.0);
  float refrZ = perspectiveDepthToViewZ(texture2D(uSceneDepth, refrUV).x, uCameraNear, uCameraFar);
  // If the distorted sample lands on something above the water, fall back to the straight one.
  if (refrZ > surfaceZ) refrUV = screenUV;
  vec3 behind = texture2D(uSceneColor, refrUV).rgb;
  // Turquoise tint grows quickly, then deep blue takes over.
  vec3 tint = mix(vec3(1.0), uShallowColor * 1.8, 1.0 - exp(-thickness * 0.6));
  // Rescaled so it reaches exactly 1 by ~25 m: deep seabed and "no seabed" look identical.
  float absorb = min(1.0, (1.0 - exp(-thickness * 0.14)) / 0.97);
  vec3 body = mix(behind * tint, deep, absorb);
  // Reflection fades in with water thickness so the waterline blends into the sand.
  float reflAmount = fres * smoothstep(0.0, 0.3, thickness);
  vec3 col = mix(body, refl, reflAmount) + uLightColor * spec * smoothstep(0.0, 0.3, thickness);
  col = mix(col, foamColor, foam);
  gl_FragColor = vec4(col, 1.0);
#else
  float absorb = 1.0 - exp(-depth * 0.22);
  vec3 body = mix(shallow, deep, absorb);
  vec3 col = mix(body, refl, fres) + uLightColor * spec;
  col = mix(col, foamColor, foam);
  // Opacity saturates faster than color, so deep water fully hides the end of the seabed patch.
  float alpha = mix(0.5, 1.0, 1.0 - exp(-depth * 0.6)) + fres * 0.3;
  alpha *= smoothstep(0.0, 0.1, depth);
  alpha = clamp(max(alpha, foam * 0.9), 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
#endif

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
