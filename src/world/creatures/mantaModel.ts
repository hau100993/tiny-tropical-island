import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchWorldMaterial } from '../patchMaterial';
import { smoothModel } from '../smoothMesh';
import type { SharedUniforms } from '../../core/uniforms';
import { findClip, prepareSkinned } from './glbUtil';
import { MANTA_WINGSPAN } from '../../activities/flight/mantaSize';

/** Wingspan with the wings spread flat (m). */
export const WINGSPAN = MANTA_WINGSPAN;
/** Time in the Swim clip where the wings lie flat: the glide pose. */
const GLIDE_TIME = 4.0;
/**
 * Where the rider lies, in the file's own units (≈ m): the point on its back under the chest
 * (the back's top is ~0.3 there, measured), the head reaching toward the harness.
 */
const BACK = new THREE.Vector3(0, 0.3, 0.8);
/**
 * The harness: a strap round the head behind the eyes (file units: its middle ~0.17 up, the head
 * ~1.1 wide and 0.46 tall there) and a handle arching up and back from it to where the rider's
 * hands are. The grips are set in metres from where the rider lies (an arm's reach from the
 * shoulders, whatever the manta's size): `x` either side, `up`, `ahead`.
 */
const STRAP = { z: 2.1, y: 0.17, halfW: 0.62, halfH: 0.29, tilt: 0.12, r: 0.04 } as const;
// Measured on the avatar lying here: shoulders ±0.19 wide, 0.25 up, 0.13 ahead; arm (shoulder to
// wrist) 0.495 m, and the palm holds ~4.5 cm past the wrist. The grips sit shoulder-wide where
// the wrist ends up at ~97% of that reach: arms nearly straight.
const GRIP = { x: 0.19, up: 0.345, ahead: 0.645 } as const;

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);
/** The rider's frame faces −Z (the avatar's convention), the model +Z. */
const TURN_SEAT = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

/**
 * Pattern of the back and the belly, painted in the shader from each vertex's place on the body
 * (`aManta`: across, from the middle, and along, from the front of the head, in metres of the
 * file). Back: deep blue going teal toward the wing tips, the pale "shoulder" chevrons real
 * mantas have, and pale spots on the wings that glow at night. Belly: white, grey-blue margins,
 * a few dark spots. Both: an iridescent rim (stronger at night) so it reads against the sky.
 */
const PATTERN_PARS = /* glsl */ `
uniform float uMantaTime;
varying vec2 vManta;
float mantaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
/** Round spots on a jittered grid: 1 inside a spot, soft edge. */
float mantaSpots(vec2 p, float cell, float keep, float rMin, float rMax) {
  vec2 c = floor(p / cell);
  vec2 f = p / cell - c;
  float h = mantaHash(c);
  if (h > keep) return 0.0;
  vec2 o = vec2(mantaHash(c + 7.3), mantaHash(c + 3.1)) * 0.5 + 0.25;
  float r = mix(rMin, rMax, mantaHash(c + 1.7)) / cell;
  return 1.0 - smoothstep(r * 0.7, r, length(f - o));
}
`;

const BACK_COLOR = /* glsl */ `
{
  float a = abs(vManta.x);
  float s = vManta.y;
  vec3 col = mix(vec3(0.035, 0.085, 0.17), vec3(0.06, 0.3, 0.38), smoothstep(0.8, 4.0, a));
  // A darker ridge along the spine, and the tail darker still.
  col *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.7, a));
  col *= 1.0 - 0.45 * smoothstep(5.0, 7.0, s);
  // Shoulder chevrons: pale bands sweeping out and back from behind the head.
  float line = abs(s - (1.25 + 0.42 * a));
  float chevron = (1.0 - smoothstep(0.18, 0.42, line)) * smoothstep(0.45, 0.9, a) * (1.0 - smoothstep(2.0, 2.9, a));
  col = mix(col, vec3(0.72, 0.88, 0.9), 0.7 * chevron);
  // Pale spots over the wings.
  mantaGlow = mantaSpots(vManta, 0.55, 0.55, 0.05, 0.11) * smoothstep(0.9, 1.4, a) * (1.0 - smoothstep(5.0, 5.8, s));
  col = mix(col, vec3(0.62, 0.92, 1.0), 0.65 * mantaGlow);
  diffuseColor.rgb = col;
}
`;

