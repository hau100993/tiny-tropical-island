// Caustics after Evan Wallace's WebGL Water (MIT): every vertex of a fine grid is a ray of
// sunlight. We refract it through the water surface, follow it down to the seabed, and draw
// the grid at the landing points. Where rays converge, triangles shrink and get brighter.
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCausticStrength;

varying vec2 vOldPos;
varying vec2 vNewPos;
varying float vDepth;

void main() {
  vec2 xz = position.xz;
  vec4 sim = sampleSim(xz);
  // Ripples are amplified here: at island scale, visible caustics need stronger curvature
  // than the subtle shading ripples on the surface.
  vec2 grad = rippleGradient(xz, uTime) * uCausticStrength + sim.yz * sim.w * 4.0;
  vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
  vec3 ray = refract(-uSunDir, n, 1.0 / 1.333);
  float depth = max(-terrainHeight(xz), 0.0);
  vec2 landing = xz + ray.xz * (depth / max(-ray.y, 0.2));
  vOldPos = xz;
  vNewPos = landing;
  vDepth = depth;
  // Caustics texture covers the simulation square: map [-size/2, size/2] to clip space.
  gl_Position = vec4(landing / uSimSize * 2.0, 0.0, 1.0);
}
