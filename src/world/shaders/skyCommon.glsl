// Shared sky model, used by the sky dome and by the water's reflection lookup,
// so the sea always reflects exactly the sky you see.
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;

vec3 skyColor(vec3 dir) {
  float h = max(dir.y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));
  float sd = max(dot(dir, uSunDir), 0.0);
  // Broad haze around the sun plus a tighter glow.
  col += uSunColor * (0.18 * pow(sd, 6.0) + 0.35 * pow(sd, 48.0));
  // Below the horizon: fade to a slightly darker horizon color.
  col = mix(col, uSkyHorizon * 0.85, 1.0 - smoothstep(-0.15, 0.0, dir.y));
  return col;
}
