import * as THREE from 'three';

/**
 * Gets a skinned .glb scene ready to measure and animate. Quaternius' files store the mesh tiny
 * and scale it up by the armature, so the skinned bounds need the bone matrices, which are all
 * zero until the skeleton's first update (bounds of height 0). Also repairs NaN skin weights.
 */
export function prepareSkinned(scene: THREE.Object3D): void {
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    repairSkinWeights(mesh.geometry);
    mesh.skeleton.update();
  });
}

/** Wraps `scene` in a group scaled so its bounds are `height` tall; returns the group. */
export function fitToHeight(scene: THREE.Object3D, height: number, what: string): THREE.Group {
  const box = new THREE.Box3().setFromObject(scene);
  if (!(box.max.y > box.min.y)) throw new Error(`${what}: empty bounds`);
  const fit = new THREE.Group();
  fit.scale.setScalar(height / (box.max.y - box.min.y));
  fit.add(scene);
  return fit;
}

/** A clip by its short name (the files name them "Armature|Idle" and so on). */
export function findClip(clips: THREE.AnimationClip[], name: string, what: string): THREE.AnimationClip {
  const c = clips.find((a) => a.name === name || a.name.endsWith(`|${name}`));
  if (!c) throw new Error(`${what}: no clip ${name}`);
  return c;
}

/**
 * Crossfades a creature's looping clips: each frame the chosen one eases toward full weight and
 * the others toward none (weights normalized, so the pose never shrinks between two clips).
 */
export class ClipBlend<K extends string> {
  private readonly actions: Record<K, THREE.AnimationAction>;
  private readonly weights: Record<K, number>;
  private readonly keys: K[];

  constructor(
    readonly mixer: THREE.AnimationMixer,
    clips: THREE.AnimationClip[],
    names: Record<K, string>,
    first: K,
    what: string,
  ) {
    this.keys = Object.keys(names) as K[];
    const actions = {} as Record<K, THREE.AnimationAction>;
    const weights = {} as Record<K, number>;
    for (const k of this.keys) {
      const a = mixer.clipAction(findClip(clips, names[k], what));
      a.play();
      a.setEffectiveWeight(k === first ? 1 : 0);
      actions[k] = a;
      weights[k] = k === first ? 1 : 0;
    }
    this.actions = actions;
    this.weights = weights;
  }

  action(k: K): THREE.AnimationAction {
    return this.actions[k];
  }

  /** Eases toward `current` (rate 1/s), then advances the mixer. */
  update(dt: number, current: K, rate = 8): void {
    const k = 1 - Math.exp(-dt * rate);
    let sum = 0;
    for (const key of this.keys) {
      this.weights[key] += ((key === current ? 1 : 0) - this.weights[key]) * k;
      sum += this.weights[key];
    }
    for (const key of this.keys) this.actions[key].setEffectiveWeight(this.weights[key] / Math.max(1e-3, sum));
    this.mixer.update(dt);
  }
}

/**
 * Some exports leave a few vertices with NaN skin weights (the crab has 6 of ~2,500): on the GPU
 * they land at NaN and their triangles vanish, and the bounds come out NaN. Each borrows the
 * joints and weights of the nearest sound vertex (it moves with its neighbours).
 */
function repairSkinWeights(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position');
  const idx = geo.getAttribute('skinIndex');
  const w = geo.getAttribute('skinWeight');
  if (!pos || !idx || !w) return;
  const bad = (i: number): boolean => {
    for (let k = 0; k < 4; k++) if (!Number.isFinite(w.getComponent(i, k))) return true;
    return false;
  };
  for (let i = 0; i < pos.count; i++) {
    if (!bad(i)) continue;
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < pos.count; j++) {
      if (j === i || bad(j)) continue;
      const d = (pos.getX(i) - pos.getX(j)) ** 2 + (pos.getY(i) - pos.getY(j)) ** 2 + (pos.getZ(i) - pos.getZ(j)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    for (let k = 0; k < 4; k++) {
      idx.setComponent(i, k, best >= 0 ? idx.getComponent(best, k) : 0);
      w.setComponent(i, k, best >= 0 ? w.getComponent(best, k) : k === 0 ? 1 : 0);
    }
  }
  idx.needsUpdate = true;
  w.needsUpdate = true;
}
