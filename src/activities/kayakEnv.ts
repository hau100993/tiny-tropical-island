import type * as THREE from 'three';
import { sampleWaves, waveAttenuation } from '../water/gerstner';
import { createSurfSample, sampleSurf, type SurfFrame } from '../water/surf';
import type { SurfEnv } from './surfPhysics';
import type { Heightmap } from '../world/heightmap';
import type { Placement } from '../world/layout';
import type { IslandColliders } from '../controls/islandColliders';
import type { SharedUniforms } from '../core/uniforms';

/** Rowboat hull as three circles along its length (bow at its local +X), radius 0.75 m. */
const BOAT_CIRCLES = [-1.3, 0, 1.3] as const;
const BOAT_R = 0.75;

/**
 * What the kayak (and the swimmer, and the surfboard) need to know about the world: the sea
 * surface (the CPU twin of the water shader: the swell, attenuated exactly like it near the
 * shore and far from the camera, plus the surf break), the terrain, and what they can bump into
 * (rocks and stilts from the walker's colliders, plus the moored rowboat, which the walker
 * never reaches).
 */
export function createKayakEnv(
  hm: Heightmap,
  colliders: IslandColliders,
  boat: Placement,
  camera: THREE.Camera,
  shared: SharedUniforms,
  surfFrame: SurfFrame,
): SurfEnv {
  const bx = Math.cos(boat.rotY);
  const bz = -Math.sin(boat.rotY);
  const depthAt = (x: number, z: number): number => -hm.heightAt(x, z);
  const surf = createSurfSample();
  return {
    ux: surfFrame.ux,
    uz: surfFrame.uz,
    water(x, z, out) {
      const dist = Math.hypot(x - camera.position.x, z - camera.position.z);
      const atten = waveAttenuation(shared.uWaveStrength.value, -hm.heightAt(x, z), dist);
      sampleWaves(x, z, shared.uTime.value, atten, dist, out);
      sampleSurf(surfFrame, x, z, shared.uTime.value, shared.uSurfLevel.value, depthAt, surf);
      out.height += surf.height;
      out.dhdx += surf.dhdx;
      out.dhdz += surf.dhdz;
      return out;
    },
    surf: (x, z, out) => sampleSurf(surfFrame, x, z, shared.uTime.value, shared.uSurfLevel.value, depthAt, out),
    level: () => shared.uSurfLevel.value,
    ground: (x, z) => hm.heightAt(x, z),
    block(x, z, y, r, out) {
      colliders.world.resolve(x, z, y, r, out);
      for (const d of BOAT_CIRCLES) {
        const cx = boat.x + bx * d;
        const cz = boat.z + bz * d;
        const dx = out.x - cx;
        const dz = out.z - cz;
        const dist = Math.hypot(dx, dz);
        const min = BOAT_R + r;
        if (dist >= min || dist < 1e-6) continue;
        out.x = cx + (dx / dist) * min;
        out.z = cz + (dz / dist) * min;
      }
    },
  };
}
