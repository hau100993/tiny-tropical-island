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
