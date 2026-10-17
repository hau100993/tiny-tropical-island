// Terrain height lookup shared by the water vertex and fragment shaders.
uniform sampler2D uTerrainHeight;
uniform float uTerrainSize;
uniform float uTerrainRes;

float terrainHeight(vec2 xz) {
  vec2 uv = xz / uTerrainSize + 0.5;
  // Must match OUTSIDE_HEIGHT in heightmap.ts.
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -30.0;
  // Map grid vertices onto texel centers so the texture matches the CPU heightmap.
  uv = (uv * (uTerrainRes - 1.0) + 0.5) / uTerrainRes;
  return texture2D(uTerrainHeight, uv).r;
}

// Small directional ripples (not part of the geometry). Returns the surface gradient
// (dh/dx, dh/dz). Used for per-pixel water shading and, amplified, to drive caustics.
vec2 ripple(vec2 p, float t, vec2 dir, float k, float slope, float omega) {
  return dir * slope * cos(dot(dir, p) * k - omega * t);
}

vec2 rippleGradient(vec2 p, float t) {
  vec2 g = ripple(p, t, vec2(0.96, 0.28), 1.30, 0.020, 1.5);
  g += ripple(p, t, vec2(-0.45, 0.89), 1.85, 0.016, 1.9);
  g += ripple(p, t, vec2(0.62, -0.78), 2.60, 0.012, 2.3);
  g += ripple(p, t, vec2(-0.91, -0.41), 3.70, 0.008, 2.8);
  return g;
}

// Water simulation lookup (see WaterSim.ts). Texel: r = height, g = velocity, ba = gradient.
uniform sampler2D uSim;
uniform float uSimSize;
uniform float uSimEnabled;

// Returns (height, gradX, gradZ, weight); weight fades to 0 at the region edges.
vec4 sampleSim(vec2 xz) {
  vec2 uv = xz / uSimSize + 0.5;
  vec2 e = abs(uv - 0.5) * 2.0;
  float w = uSimEnabled * (1.0 - smoothstep(0.8, 0.98, max(e.x, e.y)));
  if (w <= 0.0) return vec4(0.0);
  vec4 s = texture2D(uSim, uv);
  return vec4(s.r, s.b, s.a, w);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
