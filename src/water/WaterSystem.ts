import * as THREE from 'three';
import { WaterSim, SIM_SIZE } from './WaterSim';
import { Caustics } from './Caustics';
import { SceneCapture } from './SceneCapture';
import { WaterSurface } from './WaterSurface';
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
  private readonly caustics: Caustics | null;
  private readonly capture: SceneCapture;
  private readonly simTexture: { value: THREE.Texture | null } = { value: null };
  private readonly simEnabled = { value: 0 };
  private readonly resolution = { value: new THREE.Vector2(1, 1) };
  private captureHidden: THREE.Object3D[] = [];
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
    this.caustics = floatTargets ? new Caustics(renderer, hm, heightTexture, shared, this.simTexture) : null;
    this.capture = new SceneCapture(renderer);
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
      },
      camera,
    );
    this.captureHidden = [this.surface.mesh];
  }

  applyProfile(profile: QualityProfile): void {
    this.sim?.setResolution(profile.waterSimRes);
    const causticsRes = this.caustics ? profile.causticsRes : 0;
    this.caustics?.setResolution(causticsRes);
    this.causticsUniforms.uCaustics.value = this.caustics?.texture ?? null;
    this.causticsUniforms.uCausticsOn.value = causticsRes > 0 ? 1 : 0;
    this.capture.setEnabled(profile.refraction, this.resolution.value.x, this.resolution.value.y);
    this.surface.setRefraction(profile.refraction);
  }

  /** Simulation steps per second (follows the frame cap). */
  setStepRate(stepsPerSecond: number): void {
    this.sim?.setStepRate(stepsPerSecond);
  }

  /** Drawing-buffer size in pixels (CSS size × pixel ratio). */
  setSize(width: number, height: number): void {
    this.resolution.value.set(width, height);
    this.capture.setSize(width, height);
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

  /** Step 1 of the frame: simulation and caustics passes (no scene geometry involved). */
  simulate(dt: number): void {
    if (this.sim) {
      this.sim.update(dt);
      this.simTexture.value = this.sim.texture;
    }
    this.caustics?.render();
  }

  /** Step 2: capture the scene behind the water for refraction (no-op when refraction is off). */
  captureScene(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.surface.syncCamera(camera);
    this.capture.render(scene, camera, this.captureHidden);
  }
}
