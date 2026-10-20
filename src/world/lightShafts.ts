import * as THREE from 'three';
import type { Heightmap } from './heightmap';
import type { Trail } from './trail';
import type { SharedUniforms } from '../core/uniforms';
import { createRng, randRange } from '../core/rng';

/**
 * Sunbeams slanting through the canopy onto the footpath: soft additive strips, one draw call
 * (instanced). Each beam starts on the ground by the path and rises toward the sun; it turns
 * around its own axis to face the camera, so it reads as a shaft of hazy light from any side.
 * Everything happens in the shader from the shared sun uniforms: the beams follow the sun,
 * fade with a low sun, clouds and rain, and slowly breathe (leaves moving in the breeze).
 *
 * For a C/C++ mind: additive blending means "dst += src", so overlapping beams just brighten
 * and draw order does not matter; with depthWrite off they never hide anything behind them.
 */
const VERT = /* glsl */ `
attribute vec3 iAnchor;
attribute vec2 iSize;   // length, width (m)
attribute float iSeed;
uniform vec3 uSunDir;
varying float vX;
varying float vY;
varying float vSeed;
varying float vEdgeOn;
void main() {
  // Toward the sun, but never flatter than ~20° (a very low sun doesn't reach the forest floor).
  vec3 axis = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.35), uSunDir.z));
  vec3 mid = iAnchor + axis * iSize.x * 0.5;
  vec3 toCam = normalize(cameraPosition - mid);
  vec3 side = normalize(cross(axis, toCam));
  // A little wider up in the canopy, where the light comes through a gap.
  float w = iSize.y * mix(0.75, 1.35, position.y);
  vec3 wp = iAnchor + axis * iSize.x * position.y + side * w * position.x;
  vX = position.x * 2.0;
  vY = position.y;
  vSeed = iSeed;
  // Looking straight along a beam it would collapse to a line: fade it instead.
  vEdgeOn = abs(dot(toCam, axis));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uDayLight;
uniform float uCloudCover;
uniform float uRain;
varying float vX;
varying float vY;
varying float vSeed;
varying float vEdgeOn;
void main() {
  float across = 1.0 - smoothstep(0.15, 1.0, abs(vX));
  across *= across;
  // Soft where it meets the ground and where it starts up in the leaves.
  float along = smoothstep(0.0, 0.3, vY) * (1.0 - smoothstep(0.7, 1.0, vY));
  // Leaves moving in the breeze: each beam breathes on its own slow rhythm.
  float breathe = 0.6 + 0.4 * sin(uTime * 0.31 + vSeed * 6.28) * sin(uTime * 0.13 + vSeed * 2.7);
  float sun = smoothstep(0.08, 0.32, uSunDir.y) * uDayLight * (1.0 - 0.85 * uCloudCover) * (1.0 - uRain);
  float a = across * along * breathe * sun * (1.0 - 0.7 * smoothstep(0.6, 0.95, vEdgeOn)) * 0.17;
  gl_FragColor = vec4(mix(uSunColor, vec3(1.0, 0.95, 0.8), 0.4) * a, 1.0);
}
`;

export function createLightShafts(hm: Heightmap, trail: Trail, seed: number, shared: SharedUniforms): THREE.Mesh {
  const rng = createRng(seed);
  const anchors: number[] = [];
  const sizes: number[] = [];
  const seeds: number[] = [];
  const pts = trail.points;
  for (let i = 1; i < pts.length - 1; i++) {
    // Only under the forest (not on the open beach ends), and not at every point.
    const p = pts[i];
    if (hm.inlandAt(p.x, p.z) < 0.25 || rng() > 0.6) continue;
    // A small cluster: one main beam and one or two thinner ones beside it.
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const x = p.x + randRange(rng, -2.2, 2.2);
      const z = p.z + randRange(rng, -2.2, 2.2);
      anchors.push(x, hm.heightAt(x, z), z);
      sizes.push(randRange(rng, 14, 24), k === 0 ? randRange(rng, 0.9, 1.7) : randRange(rng, 0.3, 0.8));
      seeds.push(rng());
    }
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.5, 0); // y from 0 (ground) to 1 (canopy)
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.setAttribute('iAnchor', new THREE.InstancedBufferAttribute(new Float32Array(anchors), 3));
  geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 2));
  geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(seeds), 1));
  geo.instanceCount = seeds.length;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uTime: shared.uTime,
      uDayLight: shared.uDayLight,
      uCloudCover: shared.uCloudCover,
      uRain: shared.uRain,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'light-shafts';
  // Instances move in the shader: the CPU bounds can't know where, so never cull.
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}
