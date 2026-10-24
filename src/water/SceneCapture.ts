import * as THREE from 'three';

/**
 * Renders the scene without the water (and sky) into a half-resolution color + depth
 * target. The water shader samples it to show a distorted, tinted view of what's below.
 * Color is half-float, so it stays linear HDR (tone mapping happens once, in the water shader).
 */
export class SceneCapture {
  private target: THREE.WebGLRenderTarget | null = null;
  readonly color: { value: THREE.Texture | null } = { value: null };
  readonly depth: { value: THREE.Texture | null } = { value: null };

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  get enabled(): boolean {
    return this.target !== null;
  }

  setEnabled(on: boolean, width: number, height: number): void {
    if (on && !this.target) {
      const depthTexture = new THREE.DepthTexture(1, 1);
      this.target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        depthTexture,
      });
      this.color.value = this.target.texture;
      this.depth.value = depthTexture;
    } else if (!on && this.target) {
      this.target.depthTexture?.dispose();
      this.target.dispose();
      this.target = null;
      this.color.value = null;
      this.depth.value = null;
    }
    this.setSize(width, height);
  }

  /** Full drawing-buffer size; the capture runs at half of it. */
  setSize(width: number, height: number): void {
    this.target?.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  }

  /** `hidden` objects (water, sky) are skipped for this pass. */
  render(scene: THREE.Scene, camera: THREE.Camera, hidden: THREE.Object3D[]): void {
    if (!this.target) return;
    hideFor(hidden, this.wasVisible);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(prev);
    restore(hidden, this.wasVisible);
  }

  /**
   * Compiles this pass's shaders in the background (KHR_parallel_shader_compile). A render
   * target gets no tone mapping, so its materials are other programs than the canvas's.
   */
  compileAsync(scene: THREE.Scene, camera: THREE.Camera, hidden: readonly THREE.Object3D[]): Promise<unknown> {
    if (!this.target) return Promise.resolve();
    // compile() walks every object, invisible ones too, so the hidden ones are taken out of their
    // parents' lists for the call (compile() runs synchronously inside compileAsync: no frame
    // can see the gap). Compiling the real scene keeps its lights and fog as the pass sees them.
    const parents: (THREE.Object3D | null)[] = [];
    const indices: number[] = [];
    for (const o of hidden) {
      const p = o.parent;
      const i = p ? p.children.indexOf(o) : -1;
      if (p && i >= 0) p.children.splice(i, 1);
      parents.push(i >= 0 ? p : null);
      indices.push(i);
    }
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    const done = this.renderer.compileAsync(scene, camera);
    this.renderer.setRenderTarget(prev);
    // Put back in reverse order, so each goes back to its own index.
    for (let k = hidden.length - 1; k >= 0; k--) parents[k]?.children.splice(indices[k], 0, hidden[k]);
    return done;
  }

  private readonly wasVisible: boolean[] = [];
}

/**
 * Hides `objects` for one extra pass, remembering whether each was visible: afterwards each gets
 * its own state back (something switched off, like the seagulls at night, stays off).
 */
export function hideFor(objects: readonly THREE.Object3D[], was: boolean[]): void {
  was.length = objects.length;
  for (let i = 0; i < objects.length; i++) {
    was[i] = objects[i].visible;
    objects[i].visible = false;
  }
}

export function restore(objects: readonly THREE.Object3D[], was: readonly boolean[]): void {
  for (let i = 0; i < objects.length; i++) objects[i].visible = was[i];
}
