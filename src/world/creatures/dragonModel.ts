import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchWorldMaterial } from '../patchMaterial';
import type { SharedUniforms } from '../../core/uniforms';
import { rayEllipsoid } from '../../activities/petting';
import { ClipBlend, fitToHeight, prepareSkinned } from './glbUtil';

/** Height of the whole model, wing tips to feet (m); wingspan comes out about 1.5 m. */
const HEIGHT = 0.8;

/** What the dragon is doing, for the animation (the brain decides). */
export type DragonAction = 'idle' | 'move' | 'skill' | 'greet' | 'dance';

/** Fire palette over the file's brown dragon: red-orange body, golden belly and wings, pale horns. */
const PALETTE: Record<string, { color: string; roughness: number; glow?: number }> = {
  Dragon_Main: { color: '#e0522a', roughness: 0.5, glow: 0.1 },
  Dragon_Secondary: { color: '#f3b23f', roughness: 0.55, glow: 0.06 },
  Dragon_Horn: { color: '#f0e2c4', roughness: 0.4 },
  Eye_White: { color: '#ececec', roughness: 0.25 },
  Eye_Black: { color: '#121212', roughness: 0.2 },
};

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();

/**
 * Hỏa Long, the fire creature: Quaternius' "Dragon Evolved" (CC0, see README) in fire colours,
 * always flying, with its own clips (hovering, fast flight, a headbutt to breathe fire, yes,
 * punch for excitement). Its body glows faintly (emissive). Model space: facing +Z. Movement is
 * decided by FireDragon; this only animates and says where the mouth and the tail tip are.
 */
export class DragonModel {
  readonly root = new THREE.Group();
  private readonly blend: ClipBlend<DragonAction>;
  private readonly head: THREE.Object3D;
  private readonly tail: THREE.Object3D;
  private readonly tailBase: THREE.Object3D;
  /** The mouth and the model's forward, in the Head bone's frame (see measureMouth). */
  private readonly mouthLocal = new THREE.Vector3();
  private readonly forwardLocal = new THREE.Vector3(0, 0, 1);
  private readonly materials: THREE.Material[] = [];

