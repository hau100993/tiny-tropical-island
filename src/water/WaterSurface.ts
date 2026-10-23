import * as THREE from 'three';
import { createWaveUniforms, NUM_WAVES } from './gerstner';
import { surfGlsl, type SurfFrame } from './surf';
import type { SharedUniforms } from '../core/uniforms';
import waterCommon from './shaders/waterCommon.glsl?raw';
import swash from './shaders/swash.glsl?raw';
import waterVert from './shaders/water.vert.glsl?raw';
import waterFrag from './shaders/water.frag.glsl?raw';
import skyCommon from '../world/shaders/skyCommon.glsl?raw';
import clouds from '../world/shaders/clouds.glsl?raw';
import aurora from '../world/shaders/aurora.glsl?raw';
import farSea from '../world/shaders/farSea.glsl?raw';

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

/** Uniforms owned by the water system and shared with the surface material. */
export interface WaterSurfaceInputs {
  terrain: { texture: THREE.Texture; size: number; res: number };
  sim: { value: THREE.Texture | null };
  simSize: number;
  simEnabled: { value: number };
  sceneColor: { value: THREE.Texture | null };
  sceneDepth: { value: THREE.Texture | null };
  resolution: { value: THREE.Vector2 };
  reflection: { value: THREE.Texture | null };
  reflectMatrix: { value: THREE.Matrix4 };
  /** Wake map (R foam, G height) around a world center, `wakeSize` m wide. */
  wake: { value: THREE.Texture | null };
  wakeCenter: THREE.Vector2;
  wakeSize: number;
  /** Water color seen from inside (Underwater.color). */
  underColor: THREE.Color;
}

export class WaterSurface {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(shared: SharedUniforms, inputs: WaterSurfaceInputs, camera: THREE.PerspectiveCamera) {
    const material = new THREE.ShaderMaterial({
      defines: { NUM_WAVES },
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...createWaveUniforms(),
        // Shared uniform objects are referenced, not copied, so per-frame updates propagate.
        uTime: shared.uTime,
        uWaveStrength: shared.uWaveStrength,
        uSurfLevel: shared.uSurfLevel,
        uRain: shared.uRain,
        uSunDir: shared.uSunDir,
        uSunColor: shared.uSunColor,
        uSkyTop: shared.uSkyTop,
        uSkyHorizon: shared.uSkyHorizon,
        uMoonDir: shared.uMoonDir,
        uMoonGlow: shared.uMoonGlow,
        uAurora: shared.uAurora,
        uAuroraAz: shared.uAuroraAz,
        uAuroraMotion: shared.uAuroraMotion,
        uNight: shared.uNight,
        uDawn: shared.uDawn,
        uDayLight: shared.uDayLight,
        uLightColor: shared.uLightColor,
        uGlintDir: shared.uGlintDir,
        uGlintColor: shared.uGlintColor,
        uGlintSize: shared.uGlintSize,
        uSunGlint: shared.uSunGlint,
        uSunBright: shared.uSunBright,
        uSunSize: shared.uSunSize,
        uCloudCover: shared.uCloudCover,
        uCloudOffset: shared.uCloudOffset,
        uTerrainHeight: { value: inputs.terrain.texture },
        uTerrainSize: { value: inputs.terrain.size },
        uTerrainRes: { value: inputs.terrain.res },
        uSim: inputs.sim,
        uSimSize: { value: inputs.simSize },
        uSimEnabled: inputs.simEnabled,
        uSceneColor: inputs.sceneColor,
        uSceneDepth: inputs.sceneDepth,
        uResolution: inputs.resolution,
        uReflection: inputs.reflection,
        uReflectMatrix: inputs.reflectMatrix,
        uWake: inputs.wake,
        uWakeCenter: { value: inputs.wakeCenter },
        uWakeSize: { value: inputs.wakeSize },
        uWakeOn: { value: inputs.wake.value ? 1 : 0 },
        uUnderColor: { value: inputs.underColor },
        uCamUnder: { value: 0 },
        uSurfFrame: { value: new THREE.Vector4(0, 0, 1, 0) },
        uCameraNear: { value: camera.near },
        uCameraFar: { value: camera.far },
        uShallowColor: { value: new THREE.Color('#3cc8c4') },
        uDeepColor: shared.uDeepColor,
      },
      vertexShader: `${waterCommon}\n${swash}\n${clouds}\n${surfGlsl}\n${waterVert}`,
      // One aurora ribbon is enough in the reflection (cheaper per water pixel).
      fragmentShader: `${waterCommon}\n${swash}\n${skyCommon}\n${farSea}\n#define AURORA_LAYERS 1\n${aurora}\n${waterFrag}`,
      fog: true,
      // Both faces: the underside is what you see when diving.
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(createRadialGrid(), material);
    this.mesh.name = 'water';
    // Drawn after all other geometry (seabed must be in the depth buffer / scene capture first).
    this.mesh.renderOrder = 1;
    this.setRefraction(false);
  }

  /** Where the surf break is (see surf.ts). */
  setSurf(frame: SurfFrame): void {
    this.mesh.material.uniforms.uSurfFrame.value.set(frame.ox, frame.oz, frame.ux, frame.uz);
  }

  /** Keeps depth linearization in sync when the camera's near/far change (walk mode). */
  syncCamera(camera: THREE.PerspectiveCamera): void {
    const u = this.mesh.material.uniforms;
    u.uCameraNear.value = camera.near;
    u.uCameraFar.value = camera.far;
  }

  /** Planar reflection (High): mirror image of the scene instead of the sky alone. */
  setReflection(on: boolean): void {
    const m = this.mesh.material;
    if (on === 'REFLECTION' in m.defines) return;
    if (on) m.defines.REFLECTION = '';
    else delete m.defines.REFLECTION;
    m.needsUpdate = true;
  }

  /** Refraction makes the water opaque (it draws what's behind itself); otherwise alpha-blend. */
  setRefraction(on: boolean): void {
    const m = this.mesh.material;
    const has = 'REFRACTION' in m.defines;
    if (on === has && m.transparent === !on) return;
    if (on) m.defines.REFRACTION = '';
    else delete m.defines.REFRACTION;
    m.transparent = !on;
    m.needsUpdate = true;
  }
}
