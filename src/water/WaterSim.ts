import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Heightmap } from '../world/heightmap';
import waterCommon from './shaders/waterCommon.glsl?raw';
import simVert from './shaders/sim.vert.glsl?raw';
import dropFrag from './shaders/simDrop.frag.glsl?raw';
import updateFrag from './shaders/simUpdate.frag.glsl?raw';
import gradientFrag from './shaders/simGradient.frag.glsl?raw';

/** Side of the simulated square, centered on the island (meters). */
export const SIM_SIZE = 200;
const MAX_DROPS = 16;
/** Ripple travel speed (m/s). A bit faster than real ripples so they read well from afar. */
const WAVE_SPEED = 6;
/** Velocity kept per step; lower = ripples die faster. */
const DAMPING = 0.996;

/**
 * GPU heightfield water, after Evan Wallace's WebGL Water (MIT).
 * State lives in two float textures used in ping-pong fashion (read A → write B → swap),
 * like double buffering. Texel: r = height (m), g = velocity, ba = gradient.
 */
export class WaterSim {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private res = 0;
  private stepDt = 1 / 60;
  private accum = 0;
  private readonly quad = new FullScreenQuad();
  private readonly dropMat: THREE.ShaderMaterial;
  private readonly updateMat: THREE.ShaderMaterial;
  private readonly gradientMat: THREE.ShaderMaterial;
  private readonly drops: THREE.Vector4[] = [];
  private dropCount = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    hm: Heightmap,
    heightTexture: THREE.Texture,
    res: number,
  ) {
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push(new THREE.Vector4());
    const common = {
      uTerrainHeight: { value: heightTexture },
      uTerrainSize: { value: hm.config.size },
      uTerrainRes: { value: hm.res },
      uSimSize: { value: SIM_SIZE },
      uSim: { value: null },
      uSimEnabled: { value: 0 },
    };
    const make = (frag: string, uniforms: Record<string, THREE.IUniform>, defines = {}): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        defines,
        uniforms: { ...common, uState: { value: null }, ...uniforms },
        vertexShader: simVert,
        fragmentShader: `${waterCommon}\n${frag}`,
        depthTest: false,
        depthWrite: false,
      });
    this.dropMat = make(dropFrag, { uDrops: { value: this.drops }, uDropCount: { value: 0 } }, { MAX_DROPS });
    this.updateMat = make(updateFrag, { uTexel: { value: new THREE.Vector2() }, uK: { value: 0 }, uDamping: { value: DAMPING } });
    this.gradientMat = make(gradientFrag, { uTexel: { value: new THREE.Vector2() }, uCell: { value: 1 } });

    this.rtA = this.createTarget(1);
    this.rtB = this.createTarget(1);
    this.setResolution(res);
  }

  /** Current state texture (height, velocity, gradient). */
  get texture(): THREE.Texture {
    return this.rtA.texture;
  }

  setResolution(res: number): void {
    if (res === this.res) return;
    this.res = res;
    this.rtA.dispose();
    this.rtB.dispose();
    this.rtA = this.createTarget(res);
    this.rtB = this.createTarget(res);
    // Start flat: clear both targets.
    const prev = this.renderer.getRenderTarget();
    const prevColor = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    for (const rt of [this.rtA, this.rtB]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prev);
    this.renderer.setClearColor(prevColor, prevAlpha);
    this.updateCoefficients();
  }

  /** Simulation steps per second; tied to the frame cap so ripples keep real-time speed. */
  setStepRate(stepsPerSecond: number): void {
    this.stepDt = 1 / stepsPerSecond;
    this.updateCoefficients();
  }

  private updateCoefficients(): void {
    const cell = SIM_SIZE / this.res;
    const courant = (WAVE_SPEED * this.stepDt) / cell;
    // uK = 4·C²; clamp well below the stability limit of 2.
    this.updateMat.uniforms.uK.value = Math.min(1.5, 4 * courant * courant);
    const texel = 1 / this.res;
    (this.updateMat.uniforms.uTexel.value as THREE.Vector2).set(texel, texel);
    (this.gradientMat.uniforms.uTexel.value as THREE.Vector2).set(texel, texel);
    this.gradientMat.uniforms.uCell.value = cell;
  }

  /**
   * Queues a drop at world (x, z). Negative strength pushes the surface down (a splash).
   * Drops outside the simulated square, or beyond MAX_DROPS this frame, are ignored.
   */
  addDrop(x: number, z: number, radius: number, strength: number): void {
    if (this.dropCount >= MAX_DROPS) return;
    const half = SIM_SIZE / 2;
    if (Math.abs(x) > half || Math.abs(z) > half) return;
    this.drops[this.dropCount++].set(x, z, radius, strength);
  }

  /** Advances the simulation in fixed steps (at most 2 per frame). */
  update(dt: number): void {
    this.accum = Math.min(this.accum + dt, this.stepDt * 2);
    const prevTarget = this.renderer.getRenderTarget();
    let stepped = false;
    if (this.dropCount > 0) {
      this.dropMat.uniforms.uDropCount.value = this.dropCount;
      this.pass(this.dropMat);
      this.dropCount = 0;
      stepped = true;
    }
    while (this.accum >= this.stepDt) {
      this.accum -= this.stepDt;
      this.pass(this.updateMat);
      stepped = true;
    }
    if (stepped) this.pass(this.gradientMat);
    // Restore, or the main render would draw into the simulation texture.
    this.renderer.setRenderTarget(prevTarget);
  }

  private pass(material: THREE.ShaderMaterial): void {
    material.uniforms.uState.value = this.rtA.texture;
    this.quad.material = material;
    this.renderer.setRenderTarget(this.rtB);
    this.quad.render(this.renderer);
    const tmp = this.rtA;
    this.rtA = this.rtB;
    this.rtB = tmp;
  }

  private createTarget(res: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.quad.dispose();
    this.dropMat.dispose();
    this.updateMat.dispose();
    this.gradientMat.dispose();
  }
}
