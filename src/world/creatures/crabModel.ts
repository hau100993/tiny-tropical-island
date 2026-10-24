import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchWorldMaterial } from '../patchMaterial';
import type { SharedUniforms } from '../../core/uniforms';
import { rayEllipsoid } from '../../activities/petting';
import { findClip, fitToHeight, prepareSkinned } from './glbUtil';

/** Height of the top of the eyes (m); the model is scaled to it. */
const HEIGHT = 0.42;
/** Ground speed (m/s) of the walk clip at normal playback, at that size (by eye). */
const WALK_CLIP_SPEED = 0.3;

/** What the crab is doing, for the animation (the brain decides). */
export type CrabAction = 'idle' | 'move' | 'skill' | 'greet' | 'dance';

/**
 * Water palette over the file's red crab: blue shell, deep-blue legs and claws, a cream belly.
 * Keyed by the file's material names.
 */
const PALETTE: Record<string, { color: string; roughness: number }> = {
  Main: { color: '#3d9ad4', roughness: 0.45 },
  Main_Dark: { color: '#1c5a8f', roughness: 0.5 },
  White: { color: '#f2e9d6', roughness: 0.6 },
  Black: { color: '#141414', roughness: 0.25 },
};

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

/**
 * Bọt, the water creature: Quaternius' "Crab Enemy" (CC0, see README) in water colours, with
 * its own clips (idle, walk, bite for the water jet, yes for a greeting, dance). Model space:
 * facing +Z, feet at y = 0. Movement is decided by BubbleCrab; this only animates.
 */
export class CrabModel {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<CrabAction, THREE.AnimationAction>;
  /** Smoothed blend weight per action. */
  private readonly weights: Record<CrabAction, number> = { idle: 1, move: 0, skill: 0, greet: 0, dance: 0 };
  private readonly mouth: THREE.Object3D;
  private readonly materials: THREE.Material[] = [];

  static async load(url: string, shared: SharedUniforms): Promise<CrabModel> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new CrabModel(gltf.scene, gltf.animations, shared);
  }

  /**
   * `count` independent copies from one load (the wild ones in the forest): each a skeleton
   * clone sharing the file's geometry, with its own bones, clips and materials.
   */
  static async loadMany(url: string, shared: SharedUniforms, count: number): Promise<CrabModel[]> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const out: CrabModel[] = [];
    for (let i = 0; i < count; i++) out.push(new CrabModel(cloneSkinned(gltf.scene) as THREE.Group, gltf.animations, shared));
    return out;
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[], shared: SharedUniforms) {
    // (The file has 6 vertices with NaN skin weights: prepareSkinned repairs them.)
    prepareSkinned(scene);
    this.root.add(fitToHeight(scene, HEIGHT, 'crab'));

    this.mixer = new THREE.AnimationMixer(scene);
    const play = (name: string): THREE.AnimationAction => {
      const a = this.mixer.clipAction(findClip(clips, name, 'crab'));
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.actions = {
      idle: play('Idle'),
      move: play('Walk'),
      skill: play('Bite_InPlace'),
      greet: play('Yes'),
      dance: play('Dance'),
    };
    this.actions.idle.setEffectiveWeight(1);

    const mouth = scene.getObjectByName('Mouth');
    if (!mouth) throw new Error('crab: no bone Mouth');
    this.mouth = mouth;

    // Plain colours from the palette; the shell takes the world's wetness (it glistens in rain).
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
          const look = PALETTE[m.name] ?? { color: '#3d9ad4', roughness: 0.5 };
          out = new THREE.MeshStandardMaterial({ color: look.color, roughness: look.roughness, metalness: 0 });
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

  /**
   * Distance along `ray` (world, unit direction) to the crab, or null if it misses: for pointing
   * at it with the mouse. Analytic (an ellipsoid round the shell and claws), no mesh raycast.
   */
  hitTest(ray: THREE.Ray): number | null {
    if (!this.root.visible) return null;
    tmpM.copy(this.root.matrixWorld).invert();
    // The root only turns and moves (no scale): distances stay in metres.
    const o = tmpV.copy(ray.origin).applyMatrix4(tmpM);
    const d = tmpV2.copy(ray.direction).transformDirection(tmpM);
    return rayEllipsoid(o.x, o.y, o.z, d.x, d.y, d.z, 0, HEIGHT * 0.45, 0.02, 0.36, HEIGHT * 0.55, 0.26);
  }

  /** Where the water jet leaves (world): just in front of the mouth. */
  mouthPoint(out: THREE.Vector3): THREE.Vector3 {
    this.mouth.getWorldPosition(out);
    const fwd = tmpV.set(0, 0, 1).transformDirection(this.root.matrixWorld);
    return out.addScaledVector(fwd, 0.06);
  }

  /** Animates one frame: blends toward `action`; `speed` (m/s) paces the walk. */
  update(dt: number, action: CrabAction, speed: number): void {
    const k = 1 - Math.exp(-dt * 8);
    let sum = 0;
    for (const key of Object.keys(this.weights) as CrabAction[]) {
      const want = key === action ? 1 : 0;
      this.weights[key] += (want - this.weights[key]) * k;
      sum += this.weights[key];
    }
    for (const key of Object.keys(this.weights) as CrabAction[]) {
      this.actions[key].setEffectiveWeight(this.weights[key] / Math.max(1e-3, sum));
    }
    this.actions.move.timeScale = Math.min(2.5, Math.max(0.6, speed / WALK_CLIP_SPEED));
    this.mixer.update(dt);
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
