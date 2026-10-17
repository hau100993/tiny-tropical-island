varying vec3 vDir;

void main() {
  // The dome is centered on the camera, so the object-space position is the view direction.
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
