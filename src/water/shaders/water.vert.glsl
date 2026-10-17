// Gerstner waves (GPU Gems 1, ch. 1). Each wave displaces points along a circle, so
// vertices bunch up at crests. Normals are computed analytically from the same sum.
uniform float uTime;
uniform float uWaveStrength;
uniform vec4 uWaveA[NUM_WAVES]; // dir.x, dir.z, k, amplitude
uniform vec4 uWaveB[NUM_WAVES]; // omega, Q, phase, unused

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vCrest;

#include <fog_pars_vertex>

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;
  float depth = -terrainHeight(p);
  float dist = length(p - cameraPosition.xz);
  // Must match waveAttenuation() in gerstner.ts.
  float atten = uWaveStrength * smoothstep(-0.2, 3.0, depth) * (1.0 - smoothstep(450.0, 1300.0, dist));

  vec3 disp = vec3(0.0);
  float nx = 0.0;
  float nz = 0.0;
  float ny = 0.0;
  float ampSum = 0.0;
  for (int i = 0; i < NUM_WAVES; i++) {
    vec2 D = uWaveA[i].xy;
    float k = uWaveA[i].z;
    // Short waves fade out sooner with distance (fade starts at ~12 wavelengths): prevents moiré.
    float lambda = 6.2831853 / k;
    float A = uWaveA[i].w * atten * (1.0 - smoothstep(lambda * 12.0, lambda * 40.0, dist));
    float Q = uWaveB[i].y;
    float f = k * dot(D, p) - uWaveB[i].x * uTime + uWaveB[i].z;
    float c = cos(f);
    float s = sin(f);
    disp.x += Q * A * D.x * c;
    disp.z += Q * A * D.y * c;
    disp.y += A * s;
    float wa = k * A;
    nx += D.x * wa * c;
    nz += D.y * wa * c;
    ny += Q * wa * s;
    ampSum += A;
  }
  wp.xyz += disp;
  // Ripples from the GPU simulation, on top of the swell.
  vec4 sim = sampleSim(p);
  wp.y += sim.x * sim.w;
  vWorldPos = wp.xyz;
  vNormalW = normalize(vec3(-nx, 1.0 - ny, -nz));
  vCrest = ampSum > 0.0 ? disp.y / ampSum : 0.0;

  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
