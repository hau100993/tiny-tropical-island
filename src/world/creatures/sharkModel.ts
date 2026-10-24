import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ClipBlend, prepareSkinned } from './glbUtil';
import { rayEllipsoid } from '../../activities/petting';

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

/** Nose to tail (m): a baby. */
const LENGTH = 1.1;
/** Baby proportions: the head (with the jaw) scaled up on its Neck bone. */
const HEAD_SCALE = 1.3;
/** The tint over the file's atlas: a brighter, friendlier blue. */
const TINT = '#bfeaff';

/** What the shark is doing, for the animation. */
export type SharkAction = 'swim' | 'fast' | 'bite';

/**
 * Bé Mập, the sea creature: Quaternius' "Shark" (CC0, see README), small, tinted a friendlier
 * blue, with a big baby head (its Neck bone scaled up, re-applied after the clips each frame).
 * Clips: swim, fast swim, a playful bite. Model space: facing +Z, the body's axis at y = 0, the
 * dorsal fin on top. Position and attitude (yaw, pitch, roll) are set by the behaviour.
 */
export class SharkModel {
  readonly root = new THREE.Group();
  private readonly blend: ClipBlend<SharkAction>;
  private readonly neck: THREE.Object3D;
  private readonly materials: THREE.Material[] = [];
  /** Where the dorsal fin's tip is (model space, m). */
  private readonly finTip = new THREE.Vector3();

  static async load(url: string): Promise<SharkModel> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new SharkModel(gltf.scene, gltf.animations);
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[]) {
    prepareSkinned(scene);
    const box = new THREE.Box3().setFromObject(scene);
    const fit = new THREE.Group();
    const s = LENGTH / (box.max.z - box.min.z);
    fit.scale.setScalar(s);
    fit.add(scene);
    this.root.add(fit);
    this.root.rotation.order = 'YXZ';
    this.finTip.set(0, box.max.y * s * 0.92, -0.05);
    this.blend = new ClipBlend<SharkAction>(new THREE.AnimationMixer(scene), clips, { swim: 'Swim', fast: 'Swim_Fast', bite: 'Swim_Bite' }, 'swim', 'shark');
    const neck = scene.getObjectByName('Neck');
    if (!neck) throw new Error('shark: no bone Neck');
    this.neck = neck;
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const tint = (m: THREE.Material): THREE.Material => {
        const std = m as THREE.MeshStandardMaterial;
        if (std.color) std.color.set(TINT);
        std.roughness = 0.45;
        std.metalness = 0;
        this.materials.push(std);
        return std;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
    });
  }

  /**
   * Distance along `ray` (world, unit direction) to the shark, or null: an ellipsoid round the
   * body and fin, a little generous (it is quick and mostly under water).
   */
  hitTest(ray: THREE.Ray): number | null {
    if (!this.root.visible) return null;
    tmpM.copy(this.root.matrixWorld).invert();
    const o = tmpV.copy(ray.origin).applyMatrix4(tmpM);
    const d = tmpV2.copy(ray.direction).transformDirection(tmpM);
    return rayEllipsoid(o.x, o.y, o.z, d.x, d.y, d.z, 0, 0.08, 0, 0.45, 0.4, LENGTH * 0.65);
  }

  /** The dorsal fin's tip (world): where it cuts the surface. */
  finPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.finTip).applyMatrix4(this.root.matrixWorld);
  }

  /** The snout (world). */
  nosePoint(out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, 0.02, LENGTH * 0.5).applyMatrix4(this.root.matrixWorld);
  }

  /** Places it: position (its body's axis), heading, nose-up pitch and roll (rad). */
  place(x: number, y: number, z: number, yaw: number, pitch: number, roll: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(-pitch, yaw, roll);
  }

  /** Animates one frame: clips toward `action`, played `pace` times as fast (beats with its speed). */
  update(dt: number, action: SharkAction, pace: number): void {
    this.blend.action('swim').timeScale = pace;
    this.blend.action('fast').timeScale = pace;
    this.blend.update(dt, action, 6);
    // The clips may set the neck's scale: the baby head goes on after them.
    this.neck.scale.setScalar(HEAD_SCALE);
    this.root.updateMatrixWorld(true);
  }

  /** Length (m), for the behaviour. */
  get length(): number {
    return LENGTH;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
