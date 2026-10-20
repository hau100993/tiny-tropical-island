// Shared sky model, used by the sky dome and by the water's reflection lookup,
// so the sea always reflects the sky you see (including twilight glow and moonlight).
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonDir;
uniform float uNight;
uniform float uMoonGlow;
uniform float uDawn;
uniform float uDayLight;

// The moon's color by its height: low over the horizon its light crosses much more air and
// turns orange (like a sunset), high up it is silver-white.
vec3 moonTint() {
  return mix(vec3(1.0, 0.55, 0.26), vec3(1.0), smoothstep(0.03, 0.38, uMoonDir.y));
}

vec3 skyColor(vec3 dir) {
  float h = max(dir.y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(h, 0.55));

  // Glow around the sun (only while it is near or above the horizon).
  float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
  float sd = max(dot(dir, uSunDir), 0.0);
  // A sunrise sun through clean morning air has little halo (a crisp disc).
  float sunHalo = 1.0 - 0.5 * uDawn * (1.0 - smoothstep(0.0, 0.25, abs(uSunDir.y)));
  col += uSunColor * (0.18 * pow(sd, 6.0) + 0.35 * pow(sd, 48.0)) * sunUp * sunHalo;

  // Twilight: a warm band along the horizon on the sun's side at dawn and dusk.
  vec2 hd = normalize(dir.xz + 1e-4);
  vec2 sh = normalize(uSunDir.xz + 1e-4);
  float twilight = 1.0 - smoothstep(0.0, 0.25, abs(uSunDir.y));
  float toward = dot(hd, sh);
  col += uSunColor * 0.35 * twilight * pow(max(toward, 0.0), 3.0) * exp(-h * 6.0);
  // A wider, softer warm glow fanning out over the sun's half of the sky at dusk and dawn.
  col += uSunColor * 0.14 * twilight * pow(max(toward, 0.0), 1.5) * exp(-h * 4.5);

  // Opposite the sun, around and just after sunset (and before sunrise): Earth's shadow, a
  // dark blue band rising from the horizon as the sun sinks, topped by the pink "Belt of
  // Venus" (sky still lit by the reddened sun, seen through the shadowed air).
  float anti = pow(max(-toward, 0.0), 1.5);
  float venus = (1.0 - smoothstep(0.0, 0.06, uSunDir.y)) * smoothstep(-0.17, -0.07, uSunDir.y);
  float shadowTop = 0.01 + max(-uSunDir.y, 0.0) * 0.8;
  float inShadow = 1.0 - smoothstep(shadowTop - 0.012, shadowTop + 0.012, h);
  col = mix(col, col * vec3(0.55, 0.6, 0.85), anti * venus * inShadow * 0.65);
  float belt = exp(-pow((h - shadowTop - 0.045) / 0.045, 2.0));
  col += vec3(0.95, 0.5, 0.58) * 0.32 * belt * anti * venus;

  // Haze over the horizon: bright and warm toward the sun, cool and grey-blue away from it,
  // by day as well (sunlight scattered by water vapour and salt over the sea).
  float haze = exp(-h * 9.0) * uDayLight;
  col += uSunColor * 0.12 * pow(max(toward, 0.0), 4.0) * haze;
  col = mix(col, vec3(0.62, 0.68, 0.76) * uDayLight, 0.12 * max(-toward, 0.0) * haze);
  // The ACES tone mapper turns bright twilight colours pastel; push their saturation back up
  // around sunrise and sunset, only while the sun is up or just touching the sea (in the blue
  // hour it would turn magenta).
  float sat = 1.0 + twilight * 0.55 * smoothstep(-0.05, 0.01, uSunDir.y);
  col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, sat), 0.0);

  // Sunrise: a soft pink-peach haze lies low over the sea.
  col = mix(col, vec3(0.95, 0.68, 0.6) * (0.25 + 0.75 * uDayLight), 0.2 * uDawn * twilight * exp(-h * 14.0));

  // Moon halo at night; a bright full moon (uMoonGlow) adds a wide soft glow, which the
  // sea's sky reflection turns into a silver path toward the moon.
  float md = max(dot(dir, uMoonDir), 0.0);
  float halo = (0.4 + 2.0 * uMoonGlow) * (0.05 * pow(md, 10.0) + 0.3 * pow(md, 300.0)) + 0.12 * uMoonGlow * pow(md, 3.0);
  col += vec3(0.55, 0.62, 0.85) * moonTint() * halo * uNight * step(0.0, uMoonDir.y);

  // Below the horizon: fade to a slightly darker horizon color.
  col = mix(col, uSkyHorizon * 0.85, 1.0 - smoothstep(-0.15, 0.0, dir.y));
  return col;
}
