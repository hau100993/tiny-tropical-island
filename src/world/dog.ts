import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchWorldMaterial } from './patchMaterial';
import type { SharedUniforms } from '../core/uniforms';
import { rayEllipsoid } from '../activities/petting';

/** Height of the top of the head (m) for a Shiba Inu; the model is scaled to it. */
const HEAD_HEIGHT = 0.55;
/**
 * Ground speed (m/s) of the walk and gallop clips at normal playback, at that size (measured
 * from a paw's travel during its stance). Playback speeds up with the dog's speed so the paws
 * don't slide.
 */
const WALK_CLIP_SPEED = 0.35;
const GALLOP_CLIP_SPEED = 0.9;

/** What the dog is doing, for the animation (the companion decides). */
export type DogAction = 'move' | 'idle' | 'sniff' | 'lie' | 'sit';

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
/**
 * What the pointer can hit (m, around the bones, in the dog's own frame): an ellipsoid round
 * the body (centred a little under the spine) and a ball round the head. Generous, so the dog
 * is easy to point at.
 */
const BODY_DROP = 0.07;
const BODY_RADII = [0.13, 0.18, 0.32] as const;
const HEAD_RADIUS = 0.14;

interface PosePart {
  bone: THREE.Object3D;
  quat: THREE.Quaternion;
  pos: THREE.Vector3 | null;
}

/**
 * A pose built from the standing one (model units: the dog stands ~3.1 tall, facing +Z): the
 * body pitched nose-up by `pitch` (rad) about the hips, then lowered by `drop`; each leg's
 * joints (elbow/paw in front; knee/hock/paw behind) where they should end up. Left side; the
 * right is mirrored.
 */
interface PoseSpec {
  drop: number;
  pitch: number;
  /** Neck bent back down (rad), so the face looks ahead rather than up when the body is pitched. */
  neck: number;
  frontElbow: [number, number, number];
  frontPaw: [number, number, number];
  backKnee: [number, number, number];
  backHock: [number, number, number];
  backPaw: [number, number, number];
}

/** Lying on the belly: front legs stretched forward, hind legs folded, head up. */
const LIE: PoseSpec = {
  drop: 0.95,
  pitch: 0,
  neck: 0,
  frontElbow: [0.36, 0.16, 0.86],
  frontPaw: [0.36, 0.07, 1.85],
  backKnee: [0.46, 0.22, -0.2],
  backHock: [0.5, 0.1, -1.15],
  backPaw: [0.48, 0.07, -0.6],
};
/** Sitting: rump on the ground, chest up on straight front legs, hind legs folded beside it. */
const SIT: PoseSpec = {
  drop: 1.1,
  pitch: 0.6,
  neck: 0.45,
  frontElbow: [0.33, 0.8, 0.78],
  frontPaw: [0.33, 0.07, 1.0],
  backKnee: [0.47, 0.32, -0.05],
  backHock: [0.47, 0.1, -0.95],
  backPaw: [0.45, 0.07, -0.35],
};
/** The hips (model units, standing): the sitting pose pivots here. */
const HIPS: [number, number, number] = [0, 1.69, -0.61];

/**
 * The Shiba Inu (Quaternius, CC0): its own animation clips for walking, galloping, standing
 * and sniffing, playback matched to its speed; lying and sitting poses made here (the file has
 * none): see LIE and SIT. On top: a wagging
 * tail and a head that turns toward a point (you). Model space: facing +Z, paws at y = 0.
 */
export class DogModel {
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly walk: THREE.AnimationAction;
  private readonly gallop: THREE.AnimationAction;
  private readonly idle: THREE.AnimationAction;
  private readonly sniff: THREE.AnimationAction;
  private readonly jump: THREE.AnimationAction;
  private readonly lie: PosePart[] = [];
  private readonly sit: PosePart[] = [];
  private readonly tail: THREE.Object3D[] = [];
  private readonly neck: THREE.Object3D[] = [];
  /** Mid-back spine bone: the body's hit ellipsoid and the end of a stroke follow it. */
  private readonly torso: THREE.Object3D;
  /** Being petted (0..1, smoothed): the head tilts into the hand. */
  private nuzzle = 0;
  private readonly materials: THREE.Material[] = [];
  /**
   * Bones this class turns itself (lying pose, tail, head), with their rest pose: put back
   * before the clips play each frame, so the extra turns never pile up on bones no clip moves.
   */
  private readonly own: { bone: THREE.Object3D; quat: THREE.Quaternion; pos: THREE.Vector3 }[] = [];
  /** Smoothed blend weights. */
  private wMove = 0;
  private wGallop = 0;
  private wSniff = 0;
  private wLie = 0;
  private wSit = 0;
  private wagPhase = 0;
  private jumpLeft = 0;
  private lookYaw = 0;

