import * as THREE from 'three';
import { WaterSim, SIM_SIZE } from './WaterSim';
import { Caustics } from './Caustics';
import { SceneCapture } from './SceneCapture';
import { PlanarReflection } from './PlanarReflection';
import { WaterSurface } from './WaterSurface';
import { WakeMap, WAKE_SIZE } from './WakeMap';
import { Underwater } from './Underwater';
import type { SharedUniforms } from '../core/uniforms';
import type { QualityProfile } from '../core/quality';
import type { Heightmap } from '../world/heightmap';
import type { CausticsUniforms } from '../world/patchMaterial';

/**
 * Owns all water pieces and runs their per-frame GPU passes in order:
 * simulation → caustics → scene capture (for refraction). The main render comes after.
 */
export class WaterSystem {
  readonly surface: WaterSurface;
  /** Null when the GPU can't render to float textures (then: Gerstner waves only). */
  readonly sim: WaterSim | null;
  /** Foam and small bumps left by the kayak (null without float render targets). */
  readonly wake: WakeMap | null;
  private readonly caustics: Caustics | null;
  private readonly capture: SceneCapture;
  private readonly simTexture: { value: THREE.Texture | null } = { value: null };
  private readonly simEnabled = { value: 0 };
  private readonly underColor = new THREE.Color();
  private readonly resolution = { value: new THREE.Vector2(1, 1) };
  private captureHidden: THREE.Object3D[] = [];
  private readonly reflection: PlanarReflection;
  private reflectionHidden: THREE.Object3D[] = [];
  /** Set by `attachUnderwater`; while the camera is under water the capture passes are skipped. */
  underwater: Underwater | null = null;
  /** Pass to `patchCaustics` for materials that should receive caustic light. */
  readonly causticsUniforms: CausticsUniforms;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly hm: Heightmap,
    heightTexture: THREE.Texture,
    shared: SharedUniforms,
    camera: THREE.PerspectiveCamera,
  ) {
    const floatTargets =
      renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    if (!floatTargets) console.info('Water: float render targets unavailable; ripples and caustics disabled.');

    this.sim = floatTargets ? new WaterSim(renderer, hm, heightTexture, 256) : null;
    this.simEnabled.value = this.sim ? 1 : 0;
    this.wake = floatTargets ? new WakeMap(renderer, 512) : null;
    this.caustics = floatTargets ? new Caustics(renderer, hm, heightTexture, shared, this.simTexture) : null;
    this.capture = new SceneCapture(renderer);
    this.reflection = new PlanarReflection(renderer);
    this.causticsUniforms = {
      uCaustics: { value: null },
      uCausticsSize: { value: SIM_SIZE },
      uCausticsOn: { value: 0 },
      uSunColor: shared.uSunColor,
      uSunDir: shared.uSunDir,
    };
    this.surface = new WaterSurface(
      shared,
      {
        terrain: { texture: heightTexture, size: hm.config.size, res: hm.res },
        sim: this.simTexture,
        simSize: SIM_SIZE,
        simEnabled: this.simEnabled,
        sceneColor: this.capture.color,
        sceneDepth: this.capture.depth,
        resolution: this.resolution,
        reflection: this.reflection.texture,
        reflectMatrix: this.reflection.matrix,
        wake: { value: this.wake?.target.texture ?? null },
        wakeCenter: this.wake?.center ?? new THREE.Vector2(1e5, 1e5),
        wakeSize: WAKE_SIZE,
        underColor: this.underColor,
      },
      camera,
    );
    this.captureHidden = [this.surface.mesh];
    this.reflectionHidden = [this.surface.mesh];
  }

  applyProfile(profile: QualityProfile): void {
    this.sim?.setResolution(profile.waterSimRes);
    const causticsRes = this.caustics ? profile.causticsRes : 0;
    this.caustics?.setResolution(causticsRes);
    this.causticsUniforms.uCaustics.value = this.caustics?.texture ?? null;
    this.causticsUniforms.uCausticsOn.value = causticsRes > 0 ? 1 : 0;
    this.capture.setEnabled(profile.refraction, this.resolution.value.x, this.resolution.value.y);
    this.surface.setRefraction(profile.refraction);
    this.reflection.setEnabled(profile.reflection, this.resolution.value.x, this.resolution.value.y);
    this.surface.setReflection(profile.reflection);
  }

  /** Simulation steps per second (follows the frame cap). */
  setStepRate(stepsPerSecond: number): void {
    this.sim?.setStepRate(stepsPerSecond);
  }

  /** Drawing-buffer size in pixels (CSS size × pixel ratio). */
  setSize(width: number, height: number): void {
    this.resolution.value.set(width, height);
    this.capture.setSize(width, height);
    this.reflection.setSize(width, height);
  }

  /** Splash at world (x, z) if it is open water inside the simulated area. */
  addRipple(x: number, z: number, radius: number, strength: number): void {
    if (this.hm.heightAt(x, z) > -0.05) return;
    this.sim?.addDrop(x, z, radius, strength);
  }

  /** Objects besides the water to leave out of the refraction capture (e.g. the sky dome). */
  setCaptureHidden(objects: THREE.Object3D[]): void {
    this.captureHidden = [this.surface.mesh, ...objects];
  }

  /** Objects besides the water to leave out of the reflection (sky, particles, small plants). */
  setReflectionHidden(objects: THREE.Object3D[]): void {
    this.reflectionHidden = [this.surface.mesh, ...objects];
  }

  /** Step 1 of the frame: simulation and caustics passes (no scene geometry involved). */
  simulate(dt: number, wakeX = 0, wakeZ = 0): void {
    this.wake?.update(dt, wakeX, wakeZ);
    if (this.sim) {
      this.sim.update(dt);
      this.simTexture.value = this.sim.texture;
    }
    this.caustics?.render();
  }

  /** Under-water look for the scene (fog, sky) and the surface's underside. */
  attachUnderwater(u: Underwater): void {
    this.underwater = u;
    this.underColor.copy(u.color);
    this.surface.mesh.material.uniforms.uUnderColor.value = u.color;
  }

  /** Step 2: capture the scene behind the water for refraction (no-op when refraction is off). */
  captureScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.surface.syncCamera(camera);
    this.surface.mesh.material.uniforms.uCamUnder.value = this.underwater?.under ? 1 : 0;
    // From below, the surface draws its own underside: no refraction or reflection needed.
    if (this.underwater?.under) return;
    this.capture.render(scene, camera, this.captureHidden);
    this.reflection.render(scene, camera, this.reflectionHidden, 0);
  }
}
