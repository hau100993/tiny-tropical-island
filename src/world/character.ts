import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AVATAR_HIP_Y, AVATAR_LEG, type AvatarRig } from './avatar';
import { patchWorldMaterial } from './patchMaterial';
import type { SharedUniforms } from '../core/uniforms';

/** The procedural bones a character bone can follow. */
type Source = 'hips' | 'torso' | 'head' | 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle';

/**
 * One character bone driven by the procedural skeleton: it turns by the same amount, in the
 * body's space, as `from` has turned from its rest pose (or part way from `from` to `to`, for a
 * spine with more bones than ours). `aim` is the direction (body space) the procedural bone
 * points at rest; the character bone's rest is first swung onto it (its rest is a T-pose, ours
 * has the arms down).
 */
interface Link {
  bone: string;
  from: Source;
  to?: Source;
  t?: number;
  side?: 0 | 1;
  aim?: THREE.Vector3;
  /** Turn (rad) about `aim` after the swing: the arms roll so the palms face the thighs. */
  roll?: number;
  /** Tilt (rad) away from the body, about the forward axis (> 0 outward). */
  spread?: number;
}

const DOWN = new THREE.Vector3(0, -1, 0);
const AHEAD = new THREE.Vector3(0, 0, -1);
/**
 * Arm roll about the hanging arm (rad). The T-pose has the palms down and the thumbs forward;
 * swung down beside the body the palms already face the thighs, thumbs a little inward. This
 * small turn brings the thumbs to point forward, like the built-in body (measured: thumb
 * direction against the facing direction).
 */
const PALM_ROLL = -0.4;
/**
 * Arms hanging a little away from the body (rad, outward): these models are broad at the hips
 * and the hands rested against the thighs. The forearm opens a touch more (the elbow's natural
 * carrying angle).
 */
const ARM_SPREAD = 0.14;
const FOREARM_SPREAD = 0.22;
/**
 * A relaxed hand: how much each finger joint curls toward the palm (rad, base to tip). The
 * bind pose has them straight and spread (a robot's hand); much more than this and, with the
 * palms toward the thighs, the hands read as bent inward.
 */
const FINGER_CURL: readonly (readonly [string, readonly number[]])[] = [
  ['Thumb', [0.05, 0.1, 0.1]],
  ['Index', [0.1, 0.15, 0.1]],
  ['Middle', [0.12, 0.18, 0.12]],
  ['Ring', [0.14, 0.2, 0.14]],
  ['Pinky', [0.16, 0.22, 0.15]],
];
/** These models' hands are large for the body, the fingers especially: palm and fingers scale. */
const PALM_SCALE = 0.9;
const FINGER_SCALE = 0.84;

/**
 * Bone map for Quaternius' characters (the "Ultimate Animated Character" rig; three.js drops the
 * dots from bone names, so `UpperArm.L` is `UpperArmL`). Parents before children. `Body` carries
 * both the spine and the thighs, so it takes the pelvis's turn and position.
 */
function quaterniusLinks(): Link[] {
  const links: Link[] = [
    { bone: 'Body', from: 'hips' },
    { bone: 'Hips', from: 'hips' },
    { bone: 'Abdomen', from: 'hips', to: 'torso', t: 0.35 },
    { bone: 'Torso', from: 'hips', to: 'torso', t: 0.7 },
    { bone: 'Chest', from: 'torso' },
    { bone: 'Neck', from: 'torso', to: 'head', t: 0.5 },
    { bone: 'Head', from: 'head' },
  ];
  for (const [side, s] of [[0, 'L'], [1, 'R']] as const) {
    // Mirrored for the right arm.
    const roll = (side === 0 ? 1 : -1) * PALM_ROLL;
    links.push(
      { bone: `Shoulder${s}`, from: 'torso' },
      { bone: `UpperArm${s}`, from: 'shoulder', side, aim: DOWN, roll, spread: ARM_SPREAD },
      { bone: `LowerArm${s}`, from: 'elbow', side, aim: DOWN, roll, spread: FOREARM_SPREAD },
      { bone: `Wrist${s}`, from: 'wrist', side, aim: DOWN, roll, spread: FOREARM_SPREAD },
      { bone: `UpperLeg${s}`, from: 'hip', side, aim: DOWN },
      { bone: `LowerLeg${s}`, from: 'knee', side, aim: DOWN },
      { bone: `Foot${s}`, from: 'ankle', side, aim: AHEAD },
    );
  }
  return links;
}

interface Driven {
  link: Link;
  node: THREE.Object3D;
  /** Rest orientation in body space, already swung onto the procedural rest direction. */
  rest: THREE.Quaternion;
}

export interface CharacterSpec {
  url: string;
  /** Standing height (m) to scale the model to. */
  height: number;
}

const loader = new GLTFLoader();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpQ3 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const deltas = new Map<string, THREE.Quaternion>();

