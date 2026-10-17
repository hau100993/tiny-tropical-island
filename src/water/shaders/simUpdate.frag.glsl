// One step of the discrete 2D wave equation (after Evan Wallace's WebGL Water, MIT).
// Each texel accelerates toward the average of its 4 neighbors; uK = 4·C² where
// C = waveSpeed·dt/cellSize is the Courant number (stable while uK <= 2).
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uK;
uniform float uDamping;

varying vec2 vUv;

void main() {
  vec4 info = texture2D(uState, vUv);
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);
  float avg = (texture2D(uState, vUv - dx).r + texture2D(uState, vUv + dx).r +
               texture2D(uState, vUv - dy).r + texture2D(uState, vUv + dy).r) * 0.25;
  info.g += (avg - info.r) * uK;
  info.g *= uDamping;

  // Absorb waves near the square's edges so they don't bounce back from an invisible wall.
  vec2 e = abs(vUv - 0.5) * 2.0;
  float edge = smoothstep(0.85, 1.0, max(e.x, e.y));
  info.g *= 1.0 - edge * 0.2;
  info.r += info.g;
  info.r *= 1.0 - edge * 0.1;

  // Land is a fixed boundary: ripples reflect off the beach.
  if (terrainHeight((vUv - 0.5) * uSimSize) > -0.02) info.rg = vec2(0.0);
  gl_FragColor = info;
}
