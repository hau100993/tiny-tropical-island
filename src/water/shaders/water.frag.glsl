// Phase 1a water shading: Fresnel blend of sky reflection and a depth-tinted body color.
// Transparency over the (real) seabed stands in for refraction until Phase 1b.
uniform float uTime;
uniform float uWaveStrength;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vCrest;

#include <fog_pars_fragment>

void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 xz = vWorldPos.xz;

  // Small moving ripples on top of the big waves, faded with distance to avoid shimmer.
  float t = uTime;
  vec2 g = vec2(cos(xz.x * 1.7 + t * 1.9 + xz.y * 0.6), cos(xz.y * 1.9 - t * 1.6 + xz.x * 0.4)) * 0.025
         + vec2(cos(xz.x * 3.9 - t * 2.7 + xz.y * 1.3), cos(xz.y * 4.3 + t * 2.2 - xz.x * 0.9)) * 0.015;
  g *= (0.4 + uWaveStrength) * (1.0 - smoothstep(40.0, 160.0, dist));
  vec3 N = normalize(vNormalW + vec3(g.x, 0.0, g.y));

  float depth = max(vWorldPos.y - terrainHeight(xz), 0.0);

  // Fresnel (Schlick, water F0 ≈ 0.02): grazing angles reflect more sky.
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);

  // Light absorption: shallow water is turquoise, deep water dark blue.
  float absorb = 1.0 - exp(-depth * 0.22);
  vec3 body = mix(uShallowColor, uDeepColor, absorb);

  vec3 H = normalize(V + uSunDir);
  float spec = pow(max(dot(N, H), 0.0), 350.0) * 3.0;
  vec3 col = mix(body, refl, fres) + uSunColor * spec;

  // Shore foam: bands that wash toward the beach, broken up by noise.
  float n = valueNoise(xz * 0.9 + vec2(t * 0.15, -t * 0.1));
  float n2 = valueNoise(xz * 3.1 - vec2(t * 0.3, t * 0.2));
  float shore = 1.0 - smoothstep(0.0, 0.45, depth);
  float wash = 0.5 + 0.5 * sin(depth * 14.0 - t * 1.4 + n * 3.0);
  float foam = shore * smoothstep(0.55, 0.85, wash * 0.65 + n2 * 0.45);
  foam += (1.0 - smoothstep(0.0, 0.06, depth)) * 0.7;
  // Crest foam in rough seas.
  foam += smoothstep(0.55, 0.95, vCrest) * smoothstep(0.5, 1.0, uWaveStrength) * n2;
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(0.92, 0.96, 0.97), foam);

  // Opacity saturates faster than color, so deep water fully hides the end of the seabed patch.
  float alpha = mix(0.5, 1.0, 1.0 - exp(-depth * 0.6)) + fres * 0.3;
  alpha *= smoothstep(0.0, 0.1, depth);
  alpha = clamp(max(alpha, foam * 0.9), 0.0, 1.0);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
