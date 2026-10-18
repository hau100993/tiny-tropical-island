// Swash: the thin sheet of water each wave pushes up the beach, then drains back. Shared by
// the water surface (it really rises and falls near the shore, so the waterline moves), the
// surf foam, and the wet sand on the terrain, so all three stay in step.
//
// Each stretch of beach (~12 m) has its own timing, and every wave its own size (some waves
// of a set run up much further), so the waterline never repeats the same shape.

const float SWASH_PERIOD = 9.0;

float swHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float swNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(swHash(i), swHash(i + vec2(1.0, 0.0)), u.x), mix(swHash(i + vec2(0.0, 1.0)), swHash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Run-up height of wave number `cycle` at this spot (m above sea level).
float swashAmp(vec2 xz, float cycle, float strength) {
  return (0.04 + 0.24 * swNoise(xz * 0.03 + vec2(cycle * 1.7, 3.3))) * (0.35 + strength);
}

// x: water level above sea level here and now (m);
// y: highest level the water reached recently (the wet sand stays dark up to there);
// z: 1 while the wave front is running up the beach (thick foam), 0 while it drains back.
vec3 swash(vec2 xz, float t, float strength) {
  float c = t / SWASH_PERIOD + swNoise(xz * 0.08 + 7.3);
  float cycle = floor(c);
  float s = c - cycle;
  float amp = swashAmp(xz, cycle, strength);
  float prev = swashAmp(xz, cycle - 1.0, strength);
  // Fast run-up (~2 s), slow backwash (~7 s). Both ends are 0, so a new wave (with a new size,
  // possibly in a neighboring stretch on a different cycle) never makes the level jump.
  float up = smoothstep(0.0, 0.22, s);
  float down = 1.0 - smoothstep(0.22, 0.97, s);
  // A little lumpiness along the front so the edge is never a clean contour line.
  float lump = 1.0 + (swNoise(xz * 0.55 + vec2(t * 0.12, -t * 0.07)) - 0.5) * 0.35;
  float level = amp * up * down * lump;
  float wet = mix(prev, amp, up) * lump;
  float rising = up * (1.0 - smoothstep(0.18, 0.32, s));
  return vec3(level, wet, rising);
}
