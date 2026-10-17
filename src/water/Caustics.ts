import * as THREE from 'three';
import { SIM_SIZE } from './WaterSim';
import type { SharedUniforms } from '../core/uniforms';
import type { Heightmap } from '../world/heightmap';
import waterCommon from './shaders/waterCommon.glsl?raw';
import causticsVert from './shaders/caustics.vert.glsl?raw';
import causticsFrag from './shaders/caustics.frag.glsl?raw';

/** Maximum grid segments per side; caps vertex cost on High. */
const MAX_SEGMENTS = 384;

/**
 * Renders a top-down caustics texture covering the simulation square. The terrain shader
 * samples it at underwater points (see patchCaustics in world/patchMaterial.ts).
 */
export class Caustics {
  private target: THREE.WebGLRenderTarget | null = null;
  private mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color();
  private res = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    hm: Heightmap,
    heightTexture: THREE.Texture,
    shared: SharedUniforms,
    simTexture: { value: THREE.Texture | null },
  ) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTerrainHeight: { value: heightTexture },
        uTerrainSize: { value: hm.config.size },
        uTerrainRes: { value: hm.res },
        uSim: simTexture,
        uSimSize: { value: SIM_SIZE },
        uSimEnabled: { value: 1 },
        uSunDir: shared.uSunDir,
        uTime: shared.uTime,
        uCausticStrength: { value: 9 },
      },
      vertexShader: `${waterCommon}\n${causticsVert}`,
      fragmentShader: causticsFrag,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      // Refracted triangles can flip; draw both windings.
      side: THREE.DoubleSide,
    });
  }

  /** The caustics texture, or null when disabled. */
  get texture(): THREE.Texture | null {
    return this.target?.texture ?? null;
  }

  /** 0 disables caustics and frees GPU memory. */
  setResolution(res: number): void {
    if (res === this.res) return;
    this.res = res;
    this.target?.dispose();
    this.mesh?.geometry.dispose();
    this.target = null;
    this.mesh = null;
    if (res === 0) return;

    this.target = new THREE.WebGLRenderTarget(res, res, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const seg = Math.min(res, MAX_SEGMENTS);
    const grid = new THREE.PlaneGeometry(SIM_SIZE, SIM_SIZE, seg, seg);
    grid.rotateX(-Math.PI / 2);
    grid.deleteAttribute('normal');
    grid.deleteAttribute('uv');
    this.mesh = new THREE.Mesh(grid, this.material);
    this.mesh.frustumCulled = false;
  }

  render(): void {
    if (!this.target || !this.mesh) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.getClearColor(this.clearColor);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.render(this.mesh, this.camera);
    r.setRenderTarget(prevTarget);
    r.setClearColor(this.clearColor, prevAlpha);
  }

  dispose(): void {
    this.setResolution(0);
    this.material.dispose();
  }
}
