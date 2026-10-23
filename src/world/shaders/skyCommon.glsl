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
/** Sun disc brightness and size multipliers (1 = normal). */
uniform float uSunBright;
uniform float uSunSize;

// The sun disc's angular radius (radians); must match SUN_RADIUS in celestial.ts.
float sunRadius() {
  return 0.0265 * uSunSize;
}

// The sun disc's colour by its height, in display colours (it is drawn after tone mapping):
// deep orange-red on the sea, golden a little higher, near white high up; mornings a touch
// more yellow.
vec3 sunDiscBase(float se) {
  vec3 base = mix(vec3(1.0, 0.5, 0.13), vec3(1.0, 0.7, 0.26), smoothstep(0.0, 0.08, se));
  base = mix(base, vec3(1.0, 0.8, 0.45), smoothstep(0.08, 0.2, se));
  base = mix(base, vec3(1.0, 0.97, 0.9), smoothstep(0.2, 0.4, se));
  base = mix(base, base * vec3(1.0, 1.12, 1.3), 0.35 * uDawn * (1.0 - smoothstep(0.2, 0.4, se)));
  return min(base, vec3(1.0));
}

// The disc colour with the brightness setting: dimmer is darker; brighter pushes it toward
// white (display colours can't exceed 1, so the excess bleeds into the other channels, like
// real overexposure). `over` says how far it is burnt out.
vec3 sunDiscExposed(vec3 base, out float over) {
  vec3 lifted = base * uSunBright;
  over = max(max(lifted.r, max(lifted.g, lifted.b)) - 1.0, 0.0);
  return min(lifted + over * 0.6, vec3(1.0));
}

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
  // A low sun has little halo of its own in the sky (its glare is drawn with the disc, after
  // tone mapping); stacked glows made the sky around it brighter than the sun.
  float sunHalo = 1.0 - 0.65 * (1.0 - smoothstep(0.0, 0.25, abs(uSunDir.y)));
  col += uSunColor * (0.18 * pow(sd, 6.0) + 0.35 * pow(sd, 48.0)) * sunUp * sunHalo;

  // Twilight: a warm band along the horizon on the sun's side at dawn and dusk.
  vec2 hd = normalize(dir.xz + 1e-4);
  vec2 sh = normalize(uSunDir.xz + 1e-4);
  float twilight = 1.0 - smoothstep(0.0, 0.25, abs(uSunDir.y));
  float toward = dot(hd, sh);
  col += uSunColor * 0.18 * twilight * pow(max(toward, 0.0), 3.0) * exp(-h * 6.0);
  // The sunset/sunrise colours fan out from the sun: strongest over the horizon right below
  // it, fading sideways (gone ~90° away) and upward. Amber-orange in the evening, amber-peach
  // in the morning. The rest of the sky keeps its cool twilight blue and lilac.
  float sunSideUp = smoothstep(-0.08, 0.0, uSunDir.y);
  float fanAz = pow(max(toward, 0.0), 1.8);
  vec3 warm = mix(uSunColor, vec3(1.0, 0.6, 0.42), 0.35 * uDawn) * 0.95 + vec3(0.06, 0.04, 0.02);
  col = mix(col, warm * 0.8, twilight * mix(0.5, 1.0, sunSideUp) * fanAz * exp(-h * 2.2) * 0.85);

  // Opposite the sun, around and just after sunset (and before sunrise): Earth's shadow, a
  // dark blue band rising from the horizon as the sun sinks, topped by the pink "Belt of
  // Venus" (sky still lit by the reddened sun, seen through the shadowed air).
  float anti = pow(max(-toward, 0.0), 1.5);
  float venus = (1.0 - smoothstep(0.0, 0.06, uSunDir.y)) * smoothstep(-0.17, -0.07, uSunDir.y);
  float shadowTop = 0.01 + max(-uSunDir.y, 0.0) * 0.8;
  float inShadow = 1.0 - smoothstep(shadowTop - 0.012, shadowTop + 0.012, h);
  col = mix(col, col * vec3(0.55, 0.6, 0.85), anti * venus * inShadow * 0.65);
  float belt = exp(-pow((h - shadowTop - 0.045) / 0.045, 2.0));
  col += vec3(0.95, 0.5, 0.58) * 0.18 * belt * anti * venus;

  // Haze over the horizon: bright and warm toward the sun, cool and grey-blue away from it,
  // by day as well (sunlight scattered by water vapour and salt over the sea).
  float haze = exp(-h * 9.0) * uDayLight;
  col += uSunColor * 0.12 * pow(max(toward, 0.0), 4.0) * haze * (1.0 - 0.6 * twilight);
  col = mix(col, vec3(0.62, 0.68, 0.76) * uDayLight, 0.12 * max(-toward, 0.0) * haze);
  // The ACES tone mapper turns bright twilight colours pastel; push their saturation back up
  // around sunrise and sunset, only while the sun is up or just touching the sea (in the blue
  // hour it would turn magenta).
  // Toward the sun only: the far side stays soft.
  float sat = 1.0 + twilight * 0.55 * smoothstep(-0.05, 0.01, uSunDir.y) * (0.15 + 0.85 * pow(max(toward, 0.0), 1.5));
  col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, sat), 0.0);

  // Sunrise: a soft pink-peach haze lies low over the sea.
  col = mix(col, vec3(0.95, 0.68, 0.6) * (0.25 + 0.75 * uDayLight), 0.2 * uDawn * twilight * exp(-h * 14.0) * (0.3 + 0.7 * max(toward, 0.0)));

  // Moon halo at night; a bright full moon (uMoonGlow) adds a wide soft glow, which the
  // sea's sky reflection turns into a silver path toward the moon.
  float md = max(dot(dir, uMoonDir), 0.0);
  float halo = (0.4 + 2.0 * uMoonGlow) * (0.05 * pow(md, 10.0) + 0.3 * pow(md, 300.0)) + 0.12 * uMoonGlow * pow(md, 3.0);
  col += vec3(0.55, 0.62, 0.85) * moonTint() * halo * uNight * step(0.0, uMoonDir.y);

  // Below the horizon: fade to a slightly darker horizon color.
  col = mix(col, uSkyHorizon * 0.85, 1.0 - smoothstep(-0.15, 0.0, dir.y));
  return col;
}
