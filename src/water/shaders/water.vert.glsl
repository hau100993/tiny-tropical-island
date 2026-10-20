// Gerstner waves (GPU Gems 1, ch. 1). Each wave displaces points along a circle, so
// vertices bunch up at crests. Normals are computed analytically from the same sum.
uniform float uTime;
uniform float uWaveStrength;
uniform float uSurfLevel;
uniform vec4 uWaveA[NUM_WAVES]; // dir.x, dir.z, k, amplitude
uniform vec4 uWaveB[NUM_WAVES]; // omega, Q, phase, unused

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vCrest;
varying float vCloudShadow;
varying vec2 vSwash; // x: wave front running up (0..1), y: near-shore weight
varying vec3 vSurf; // surf break: foam coverage, lit face, broken
uniform vec3 uSunDir;
#ifdef REFLECTION
uniform mat4 uReflectMatrix;
varying vec4 vReflCoord;
#endif

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
  // The surf break (see surf.ts): its height on top, its slopes into the normal.
  vec4 sf = surfWave(p, uTime, depth, uSurfLevel);
  vSurf = sf.yzw;
  if (sf.x != 0.0) {
    const float e = 0.4;
    vec2 ex = vec2(e, 0.0);
    vec2 ez = vec2(0.0, e);
    float hx = surfWave(p + ex, uTime, -terrainHeight(p + ex), uSurfLevel).x - surfWave(p - ex, uTime, -terrainHeight(p - ex), uSurfLevel).x;
    float hz = surfWave(p + ez, uTime, -terrainHeight(p + ez), uSurfLevel).x - surfWave(p - ez, uTime, -terrainHeight(p - ez), uSurfLevel).x;
    nx += hx / (2.0 * e);
    nz += hz / (2.0 * e);
    wp.y += sf.x;
  }
  // Ripples from the GPU simulation, on top of the swell.
  vec4 sim = sampleSim(p);
  wp.y += sim.x * sim.w;
  // Swash: near the shore the water really runs up the beach and drains back, so the
  // waterline (where this surface meets the sand) moves and changes shape with every wave.
  vec3 sw = swash(p, uTime, uWaveStrength);
  float shoreMask = smoothstep(-2.5, -0.4, -depth);
  wp.y += sw.x * shoreMask;
  vSwash = vec2(sw.z, shoreMask);
  vWorldPos = wp.xyz;
#ifdef REFLECTION
  // Projected onto the flat mirror plane; wave slopes distort the lookup in the fragment shader.
  vReflCoord = uReflectMatrix * vec4(wp.x, 0.0, wp.z, 1.0);
#endif
  vNormalW = normalize(vec3(-nx, 1.0 - ny, -nz));
  vCrest = ampSum > 0.0 ? disp.y / ampSum : 0.0;
  // Only near the island: far away the shadow patches would alias.
  vCloudShadow = cloudShadow(wp.xz, uSunDir) * (1.0 - smoothstep(300.0, 700.0, dist));

  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
