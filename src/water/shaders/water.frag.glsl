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

  // Shore foam: bands that wash toward the beach, broken up by noise.
  float n = valueNoise(xz * 0.9 + vec2(t * 0.15, -t * 0.1));
  float n2 = valueNoise(xz * 3.1 - vec2(t * 0.3, t * 0.2));
  float shore = 1.0 - smoothstep(0.0, 0.45, depth);
  float wash = 0.5 + 0.5 * sin(depth * 14.0 - t * 1.4 + n * 3.0);
  float foam = shore * smoothstep(0.55, 0.85, wash * 0.65 + n2 * 0.45);
  foam += (1.0 - smoothstep(0.0, 0.06, depth)) * 0.7;
  foam += smoothstep(0.55, 0.95, vCrest) * smoothstep(0.5, 1.0, uWaveStrength) * n2;
  // A little white water on strong ripples (splashes).
  foam += smoothstep(0.06, 0.2, sim.x) * sim.w * 0.6 * (0.4 + n2);
  foam = clamp(foam, 0.0, 1.0);
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
