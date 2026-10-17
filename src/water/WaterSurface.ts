import * as THREE from 'three';
import { createWaveUniforms, NUM_WAVES } from './gerstner';
import type { SharedUniforms } from '../core/uniforms';
import type { Heightmap } from '../world/heightmap';
import waterCommon from './shaders/waterCommon.glsl?raw';
import waterVert from './shaders/water.vert.glsl?raw';
import waterFrag from './shaders/water.frag.glsl?raw';
import skyCommon from '../world/shaders/skyCommon.glsl?raw';

/**
 * Radial grid centered on the island: ~1.2 m spacing out to 150 m (where waves and foam
 * need detail), then geometrically growing rings out to the horizon. One draw call.
 */
function createRadialGrid(): THREE.BufferGeometry {
  const radii: number[] = [];
  for (let r = 0; r < 150; r += 1.2) radii.push(r);
  for (let r = 150; r < 3000; r *= 1.045) radii.push(r);
  radii.push(3000);
  const sectors = 384;
  const pos = new Float32Array(radii.length * sectors * 3);
  let p = 0;
  for (const r of radii) {
    for (let s = 0; s < sectors; s++) {
      const a = (s / sectors) * Math.PI * 2;
      pos[p++] = Math.cos(a) * r;
      pos[p++] = 0;
      pos[p++] = Math.sin(a) * r;
    }
  }
  const index: number[] = [];
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let s = 0; s < sectors; s++) {
      const s1 = (s + 1) % sectors;
      const a = ring * sectors + s;
      const b = ring * sectors + s1;
      const c = (ring + 1) * sectors + s;
      const d = (ring + 1) * sectors + s1;
      // Counter-clockwise seen from above, so the face normal points up (+Y).
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3000);
  return g;
}

export interface WaterSurface {
  mesh: THREE.Mesh;
}

export function createWaterSurface(
  hm: Heightmap,
  heightTexture: THREE.DataTexture,
  shared: SharedUniforms,
): WaterSurface {
  const material = new THREE.ShaderMaterial({
    defines: { NUM_WAVES },
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...createWaveUniforms(),
      // Shared uniform objects are referenced, not copied, so per-frame updates propagate.
      uTime: shared.uTime,
      uWaveStrength: shared.uWaveStrength,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyTop: shared.uSkyTop,
      uSkyHorizon: shared.uSkyHorizon,
      uTerrainHeight: { value: heightTexture },
      uTerrainSize: { value: hm.config.size },
      uTerrainRes: { value: hm.res },
      uShallowColor: { value: new THREE.Color('#3cc8c4') },
      uDeepColor: { value: new THREE.Color('#0a4a78') },
    },
    vertexShader: `${waterCommon}\n${waterVert}`,
    fragmentShader: `${waterCommon}\n${skyCommon}\n${waterFrag}`,
    transparent: true,
    fog: true,
  });
  const mesh = new THREE.Mesh(createRadialGrid(), material);
  mesh.name = 'water';
  // Drawn after opaque geometry so the seabed shows through shallow water.
  mesh.renderOrder = 1;
  return { mesh };
}
