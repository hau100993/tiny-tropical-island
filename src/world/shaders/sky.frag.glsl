varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);
  // Sun disc with a soft edge.
  col += uSunColor * smoothstep(0.9994, 0.9998, dot(dir, uSunDir)) * 6.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