  static async load(url: string, shared: SharedUniforms): Promise<DragonModel> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new DragonModel(gltf.scene, gltf.animations, shared);
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[], shared: SharedUniforms) {
    prepareSkinned(scene);
    this.root.add(fitToHeight(scene, HEIGHT, 'dragon'));
    // Yaw then pitch (the pitch tips the body about its own side axis).
    this.root.rotation.order = 'YXZ';
    this.blend = new ClipBlend<DragonAction>(
      new THREE.AnimationMixer(scene),
      clips,
      { idle: 'Flying_Idle', move: 'Fast_Flying', skill: 'Headbutt', greet: 'Yes', dance: 'Punch' },
      'idle',
      'dragon',
    );
    const find = (n: string): THREE.Object3D => {
      const o = scene.getObjectByName(n);
      if (!o) throw new Error(`dragon: no bone ${n}`);
      return o;
    };
    this.head = find('Head');
    // The tail runs Body1 → Body4; the flame burns at its tip.
    this.tail = find('Body4');
    this.tailBase = find('Body3');
    this.measureMouth(scene);

    const swapped = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const swap = (m: THREE.Material): THREE.Material => {
        let out = swapped.get(m);
        if (!out) {
          const look = PALETTE[m.name] ?? { color: '#e0522a', roughness: 0.5 };
          out = new THREE.MeshStandardMaterial({ color: look.color, roughness: look.roughness, metalness: 0 });
          // A faint inner warmth, so it never goes dull at night.
          if (look.glow) {
            out.emissive.set('#ff5a1a');
            out.emissiveIntensity = look.glow;
          }
          patchWorldMaterial(out, { wet: true, porosity: 0.2 }, shared);
          swapped.set(m, out);
          this.materials.push(out);
          m.dispose();
        }
        return out;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  /** Distance along `ray` (world, unit direction) to the dragon, or null: an ellipsoid round body and wings. */
  hitTest(ray: THREE.Ray): number | null {
    if (!this.root.visible) return null;
    tmpM.copy(this.root.matrixWorld).invert();
    const o = tmpV.copy(ray.origin).applyMatrix4(tmpM);
    const d = tmpV2.copy(ray.direction).transformDirection(tmpM);
    return rayEllipsoid(o.x, o.y, o.z, d.x, d.y, d.z, 0, HEIGHT * 0.55, 0, 0.6, HEIGHT * 0.45, 0.42);
  }

  /**
   * Finds the mouth on the mesh itself (the Head bone's joint sits at the back of the skull):
   * in the rest pose, among the vertices the Head bone carries, the front slab of the snout; its
   * middle, a little below centre, is the mouth. Kept in the Head bone's own frame, with the
   * model's forward, so both follow every nod and thrust of the head in the clips.
   */
  private measureMouth(scene: THREE.Object3D): void {
    this.root.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      const bone = mesh.skeleton.bones.indexOf(this.head as THREE.Bone);
      if (bone < 0) return;
      const idx = mesh.geometry.getAttribute('skinIndex');
      const w = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < idx.count; i++) {
        let weight = 0;
        for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === bone) weight += w.getComponent(i, k);
        if (weight < 0.5) continue;
        // Skinned position (mesh space), then the model's space (the root is still at the origin).
        pts.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
      }
    });
    if (pts.length === 0) throw new Error('dragon: no head vertices');
    let front = -Infinity;
    for (const p of pts) front = Math.max(front, p.z);
    // The snout's front 6 cm: its centre, a third of the way up (the jaws, below the nostrils).
    let lo = Infinity;
    let hi = -Infinity;
    let sx = 0;
    let n = 0;
    for (const p of pts) {
      if (p.z < front - 0.06) continue;
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
      sx += p.x;
      n++;
    }
    const mouth = new THREE.Vector3(sx / n, lo + (hi - lo) * 0.35, front - 0.01);
    const inv = tmpM.copy(this.head.matrixWorld).invert();
    this.mouthLocal.copy(mouth).applyMatrix4(inv);
    // Forward (+Z of the model) in the bone's frame: a direction, so rotation only.
    this.head.getWorldQuaternion(tmpQ).invert();
    this.forwardLocal.set(0, 0, 1).applyQuaternion(tmpQ).normalize();
  }

  /** Where fire leaves (world): the mouth, as the head moves now. */
  mouthPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.mouthLocal).applyMatrix4(this.head.matrixWorld);
  }

  /**
   * Which way the fire goes (world, unit): mostly the body's forward (turned and tipped with it),
   * a quarter the head's, so the flame lives with the head without sweeping about in the clip.
   */
  facing(out: THREE.Vector3): THREE.Vector3 {
    const head = tmpV.copy(this.forwardLocal).applyQuaternion(this.head.getWorldQuaternion(tmpQ)).normalize();
    return out.set(0, 0, 1).transformDirection(this.root.matrixWorld).multiplyScalar(0.75).addScaledVector(head, 0.25).normalize();
  }

  /** Nose down (rad, negative: up): the whole body tips toward what it breathes at. */
  setPitch(pitch: number): void {
    this.root.rotation.x = pitch;
  }

  /**
   * The tip of the tail (world), where its flame burns: the last bone's joint carried on by one
   * more bone length (the joint is the segment's root, the tip lies beyond it).
   */
  tailPoint(out: THREE.Vector3): THREE.Vector3 {
    this.tail.getWorldPosition(out);
    const base = this.tailBase.getWorldPosition(tmpV);
    return out.multiplyScalar(2).sub(base);
  }

  update(dt: number, action: DragonAction): void {
    this.blend.update(dt, action, 6);
    this.root.updateMatrixWorld(true);
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
