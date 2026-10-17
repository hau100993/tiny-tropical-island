// Adds up to MAX_DROPS circular bumps to the height field (after Evan Wallace's WebGL Water, MIT).
uniform sampler2D uState;
uniform vec4 uDrops[MAX_DROPS]; // world x, world z, radius (m), strength (m)
uniform int uDropCount;

varying vec2 vUv;

void main() {
  vec4 info = texture2D(uState, vUv);
  vec2 world = (vUv - 0.5) * uSimSize;
  for (int i = 0; i < MAX_DROPS; i++) {
    if (i >= uDropCount) break;
    vec4 d = uDrops[i];
    float x = max(0.0, 1.0 - length(d.xy - world) / d.z);
    // Smooth cosine bump: 0 at the rim, 1 at the center.
    info.r += (0.5 - cos(x * 3.14159265) * 0.5) * d.w;
  }
  gl_FragColor = info;
}
