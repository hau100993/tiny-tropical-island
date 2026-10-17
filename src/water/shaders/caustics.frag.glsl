// Light intensity = original triangle area / refracted triangle area (screen-space
// derivatives give the area per pixel). Additive blending sums overlapping triangles.
varying vec2 vOldPos;
varying vec2 vNewPos;
varying float vDepth;

void main() {
  float oldArea = length(dFdx(vOldPos)) * length(dFdy(vOldPos));
  float newArea = length(dFdx(vNewPos)) * length(dFdy(vNewPos));
  float intensity = min(oldArea / max(newArea, 1e-6), 6.0);
  // No caustics on land (depth 0); they would never be seen anyway.
  intensity *= step(0.01, vDepth);
  gl_FragColor = vec4(intensity, intensity, intensity, 1.0);
}
