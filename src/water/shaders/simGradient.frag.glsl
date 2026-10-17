// Stores the height gradient (dh/dx, dh/dz) in .ba, used for shading and caustics.
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uCell;

varying vec2 vUv;

void main() {
  vec4 info = texture2D(uState, vUv);
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);
  info.b = (texture2D(uState, vUv + dx).r - texture2D(uState, vUv - dx).r) / (2.0 * uCell);
  info.a = (texture2D(uState, vUv + dy).r - texture2D(uState, vUv - dy).r) / (2.0 * uCell);
  gl_FragColor = info;
}
