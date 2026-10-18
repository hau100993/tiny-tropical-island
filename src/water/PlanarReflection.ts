import * as THREE from 'three';

/**
 * Mirror image of the scene in the sea plane (High quality): palms, house and rocks reflected in
 * the water. Rendered at half resolution from a camera mirrored below the water level, with an
 * oblique near plane so nothing under the water shows up in the reflection. Pixels with nothing
 * reflected keep alpha 0 and the water shader uses its analytic sky there.
 *
 * Camera math adapted from three.js `examples/jsm/objects/Reflector.js` (MIT).
 */
export class PlanarReflection {
  private target: THREE.WebGLRenderTarget | null = null;
  readonly texture: { value: THREE.Texture | null } = { value: null };
  /** World position → reflection texture coordinates (projective). */
  readonly matrix = { value: new THREE.Matrix4() };
  private readonly virtualCamera = new THREE.PerspectiveCamera();
  private readonly plane = new THREE.Plane();
  private readonly clipPlane = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly planePos = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly rotation = new THREE.Matrix4();
  private readonly clearColor = new THREE.Color();

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  get enabled(): boolean {
    return this.target !== null;
  }

  setEnabled(on: boolean, width: number, height: number): void {
    if (on && !this.target) {
      this.target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
      });
      this.texture.value = this.target.texture;
    } else if (!on && this.target) {
      this.target.dispose();
      this.target = null;
      this.texture.value = null;
    }
    this.setSize(width, height);
  }

  setSize(width: number, height: number): void {
    this.target?.setSize(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2)));
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, hidden: THREE.Object3D[], waterY: number): void {
    const target = this.target;
    if (!target) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.getClearColor(this.clearColor);
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear();

    this.planePos.set(0, waterY, 0);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.planePos, this.camPos);
    // Camera under the water plane: nothing to mirror (the cleared target means "sky only").
    if (this.view.dot(this.normal) < 0) {
      this.updateCamera(camera);
      for (const o of hidden) o.visible = false;
      r.render(scene, this.virtualCamera);
      for (const o of hidden) o.visible = true;
    }

    r.setRenderTarget(prevTarget);
    r.setClearColor(this.clearColor, prevAlpha);
  }

  private updateCamera(camera: THREE.PerspectiveCamera): void {
    const vc = this.virtualCamera;
    const n = this.normal;
    // Mirrored camera position and look target; the up vector is mirrored too, so the virtual
    // camera stays a proper rotation (triangle winding unchanged).
    this.view.reflect(n).negate().add(this.planePos);
    this.rotation.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rotation).add(this.camPos);
    // Same construction as the position: (plane − point), reflected, negated, back from the plane.
    // (Taking point − plane here mirrors the target through the plane's origin instead, which
    // only looks right while the camera faces the island center, as the orbit camera does.)
    const target = this.lookAt.subVectors(this.planePos, this.lookAt).reflect(n).negate().add(this.planePos);
    vc.position.copy(this.view);
    vc.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(n);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    // Texture matrix: clip space of the virtual camera → [0, 1] texture coordinates.
    this.matrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(vc.projectionMatrix)
      .multiply(vc.matrixWorldInverse);

    // Oblique near plane = the water plane (Lengyel, "Oblique View Frustum Depth Projection").
    this.plane.setFromNormalAndCoplanarPoint(n, this.planePos).applyMatrix4(vc.matrixWorldInverse);
    const c = this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = vc.projectionMatrix.elements;
    this.q.set((Math.sign(c.x) + e[8]) / e[0], (Math.sign(c.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    c.multiplyScalar(2 / c.dot(this.q));
    e[2] = c.x;
    e[6] = c.y;
    e[10] = c.z + 1;
    e[14] = c.w;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
  }
}
