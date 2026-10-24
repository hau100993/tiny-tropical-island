import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchWorldMaterial } from '../patchMaterial';
import type { SharedUniforms } from '../../core/uniforms';
import { rayEllipsoid } from '../../activities/petting';
import { PartBuilder, flat } from '../animals/parts';
import { ClipBlend, fitToHeight, prepareSkinned } from './glbUtil';

/** Height of the bunny, feet to the ear tips (m). */
const HEIGHT = 0.75;
/** Ground speed (m/s) of the walk clip at normal playback, at that size (by eye). */
const WALK_CLIP_SPEED = 0.4;
/** The sprout's size on the head (its parts are made at backpack size). */
const SPROUT_SCALE = 0.7;
/** Leaves round the bud: their droop at rest and when flared open (rad, + = down). */
const LEAF_REST = 0.12;
const LEAF_OPEN = -0.55;
/** Where the leaves spring from on the bud (its own frame, m): above the skull it sits in. */
const LEAF_BASE = 0.075;

/** What the bunny is doing, for the animation (the brain decides). */
export type BunnyAction = 'idle' | 'move' | 'skill' | 'greet' | 'dance';

/**
 * Grass palette over the file's grey bunny: spring-green fur, a cream belly and inner ears; its
 * carrot stays a carrot. Keyed by the file's material names.
 */
const PALETTE: Record<string, { color: string; roughness: number }> = {
  Bunny_Main: { color: '#8fcf6e', roughness: 0.75 },
  Bunny_Secondary: { color: '#f6efcf', roughness: 0.75 },
  Eye_White: { color: '#ececec', roughness: 0.25 },
  Eye_Black: { color: '#121212', roughness: 0.2 },
  'Material.024': { color: '#f08a2c', roughness: 0.6 },
  'Material.011': { color: '#4f9e3a', roughness: 0.6 },
};

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
/** The leaves round the bud, a little larger than the bud's own scale. */
const LEAF_SIZE = new THREE.Vector3(1.4, 1.4, 1.4);

/** The bud (striped, with a little sprout on top) in its own frame, metres, base at 0. */
function budGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const light = new THREE.Color('#7fcf74');
  const dark = new THREE.Color('#5fb35f');
  // Soft ribs running up the bud, like a closed flower bulb.
  b.addFn(
    new THREE.SphereGeometry(1, 14, 10).scale(0.085, 0.115, 0.085).translate(0, 0.1, 0),
    (p) => (Math.sin(Math.atan2(p.x, p.z) * 5) > 0 ? light : dark),
    () => [0, 0],
  );
  b.add(new THREE.CylinderGeometry(0.006, 0.008, 0.05, 5).translate(0, 0.225, 0), '#4c9a3c');
  for (const s of [-1, 1]) {
    b.add(flat([[0, 0.245, 0], [s * 0.03, 0.27, 0.012], [s * 0.06, 0.265, 0], [s * 0.03, 0.255, -0.012]]), '#86d65a');
  }
  return b.build();
}

/** One big leaf lying along +Z, slightly cupped, lighter toward its tip. */
function leafGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const base = new THREE.Color('#3f9c3a');
  const tip = new THREE.Color('#8fd863');
  b.addFn(
    flat([[0, 0, 0], [0.055, 0.012, 0.06], [0.045, 0.018, 0.13], [0, 0.012, 0.19], [-0.045, 0.018, 0.13], [-0.055, 0.012, 0.06]]),
    (p) => base.clone().lerp(tip, Math.min(1, p.z / 0.19)),
    () => [0, 0],
  );
  return b.build();
}

/**
 * Mầm, the grass creature: Quaternius' "Bunny" (CC0, see README) in grass colours, with a sprout
 * growing from the top of its head between the ears (made here: a striped bud with a shoot, four
 * leaves that sway and flare open). Clips: idle, walk, punch (to throw leaves), wave (hello), jump
 * (a happy hop). Model space: facing +Z, feet at y = 0. Movement is decided by GrassBunny; this
 * only animates.
 */
export class BunnyModel {
  readonly root = new THREE.Group();
  private readonly blend: ClipBlend<BunnyAction>;
  /** The sprout on the head (child of the Head bone, so it rides every nod). */
  private readonly bud = new THREE.Group();
  private readonly budMesh: THREE.Mesh;
  private readonly leaves: THREE.InstancedMesh;
  private readonly materials: THREE.Material[] = [];
  private sway = 0;

