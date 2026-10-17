uniform vec3 uColor;
uniform float uOpacity;
uniform float uDayLight;

varying vec2 vCorner;
varying float vFade;

void main() {
#ifdef SNOW
  // Soft round flake.
  float r = length(vec2(vCorner.x, vCorner.y - 0.5)) * 2.0;
  float a = 1.0 - smoothstep(0.35, 1.0, r);
#else
  // Thin streak, brightest in the middle, tapered at both ends.
  float a = (1.0 - abs(vCorner.x) * 2.0) * smoothstep(0.0, 0.35, vCorner.y) * (1.0 - smoothstep(0.65, 1.0, vCorner.y));
#endif
  a *= uOpacity * vFade;
  if (a < 0.003) discard;
  // Drops and flakes only show the light that falls on them: dim at night.
  gl_FragColor = vec4(uColor * (0.2 + 0.8 * uDayLight), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