/**
 * A character loaded from a .glb file that wears the procedural skeleton's motion: every frame
 * it copies the pose (walking with planted feet, swimming, paddling, surfing) onto its own
 * bones (retargeting). The procedural body is scaled so its legs are as long as the
 * character's, which keeps the feet on the ground. Its materials get the world's wetness and
 * cloud shadows like the built-in body.
 */
export class GlbCharacter {
  /** Child of the avatar's group, scaled back to metres (the group carries the body scale). */
  readonly root = new THREE.Group();
  /** Body scale that gives the procedural skeleton this character's leg length. */
  readonly bodyScale: number;
  private readonly driven: Driven[] = [];
  private readonly body: THREE.Object3D;
  private readonly bodyRestPos = new THREE.Vector3();
  private readonly feet: { node: THREE.Object3D; shin: THREE.Object3D; ankleInShin: THREE.Vector3; offset: THREE.Vector3 }[] = [];
  private readonly head: THREE.Object3D | null;
  private readonly materials: THREE.Material[] = [];

  /** `shared`: the uniforms its materials read (with the avatar's own `uWetness`). */
  static async load(spec: CharacterSpec, shared: SharedUniforms): Promise<GlbCharacter> {
    const gltf = await loader.loadAsync(spec.url);
    return new GlbCharacter(gltf.scene, spec.height, shared);
  }