const BELLY_COLOR = /* glsl */ `
{
  float a = abs(vManta.x);
  float s = vManta.y;
  vec3 col = mix(vec3(0.92, 0.94, 0.95), vec3(0.32, 0.42, 0.52), smoothstep(2.6, 4.1, a));
  col = mix(col, vec3(0.1, 0.13, 0.17), smoothstep(5.0, 6.5, s));
  float spots = mantaSpots(vManta + 0.3, 0.4, 0.5, 0.04, 0.09) * (1.0 - smoothstep(1.2, 1.8, a)) * smoothstep(1.5, 2.0, s) * (1.0 - smoothstep(4.0, 4.6, s));
  col = mix(col, vec3(0.16, 0.18, 0.22), 0.8 * spots);
  diffuseColor.rgb = col;
}
`;

const RIM_GLSL = /* glsl */ `
{
  vec3 viewDir = normalize(vViewPosition);
  float rim = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
  float shift = 0.5 + 0.5 * sin(vManta.x * 1.3 + vManta.y * 0.8 + uMantaTime * 0.4);
  vec3 iris = mix(vec3(0.3, 0.9, 1.0), vec3(0.7, 0.55, 1.0), shift);
  totalEmissiveRadiance += iris * rim * (0.22 + 0.35 * uNight);
  // The wing spots glow at night (bioluminescence), breathing slowly.
  float breathe = 0.75 + 0.25 * sin(uMantaTime * 1.3 + vManta.y * 0.9);
  totalEmissiveRadiance += vec3(0.35, 0.95, 1.0) * mantaGlow * (0.05 + 1.4 * uNight) * breathe;
}
`;

function patchManta(material: THREE.MeshStandardMaterial, back: boolean, shared: SharedUniforms): void {
  patchWorldMaterial(material, { wet: true, porosity: 0.15 }, shared);
  const world = material.onBeforeCompile;
  const worldKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    world.call(material, shader, renderer);
    shader.uniforms.uMantaTime = shared.uTime;
    shader.vertexShader = `attribute vec2 aManta;\nvarying vec2 vManta;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvManta = aManta;',
    );
    shader.fragmentShader = `${PATTERN_PARS}\n${shader.fragmentShader}`
      .replace('#include <color_fragment>', `#include <color_fragment>\nfloat mantaGlow = 0.0;\n${back ? BACK_COLOR : BELLY_COLOR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${RIM_GLSL}`);
  };
  material.customProgramCacheKey = () => `${worldKey}|manta:${back ? 'back' : 'belly'}`;
}

/**
 * Cá Đuối Trời, the sky manta: Quaternius' "Manta ray" (CC0, see README), rounded off at load,
 * painted in the shader (see PATTERN_PARS) and flown by MantaActivity. The file's one clip
 * (Swim, a full wing beat over 4.2 s) is crossfaded with the same clip frozen where the wings lie
 * flat (a glide): `flap` 0 glides, 1 beats fully. On top, in code: the tail trails the turns and
 * the climbs, the body heaves with each beat. Model space: facing +Z, `root` takes the flight's
 * pose (see setPose).
 */