  static async load(url: string, shared: SharedUniforms): Promise<DogModel> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new DogModel(gltf.scene, gltf.animations, shared);
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[], shared: SharedUniforms) {
    const box = new THREE.Box3().setFromObject(scene);
    const fit = new THREE.Group();
    fit.scale.setScalar(HEAD_HEIGHT / (box.max.y - box.min.y));
    fit.add(scene);
    this.root.add(fit);

    this.mixer = new THREE.AnimationMixer(scene);
    const clip = (name: string): THREE.AnimationClip => {
      const c = clips.find((a) => a.name === name);
      if (!c) throw new Error(`dog: no clip ${name}`);
      return c;
    };
    const play = (name: string): THREE.AnimationAction => {
      const a = this.mixer.clipAction(clip(name));
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.idle = play('Idle');
    this.walk = play('Walk');
    this.gallop = play('Gallop');
    this.sniff = play('Eating');
    this.jump = this.mixer.clipAction(clip('Jump_ToIdle'));
    this.jump.setLoop(THREE.LoopOnce, 1);
    this.jump.clampWhenFinished = false;
    this.idle.setEffectiveWeight(1);

    const find = (n: string): THREE.Object3D => {
      const o = scene.getObjectByName(n);
      if (!o) throw new Error(`dog: no bone ${n}`);
      return o;
    };
    for (const n of ['Tail1', 'Tail2', 'Tail3']) this.tail.push(find(n));
    for (const n of ['Neck1', 'Neck2', 'Head']) this.neck.push(find(n));
    this.torso = find('Torso2');

    // The lying pose, built once from the standing (Idle) pose: lower the body, then aim each
    // leg bone at where its joint should be (a Blender bone points along its own +Y).
    this.mixer.setTime(0);
    this.root.updateMatrixWorld(true);
    const rest = new Map<THREE.Object3D, [THREE.Quaternion, THREE.Vector3]>();
    scene.traverse((o) => rest.set(o, [o.quaternion.clone(), o.position.clone()]));
    const restore = (): void => {
      for (const [o, [q, p]] of rest) {
        o.quaternion.copy(q);
        o.position.copy(p);
      }
      this.root.updateMatrixWorld(true);
    };
    this.lie.push(...this.buildPose(find, fit.scale.x, LIE));
    restore();
    this.sit.push(...this.buildPose(find, fit.scale.x, SIT));
    restore();
    for (const b of [...this.lie.map((l) => l.bone), ...this.sit.map((l) => l.bone), ...this.tail, ...this.neck]) {
      const r = rest.get(b);
      if (r) this.own.push({ bone: b, quat: r[0].clone(), pos: r[1].clone() });
    }
    this.mixer.setTime(0);

    // Materials: plain colours, matte, and the world's wetness (rain on fur).
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
          const eye = m.name.toLowerCase().includes('eye');
          out = new THREE.MeshStandardMaterial({ color: src.color, roughness: eye ? 0.3 : 0.9, metalness: 0 });
          patchWorldMaterial(out, { wet: true, porosity: 1.2 }, shared);
          swapped.set(m, out);
          this.materials.push(out);
          m.dispose();
        }
        return out;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }

  /** Builds a pose (see PoseSpec) from the standing one; returns the bones' local transforms. */
  private buildPose(find: (n: string) => THREE.Object3D, scale: number, spec: PoseSpec): PosePart[] {
    const body = find('Body');
    const parts: [THREE.Object3D, THREE.Quaternion, THREE.Vector3 | null][] = [];
    const keep = (o: THREE.Object3D, withPos: boolean): void => {
      parts.push([o, o.quaternion.clone(), withPos ? o.position.clone() : null]);
    };
    const world = (o: THREE.Object3D): THREE.Vector3 => o.getWorldPosition(new THREE.Vector3());
    // Positions below are in the model's own units (it stands ~3.1 tall); the root is at the
    // origin here, so world = model units × scale.
    const m = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).multiplyScalar(scale);
    // The body: pitched nose-up about the hips, then lowered.
    const bodyParent = body.parent as THREE.Object3D;
    const pivot = m(...HIPS);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -spec.pitch);
    const bw = world(body).sub(pivot).applyQuaternion(turn).add(pivot);
    bw.y -= spec.drop * scale;
    const bq = body.getWorldQuaternion(new THREE.Quaternion()).premultiply(turn);
    body.position.copy(bodyParent.worldToLocal(bw));
    body.quaternion.copy(bodyParent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bq));
    body.updateMatrixWorld(true);
    keep(body, true);
    if (spec.neck) {
      const neck = find('Neck1');
      const nq = neck.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spec.neck));
      neck.quaternion.copy((neck.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion()).invert().multiply(nq));
      neck.updateMatrixWorld(true);
      keep(neck, false);
    }
    const aim = (bone: THREE.Object3D, target: THREE.Vector3): void => {
      const p = world(bone);
      const q = bone.getWorldQuaternion(new THREE.Quaternion());
      const axis = UP.clone().applyQuaternion(q);
      const want = tmpV.copy(target).sub(p).normalize();
      q.premultiply(tmpQ.setFromUnitVectors(axis, want));
      bone.quaternion.copy((bone.parent as THREE.Object3D).getWorldQuaternion(tmpQ2).invert().multiply(q));
      bone.updateMatrixWorld(true);
      keep(bone, false);
    };
    const place = (bone: THREE.Object3D, target: THREE.Vector3, forward: THREE.Vector3): void => {
      const parent = bone.parent as THREE.Object3D;
      parent.updateWorldMatrix(true, false);
      bone.position.copy(parent.worldToLocal(target.clone()));
      // Paw flat on the ground, pointing `forward` (its +Y is along the foot).
      const q = bone.getWorldQuaternion(new THREE.Quaternion());
      const axis = UP.clone().applyQuaternion(q);
      q.premultiply(tmpQ.setFromUnitVectors(axis, forward.clone().normalize()));
      bone.quaternion.copy(parent.getWorldQuaternion(tmpQ2).invert().multiply(q));
      bone.updateMatrixWorld(true);
      keep(bone, true);
    };
    const mx = (v: [number, number, number], s: number): THREE.Vector3 => m(s * v[0], v[1], v[2]);
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R';
      aim(find(`FrontUpperLeg${L}`), mx(spec.frontElbow, s));
      aim(find(`FrontLowerLeg${L}`), mx(spec.frontPaw, s));
      place(find(`FF${L}`), mx(spec.frontPaw, s), new THREE.Vector3(0, 0, 1));
      aim(find(`BackUpperLeg${L}`), mx(spec.backKnee, s));
      aim(find(`BackLowerLeg${L}`), mx(spec.backHock, s));
      place(find(`FFB${L}`), mx(spec.backPaw, s), new THREE.Vector3(0, 0, 1));
    }
    return parts.map(([bone, quat, pos]) => ({ bone, quat, pos }));
  }

  /** A short happy jump (being petted). */
  hop(): void {
    this.jump.reset().play();
    this.jump.setEffectiveWeight(1);
    this.jumpLeft = this.jump.getClip().duration;
  }

  /**
   * Distance along `ray` (world, unit direction) to the dog, or null if it misses: for pointing
   * at it with the mouse. Analytic (ellipsoid and ball, see BODY_RADII), no mesh raycast.
   */
  hitTest(ray: THREE.Ray): number | null {
    if (!this.root.visible) return null;
    tmpM.copy(this.root.matrixWorld).invert();
    // The root only turns and moves (no scale): distances stay in metres.
    const o = tmpV.copy(ray.origin).applyMatrix4(tmpM);
    const d = tmpV2.copy(ray.direction).transformDirection(tmpM);
    const b = this.root.worldToLocal(this.torso.getWorldPosition(tmpV3));
    const [rx, ry, rz] = BODY_RADII;
    const body = rayEllipsoid(o.x, o.y, o.z, d.x, d.y, d.z, b.x, b.y - BODY_DROP, b.z, rx, ry, rz);
    const h = this.root.worldToLocal(this.neck[2].getWorldPosition(tmpV3));
    const head = rayEllipsoid(o.x, o.y, o.z, d.x, d.y, d.z, h.x, h.y, h.z, HEAD_RADIUS, HEAD_RADIUS, HEAD_RADIUS);
    if (body === null) return head;
    return head === null ? body : Math.min(body, head);
  }

  /**
   * Where a hand strokes the fur (world): from the top of the head (`head`) down the neck to
   * the middle of the back (`back`). Both follow the bones, so sitting or lying works too.
   */
  petPoints(head: THREE.Vector3, back: THREE.Vector3): void {
    this.neck[2].getWorldPosition(head);
    head.y += 0.075;
    this.torso.getWorldPosition(back);
    back.y += 0.075;
  }

  /** The top of the head (world), where hearts rise from. */
  headTop(out: THREE.Vector3): THREE.Vector3 {
    this.neck[2].getWorldPosition(out);
    out.y += 0.12;
    return out;
  }

  /**
   * Animates one frame. `speed` (m/s) picks and paces walk/gallop; `wag` 0..1 how hard the tail
   * wags; `look` a world point the head turns toward (or null); `petted` 0..1 while a hand
   * strokes it (the head tilts and lifts into the hand).
   */
  update(dt: number, action: DogAction, speed: number, wag: number, look: THREE.Vector3 | null, petted = 0): void {
    const k = (rate: number): number => 1 - Math.exp(-dt * rate);
    const moving = action === 'move' && speed > 0.05;
    this.wMove += ((moving ? 1 : 0) - this.wMove) * k(8);
    this.wGallop += ((speed > 1.0 ? 1 : 0) - this.wGallop) * k(5);
    this.wSniff += ((action === 'sniff' ? 1 : 0) - this.wSniff) * k(4);
    this.wLie += ((action === 'lie' ? 1 : 0) - this.wLie) * k(3);
    this.wSit += ((action === 'sit' ? 1 : 0) - this.wSit) * k(3);
    const down = Math.min(1, this.wLie + this.wSit);
    const move = this.wMove * (1 - down);
    this.walk.setEffectiveWeight(move * (1 - this.wGallop));
    this.gallop.setEffectiveWeight(move * this.wGallop);
    this.sniff.setEffectiveWeight((1 - this.wMove) * this.wSniff * (1 - down));
    this.idle.setEffectiveWeight(Math.max(0.001, 1 - move - this.sniff.getEffectiveWeight()));
    this.walk.timeScale = Math.min(3, Math.max(0.6, speed / WALK_CLIP_SPEED));
    this.gallop.timeScale = Math.min(3.2, Math.max(0.8, speed / GALLOP_CLIP_SPEED));
    if (this.jumpLeft > 0) {
      this.jumpLeft -= dt;
      if (this.jumpLeft <= 0) this.jump.stop();
    }
    for (const o of this.own) {
      o.bone.quaternion.copy(o.quat);
      o.bone.position.copy(o.pos);
    }
    this.mixer.update(dt);

    // Lying or sitting: blend the legs and body toward that pose.
    for (const [pose, w] of [[this.lie, this.wLie], [this.sit, this.wSit]] as const) {
      if (w < 0.001) continue;
      for (const p of pose) {
        p.bone.quaternion.slerp(p.quat, w);
        if (p.pos) p.bone.position.lerp(p.pos, w);
      }
    }
    this.root.updateMatrixWorld(true);
    // Tail wag: side to side about the body's up axis (world), stronger toward the tip.
    this.wagPhase += dt * (7 + 7 * wag);
    const amp = 0.08 + 0.35 * wag;
    this.tail.forEach((b, i) => this.turnWorld(b, UP, Math.sin(this.wagPhase - i * 0.6) * amp * (0.6 + 0.3 * i)));
    // Head toward the look point, shared between the neck and the head, limited like a dog's.
    let want = 0;
    if (look) {
      const head = this.neck[2].getWorldPosition(tmpV2);
      const local = this.root.worldToLocal(tmpV.copy(look)).sub(this.root.worldToLocal(head));
      want = Math.max(-1.1, Math.min(1.1, Math.atan2(local.x, local.z)));
    }
    this.lookYaw += (want - this.lookYaw) * k(4);
    this.neck.forEach((b, i) => this.turnWorld(b, UP, this.lookYaw * [0.3, 0.3, 0.4][i]));
    // Leaning into the hand: the head tilts to one side and the nose comes up a little, with
    // a slow sway.
    this.nuzzle += (petted - this.nuzzle) * k(3);
    if (this.nuzzle > 0.001) {
      const fwd = tmpV.set(0, 0, 1).transformDirection(this.root.matrixWorld);
      const side = tmpV2.set(1, 0, 0).transformDirection(this.root.matrixWorld);
      const sway = Math.sin(this.wagPhase * 0.08);
      this.turnWorld(this.neck[2], fwd, this.nuzzle * (0.28 + 0.08 * sway));
      this.turnWorld(this.neck[1], side, -this.nuzzle * 0.18);
    }
  }

  /** Turns a bone by `angle` about a world axis (around its own joint). */
  private turnWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
    const parent = bone.parent as THREE.Object3D;
    const q = bone.getWorldQuaternion(tmpQ).premultiply(tmpQ2.setFromAxisAngle(axis, angle));
    bone.quaternion.copy(parent.getWorldQuaternion(tmpQ2).invert().multiply(q));
    bone.updateMatrixWorld(true);
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
