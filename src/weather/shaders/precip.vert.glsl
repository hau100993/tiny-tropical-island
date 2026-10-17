// Rain streaks / snowflakes computed entirely on the GPU. Each particle has a random seed;
// its position is a pure function of time, wrapped into a box around the camera with mod().
// Because the wrap is anchored in world space, particles don't follow the camera around.
attribute vec4 aSeed;   // xyz: position in the box (0..1), w: per-particle variation
attribute vec2 aCorner; // x: -0.5..0.5 across, y: 0..1 along

uniform float uTime;
uniform vec3 uBox;
uniform float uFall;
uniform vec2 uDrift;    // current horizontal wind velocity (m/s), for streak direction
uniform vec2 uOffset;   // accumulated wind drift (m); integrated on the CPU so gusts never jump
uniform vec2 uSize;     // width, length (rain) / diameter (snow)

varying vec2 vCorner;
varying float vFade;

void main() {
  float speed = uFall * (0.8 + 0.4 * aSeed.w);
  vec3 p = aSeed.xyz * uBox;
  p.y -= uTime * speed;
  p.xz += uOffset;
#ifdef SNOW
  // Flakes tumble: small looping wobble on top of the drift.
  p.x += sin(uTime * 0.9 + aSeed.w * 30.0) * 0.5;
  p.z += cos(uTime * 0.7 + aSeed.x * 40.0) * 0.5;
#endif
  vec3 origin = cameraPosition - uBox * 0.5;
  p = mod(p - origin, uBox) + origin;

  vec3 toCam = normalize(cameraPosition - p);
#ifdef SNOW
  // Camera-facing square.
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = cross(toCam, right);
  float size = uSize.x * (0.6 + 0.8 * aSeed.w);
  vec3 wp = p + (right * aCorner.x + up * (aCorner.y - 0.5)) * size;
#else
  // Streak along the fall direction, facing the camera across its width.
  vec3 vel = normalize(vec3(uDrift.x, -speed, uDrift.y));
  vec3 side = normalize(cross(vel, toCam));
  vec3 wp = p + side * aCorner.x * uSize.x + vel * (aCorner.y - 0.5) * uSize.y * (0.7 + 0.6 * aSeed.w);
#endif

  // Fade very close (no giant streaks across the screen) and near the box edges (no popping).
  float d = length(cameraPosition - p);
  vFade = smoothstep(0.6, 3.0, d) * (1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, d));
  vCorner = aCorner;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