export class MantaModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly beat: THREE.AnimationAction;
  private readonly glide: THREE.AnimationAction;
  private readonly tail: THREE.Object3D[];
  /** The tail bones' own rotations (Tail has no track in the clip: the bend must not pile up). */
  private readonly tailRest: THREE.Quaternion[];
  private readonly materials: THREE.Material[] = [];
  private readonly duration: number;
  /** Metres per file unit (the fit to WINGSPAN). */
  private readonly scale: number;
  /** The grips (file units; x for the right hand) and a wing tip in the glide pose (file units, right). */
  private readonly grip = new THREE.Vector3();
  private readonly tip = new THREE.Vector3();
  /** The front of the head (file units, z). */
  private front = 0;
  private flap = 0;
  private tailYaw = 0;
  private tailPitch = 0;
  private time = 0;

  static async load(url: string, shared: SharedUniforms): Promise<MantaModel> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new MantaModel(gltf.scene, gltf.animations, shared);
  }

  private constructor(scene: THREE.Group, clips: THREE.AnimationClip[], shared: SharedUniforms) {
    prepareSkinned(scene);
    smoothModel(scene, 2, 0.55);
    scene.updateMatrixWorld(true);
    this.paintCoordinates(scene);

    const clip = findClip(clips, 'Swim', 'manta');
    this.duration = clip.duration;
    this.mixer = new THREE.AnimationMixer(scene);
    this.beat = this.mixer.clipAction(clip);
    this.beat.play();
    // The same clip, held still where the wings are flat.
    this.glide = this.mixer.clipAction(clip.clone());
    this.glide.play();
    this.glide.paused = true;
    this.glide.time = GLIDE_TIME;
    this.beat.setEffectiveWeight(0);
    this.glide.setEffectiveWeight(1);
    this.mixer.update(0);

    // Wingspan with the wings flat.
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    this.scale = WINGSPAN / (box.max.x - box.min.x);
    this.body.scale.setScalar(this.scale);
    this.findTip(scene);
    this.grip.set(GRIP.x / this.scale, BACK.y + GRIP.up / this.scale, BACK.z + GRIP.ahead / this.scale);
    this.body.add(scene);
    this.body.add(this.harness(shared));
    this.root.add(this.body);
    // Yaw, then pitch about its own side axis, then roll about its length.
    this.root.rotation.order = 'YXZ';

    const bone = (n: string): THREE.Object3D => {
      const o = scene.getObjectByName(n);
      if (!o) throw new Error(`manta: no bone ${n}`);
      return o;
    };
    this.tail = [bone('Spine4'), bone('Tail')];
    this.tailRest = this.tail.map((b) => b.quaternion.clone());

    const swapped = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The bones carry the wings far outside the rest-pose bounds.
      mesh.frustumCulled = false;
      const swap = (m: THREE.Material): THREE.Material => {
        let out = swapped.get(m);
        if (!out) {
          const back = m.name === 'Top';
          out = new THREE.MeshStandardMaterial({ roughness: back ? 0.42 : 0.6, metalness: 0 });
          patchManta(out, back, shared);
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
   * `aManta` per vertex: across (x, from the middle) and along (from the front of the head
   * backward), in the file's metres, measured in the rest pose (so the pattern rides the skin).
   */
  /** The right wing's tip in the glide pose (the skinned vertex furthest out), file units. */
  private findTip(scene: THREE.Object3D): void {
    let best = -Infinity;
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const n = mesh.geometry.getAttribute('position').count;
      for (let i = 0; i < n; i++) {
        mesh.getVertexPosition(i, tmpV).applyMatrix4(mesh.matrixWorld);
        if (tmpV.x > best) {
          best = tmpV.x;
          this.tip.copy(tmpV);
        }
      }
    });
  }

  private paintCoordinates(scene: THREE.Object3D): void {
    const meshes: THREE.Mesh[] = [];
    let front = -Infinity;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes.push(mesh);
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) front = Math.max(front, tmpV.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).z);
    });
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position');
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        tmpV.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        uv[i * 2] = tmpV.x;
        uv[i * 2 + 1] = front - tmpV.z;
      }
      mesh.geometry.setAttribute('aManta', new THREE.BufferAttribute(uv, 2));
    }
    this.front = front;
  }

  /** Where it is and how it's tilted: yaw (forward (−sin, −cos)), pitch nose-up +, roll right wing down +. */
  setPose(x: number, y: number, z: number, yaw: number, pitch: number, roll: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(-pitch, yaw + Math.PI, roll);
  }

  /**
   * Every frame: `flap` 0 (glide) … 1 (full beats) at `rate` × the clip's speed; `turn` (rad/s,
   * + left) and `vy` (m/s) make the tail trail behind.
   */
  update(dt: number, flap: number, rate: number, turn: number, vy: number): void {
    this.time += dt;
    this.flap += (flap - this.flap) * (1 - Math.exp(-dt * 2.5));
    this.beat.setEffectiveWeight(this.flap);
    this.glide.setEffectiveWeight(1 - this.flap);
    this.beat.timeScale = rate;
    for (let i = 0; i < this.tail.length; i++) this.tail[i].quaternion.copy(this.tailRest[i]);
    this.mixer.update(dt);
    // The body lifts on each downstroke (a little, with the beat's strength).
    const phase = (this.beat.time / this.duration) * Math.PI * 2;
    this.body.position.y = 0.12 * this.flap * Math.sin(phase + 0.6);
    this.root.updateMatrixWorld(true);
    // The tail trails: swung out of the turn, lifted on a dive, with a slow idle sway.
    this.tailYaw += (-turn * 0.35 + 0.08 * Math.sin(this.time * 0.9) - this.tailYaw) * (1 - Math.exp(-dt * 3));
    this.tailPitch += (THREE.MathUtils.clamp(vy * 0.03, -0.3, 0.3) - this.tailPitch) * (1 - Math.exp(-dt * 3));
    for (const b of this.tail) {
      this.bend(b, UP, this.tailYaw * 0.5);
      this.bend(b, SIDE, this.tailPitch * 0.5);
    }
    this.root.updateMatrixWorld(true);
  }

  /** Turns `bone` by `angle` about `axis` given in the model's own frame (root space). */
  private bend(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
    const parent = bone.parent;
    if (!parent || angle === 0) return;
    // The axis in the parent's frame: model → world → parent.
    tmpV.copy(axis).applyQuaternion(this.root.getWorldQuaternion(tmpQ));
    tmpV.applyQuaternion(parent.getWorldQuaternion(tmpQ2).invert());
    bone.quaternion.premultiply(tmpQ.setFromAxisAngle(tmpV.normalize(), angle));
    bone.updateMatrixWorld(true);
  }

  /** Teal leather straps: round the head, and the handle the rider holds. */
  private harness(shared: SharedUniforms): THREE.Group {
    const mat = new THREE.MeshStandardMaterial({ color: '#2f8a8c', roughness: 0.5, metalness: 0.05 });
    patchWorldMaterial(mat, { wet: true, porosity: 0.3 }, shared);
    this.materials.push(mat);
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      // Leaning back at the top, like a strap pulled toward the rider.
      ring.push(new THREE.Vector3(STRAP.halfW * Math.sin(a), STRAP.y + STRAP.halfH * Math.cos(a), STRAP.z - STRAP.tilt * Math.cos(a)));
    }
    const strap = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 64, STRAP.r, 8, true), mat);
    // From the strap's sides, up and back to the grips, across between them.
    const g0 = this.grip;
    const side = STRAP.halfW * 0.55;
    const from = new THREE.Vector3(side, STRAP.y + STRAP.halfH * 0.9, STRAP.z - 0.1);
    const mid = new THREE.Vector3((side + g0.x) / 2 + 0.03, (from.y + g0.y) / 2 + 0.06, (from.z + g0.z) / 2);
    const handlePts = [from, mid, g0].map((p) => p.clone().setX(-p.x));
    handlePts.push(...[g0, mid, from].map((p) => p.clone()));
    const handle = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(handlePts), 32, STRAP.r * 0.85, 8, false), mat);
    const g = new THREE.Group();
    for (const m of [strap, handle]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  /** Where the rider's left (0) or right (1) hand holds the handle (world). */
  gripPoint(i: number, out: THREE.Vector3): THREE.Vector3 {
    // The file faces +Z, so its −x side is the manta's (and the rider's) right.
    return out.set((i === 0 ? 1 : -1) * this.grip.x, this.grip.y, this.grip.z).applyMatrix4(this.body.matrixWorld);
  }

  /** The left (0) or right (1) wing tip (world; the wings flat, not following each beat). */
  wingTip(i: number, out: THREE.Vector3): THREE.Vector3 {
    // The file faces +Z, so its −x side is the manta's right.
    return out.set((i === 0 ? 1 : -1) * this.tip.x, this.tip.y, this.tip.z).applyMatrix4(this.body.matrixWorld);
  }

  /** The tip of its head, `up` m above its middle (world). */
  nose(up: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0, BACK.y + up / this.scale, this.front).applyMatrix4(this.body.matrixWorld);
  }

  /** Where the rider lies (world, no scale): origin on its back under the chest, −Z toward the head. */
  backMatrix(out: THREE.Matrix4): THREE.Matrix4 {
    const p = tmpV.copy(BACK).applyMatrix4(this.body.matrixWorld);
    this.root.getWorldQuaternion(tmpQ).multiply(TURN_SEAT);
    return out.compose(p, tmpQ, tmpS.set(1, 1, 1));
  }

  dispose(): void {
    this.root.removeFromParent();
    this.mixer.stopAllAction();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
