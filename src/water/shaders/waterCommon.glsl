// Terrain height lookup shared by the water vertex and fragment shaders.
uniform sampler2D uTerrainHeight;
uniform float uTerrainSize;
uniform float uTerrainRes;

float terrainHeight(vec2 xz) {
  vec2 uv = xz / uTerrainSize + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -12.0;
  // Map grid vertices onto texel centers so the texture matches the CPU heightmap.
  uv = (uv * (uTerrainRes - 1.0) + 0.5) / uTerrainRes;
  return texture2D(uTerrainHeight, uv).r;
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