  static async load(url: string, shared: SharedUniforms): Promise<BunnyModel> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new BunnyModel(gltf.scene, gltf.animations, shared);
  }

  /**
   * `count` independent copies from one load (the wild ones in the forest): each a skeleton
   * clone sharing the file's geometry, with its own bones, clips and materials.
   */
  static async loadMany(url: string, shared: SharedUniforms, count: number): Promise<BunnyModel[]> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const out: BunnyModel[] = [];
    for (let i = 0; i < count; i++) out.push(new BunnyModel(cloneSkinned(gltf.scene) as THREE.Group, gltf.animations, shared));
    return out;
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[], shared: SharedUniforms) {
    prepareSkinned(scene);
    this.root.add(fitToHeight(scene, HEIGHT, 'bunny'));
    this.blend = new ClipBlend<BunnyAction>(
      new THREE.AnimationMixer(scene),
      clips,
      { idle: 'Idle', move: 'Walk', skill: 'Punch', greet: 'Wave', dance: 'Jump' },
      'idle',
      'bunny',
    );
    const head = scene.getObjectByName('Head');
    if (!head) throw new Error('bunny: no bone Head');

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
          const look = PALETTE[m.name] ?? { color: '#8fcf6e', roughness: 0.75 };
          out = new THREE.MeshStandardMaterial({ color: look.color, roughness: look.roughness, metalness: 0 });
          // Fur darkens when it rains.
          patchWorldMaterial(out, { wet: true, porosity: 1.2 }, shared);
          swapped.set(m, out);
          this.materials.push(out);
          m.dispose();
        }
        return out;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });

    // The sprout: vertex colours, matte, wet in the rain.
    const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
    patchWorldMaterial(plantMat, { wet: true, porosity: 0.3 }, shared);
    this.materials.push(plantMat);
    this.budMesh = new THREE.Mesh(budGeometry(), plantMat);
    this.leaves = new THREE.InstancedMesh(leafGeometry(), plantMat, 4);
    for (const m of [this.budMesh, this.leaves]) {
      m.castShadow = true;
      m.frustumCulled = false;
      this.bud.add(m);
    }
    this.mountSprout(scene, head);
  }

  /**
   * Plants the sprout on the crown. In the rest pose, among the vertices the Head bone carries
   * (the ears ride their own bones), the top of the skull is the highest; the sprout sits there,
   * sunk a little in, upright. Kept in the bone's frame, at metre scale despite the armature's.
   */
  private mountSprout(scene: THREE.Object3D, head: THREE.Object3D): void {
    this.root.updateMatrixWorld(true);
    let top = -Infinity;
    let sx = 0;
    let sz = 0;
    let n = 0;
    const crown: THREE.Vector3[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      const bone = mesh.skeleton.bones.indexOf(head as THREE.Bone);
      if (bone < 0) return;
      const idx = mesh.geometry.getAttribute('skinIndex');
      const w = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < idx.count; i++) {
        let weight = 0;
        for (let k = 0; k < 4; k++) if (idx.getComponent(i, k) === bone) weight += w.getComponent(i, k);
        if (weight < 0.9) continue;
        const p = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
        top = Math.max(top, p.y);
        crown.push(p);
      }
    });
    if (crown.length === 0) throw new Error('bunny: no head vertices');
    // The crown: the topmost 2 cm of the skull, centred.
    for (const p of crown) {
      if (p.y < top - 0.02) continue;
      sx += p.x;
      sz += p.z;
      n++;
    }
    const seat = new THREE.Vector3(sx / n, top - 0.03, sz / n);
    head.add(this.bud);
    const inv = tmpM.copy(head.matrixWorld).invert();
    this.bud.position.copy(seat).applyMatrix4(inv);
    this.bud.quaternion.copy(head.getWorldQuaternion(tmpQ).invert());
    this.bud.scale.setScalar(SPROUT_SCALE / head.getWorldScale(tmpV2).x);
  }

  /** The tip of the sprout (world): leaves and pollen come from here. */
  budTop(out: THREE.Vector3): THREE.Vector3 {
    return this.bud.localToWorld(out.set(0, 0.24, 0));
  }

  /** Distance along `ray` (world, unit direction) to the bunny, or null (an ellipsoid round body and head). */
  hitTest(ray: THREE.Ray): number | null {
    if (!this.root.visible) return null;
    tmpM.copy(this.root.matrixWorld).invert();
    const o = tmpV.copy(ray.origin).applyMatrix4(tmpM);
    const d = tmpV2.copy(ray.direction).transformDirection(tmpM);
    return rayEllipsoid(o.x, o.y, o.z, d.x, d.y, d.z, 0, HEIGHT * 0.45, 0, 0.26, HEIGHT * 0.55, 0.24);
  }

  /**
   * Animates one frame: clips toward `action` (walk paced by `speed`); the sprout's leaves sway
   * (more in the wind) and open with `flare` 0..1, the bud swells a little.
   */
  update(dt: number, action: BunnyAction, speed: number, flare: number, wind: number): void {
    this.blend.action('move').timeScale = Math.min(2.5, Math.max(0.6, speed / WALK_CLIP_SPEED));
    this.blend.update(dt, action);
    this.sway += dt * (2 + 3 * wind + 4 * flare);
    for (let i = 0; i < 4; i++) {
      const droop = LEAF_REST + (LEAF_OPEN - LEAF_REST) * flare + Math.sin(this.sway + i * 1.7) * (0.05 + 0.12 * wind + 0.08 * flare);
      tmpQ.setFromEuler(tmpE.set(droop, (i * Math.PI) / 2 + Math.PI / 4, 0, 'YXZ'));
      this.leaves.setMatrixAt(i, tmpM.compose(tmpV.set(0, LEAF_BASE, 0), tmpQ, LEAF_SIZE));
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    this.budMesh.scale.setScalar(1 + 0.15 * flare);
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
