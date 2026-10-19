// Shared sky model, used by the sky dome and by the water's reflection lookup,
// so the sea always reflects the sky you see (including twilight glow and moonlight).
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uMoonGlow;

vec3 skyColor(vec3 dir) {
  float h = max(dir.y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));

  // Glow around the sun (only while it is near or above the horizon).
  float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * (0.18 * pow(sd, 6.0) + 0.35 * pow(sd, 48.0)) * sunUp;

  // Twilight: a warm band along the horizon on the sun's side at dawn and dusk.
  vec2 hd = normalize(dir.xz + 1e-4);
  vec2 sh = normalize(uSunDir.xz + 1e-4);
  float twilight = 1.0 - smoothstep(0.0, 0.25, abs(uSunDir.y));
  col += uSunColor * 0.35 * twilight * pow(max(dot(hd, sh), 0.0), 3.0) * exp(-h * 6.0);

  // Moon halo at night; a bright full moon (uMoonGlow) adds a wide soft glow, which the
  // sea's sky reflection turns into a silver path toward the moon.
  float md = max(dot(dir, uMoonDir), 0.0);
  float halo = (0.4 + 2.0 * uMoonGlow) * (0.05 * pow(md, 10.0) + 0.3 * pow(md, 300.0)) + 0.12 * uMoonGlow * pow(md, 3.0);
  col += vec3(0.55, 0.62, 0.85) * halo * uNight * step(0.0, uMoonDir.y);

  // Below the horizon: fade to a slightly darker horizon color.
  col = mix(col, uSkyHorizon * 0.85, 1.0 - smoothstep(-0.15, 0.0, dir.y));
  return col;
}