  private constructor(scene: THREE.Group, height: number, shared: SharedUniforms) {
    // Bind pose (the file's own node pose is just some frame), measured with the root at the
    // origin: the "body space" below is this root's space (metres, facing −Z, Y up).
    const skinned: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    const skeleton = skinned[0]?.skeleton;
    if (!skeleton) throw new Error('character: no skinned mesh');
    scene.updateMatrixWorld(true);
    skeleton.pose();
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const fit = new THREE.Group();
    fit.scale.setScalar(height / (box.max.y - box.min.y));
    fit.position.y = -box.min.y * fit.scale.y;
    fit.add(scene);
    // The models face +Z; ours faces −Z.
    const turn = new THREE.Group();
    turn.rotation.y = Math.PI;
    turn.add(fit);
    this.root.add(turn);
    this.root.updateMatrixWorld(true);

    const find = (name: string): THREE.Object3D => {
      const n = scene.getObjectByName(name);
      if (!n) throw new Error(`character: no bone ${name}`);
      return n;
    };
    const worldQ = (o: THREE.Object3D): THREE.Quaternion => o.getWorldQuaternion(new THREE.Quaternion());
    const worldP = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());
    // A Blender bone points along its own +Y.
    const axis = (o: THREE.Object3D): THREE.Vector3 => new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ(o));

    // Relaxed hands, set once (the fingers aren't driven): each joint, base first, turns toward
    // the palm, which faces down in the T-pose.
    const palm = new THREE.Vector3(0, -1, 0);
    for (const s of ['L', 'R']) {
      // Smaller hands: the wrist scales the palm and (through it) the fingers; the finger roots
      // shorten the fingers further.
      scene.getObjectByName(`Wrist${s}`)?.scale.setScalar(PALM_SCALE);
      for (const [finger, curl] of FINGER_CURL) {
        scene.getObjectByName(`${finger}1${s}`)?.scale.setScalar(FINGER_SCALE);
        for (let j = 0; j < curl.length; j++) {
          const b = scene.getObjectByName(`${finger}${j + 1}${s}`);
          if (!b?.parent) continue;
          const bendAxis = axis(b).cross(palm).normalize();
          const want = worldQ(b).premultiply(tmpQ.setFromAxisAngle(bendAxis, curl[j]));
          b.quaternion.copy(worldQ(b.parent).invert().multiply(want));
          b.updateMatrixWorld(true);
        }
      }
    }

    for (const link of quaterniusLinks()) {
      const node = find(link.bone);
      const rest = worldQ(node);
      if (link.aim) {
        rest.premultiply(tmpQ.setFromUnitVectors(axis(node), link.aim));
        if (link.roll) rest.premultiply(tmpQ.setFromAxisAngle(link.aim, link.roll));
        // Outward: the left arm (on −X) tilts toward −X, i.e. a turn about −Z (forward is −Z).
        if (link.spread) rest.premultiply(tmpQ.setFromAxisAngle(AHEAD, (link.side === 0 ? 1 : -1) * link.spread));
      }
      this.driven.push({ link, node, rest });
    }
    this.body = find('Body');
    this.bodyRestPos.copy(worldP(this.body));
    this.head = scene.getObjectByName('Head') ?? null;

    // Legs: the foot is a separate IK bone under the root, so it is placed at the end of the
    // shin each frame. The ankle joint: on the shin's line, a little above the sole.
    let leg = 0;
    for (const s of ['L', 'R']) {
      const thigh = find(`UpperLeg${s}`);
      const shin = find(`LowerLeg${s}`);
      const foot = find(`Foot${s}`);
      const shinP = worldP(shin);
      const dir = axis(shin);
      const ankleY = worldP(foot).y + 0.045 * height;
      const ankle = shinP.clone().addScaledVector(dir, (shinP.y - ankleY) / Math.max(0.2, -dir.y));
      leg = worldP(thigh).distanceTo(shinP) + shinP.distanceTo(ankle);
      const ankleInShin = shin.worldToLocal(ankle.clone());
      // The foot bone's origin relative to the ankle, in the foot's own (rest) frame.
      const offset = worldP(foot).sub(ankle).applyQuaternion(worldQ(foot).invert());
      this.feet.push({ node: foot, shin, ankleInShin, offset });
    }
    this.bodyScale = leg / AVATAR_LEG;
    this.root.scale.setScalar(1 / this.bodyScale);

    // Materials: plain colours from the file, made matte and patched for wetness.
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
          const src = m as THREE.MeshStandardMaterial;
          const name = (m.name || '').toLowerCase();
          out = new THREE.MeshStandardMaterial({
            color: src.color ?? new THREE.Color(1, 1, 1),
            roughness: name.includes('hair') ? 0.5 : name.includes('skin') ? 0.6 : 0.85,
            metalness: 0,
          });
          // Skin mostly just turns glossy when wet; cloth and hair darken.
          patchWorldMaterial(out, { wet: true, porosity: name.includes('skin') ? 0.3 : name.includes('hair') ? 1.2 : 1.5 }, shared);
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
   * Copies the procedural skeleton's pose. `rig.group` must have been posed this frame; this
   * object must be a child of it (scaled by 1 / bodyScale).
   */
  sync(rig: AvatarRig): void {
    rig.group.updateMatrixWorld(true);
    // Each procedural bone's turn from its rest, in body space (its rest is identity there).
    const inv = rig.group.getWorldQuaternion(tmpQ).invert();
    const turn = (key: string, b: THREE.Object3D): void => {
      let q = deltas.get(key);
      if (!q) deltas.set(key, (q = new THREE.Quaternion()));
      b.getWorldQuaternion(q).premultiply(inv);
    };
    turn('hips', rig.hips);
    turn('torso', rig.torso);
    turn('head', rig.head);
    for (let i = 0; i < 2; i++) {
      turn(`shoulder${i}`, rig.shoulders[i]);
      turn(`elbow${i}`, rig.elbows[i]);
      turn(`wrist${i}`, rig.wrists[i]);
      turn(`hip${i}`, rig.hipJoints[i]);
      turn(`knee${i}`, rig.knees[i]);
      turn(`ankle${i}`, rig.ankles[i]);
    }
    const key = (src: Source, side: 0 | 1 | undefined): string =>
      src === 'hips' || src === 'torso' || src === 'head' ? src : `${src}${side ?? 0}`;

    const rootQ = this.root.getWorldQuaternion(tmpQ3);
    for (const d of this.driven) {
      const { link, node } = d;
      const a = deltas.get(key(link.from, link.side)) as THREE.Quaternion;
      const turnQ = link.to ? tmpQ.slerpQuaternions(a, deltas.get(key(link.to, link.side)) as THREE.Quaternion, link.t ?? 0.5) : tmpQ.copy(a);
      // Wanted world orientation, then the local one under the (already placed) parent.
      const want = turnQ.multiply(d.rest).premultiply(rootQ);
      const parent = node.parent as THREE.Object3D;
      node.quaternion.copy(parent.getWorldQuaternion(tmpQ2).invert().multiply(want));
      if (node === this.body) {
        // The pelvis's move from rest (lower when the legs reach, sitting in the kayak, ...).
        const k = rig.group.scale.x;
        tmpV.copy(rig.hips.position).sub(tmpV2.set(0, AVATAR_HIP_Y, 0)).multiplyScalar(k);
        tmpV.add(this.bodyRestPos);
        this.root.localToWorld(tmpV);
        parent.updateWorldMatrix(true, false);
        node.position.copy(parent.worldToLocal(tmpV));
      }
      node.updateWorldMatrix(false, false);
      if (node.name.startsWith('Foot')) this.placeFoot(node, want);
    }
    // First person: the head shrinks away like the built-in one.
    if (this.head) this.head.scale.setScalar(rig.head.scale.x);
  }

  /** The foot bone hangs from the end of the shin, turned as wanted (world). */
  private placeFoot(node: THREE.Object3D, want: THREE.Quaternion): void {
    const f = this.feet.find((x) => x.node === node);
    if (!f) return;
    f.shin.updateWorldMatrix(true, false);
    const ankle = f.shin.localToWorld(tmpV.copy(f.ankleInShin));
    ankle.add(tmpV2.copy(f.offset).applyQuaternion(want));
    const parent = node.parent as THREE.Object3D;
    node.position.copy(parent.worldToLocal(ankle));
    node.updateWorldMatrix(false, false);
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
