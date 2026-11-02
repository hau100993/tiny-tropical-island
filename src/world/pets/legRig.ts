import * as THREE from 'three';
import type { BodyAction } from './bodies';

/**
 * Legs for a model that has none of its own (a static mesh, no skeleton): Kim Quy's turtle.
 * At load, every triangle near a foot and below the hip goes to that leg, those in front of the
 * neck to the head; each part becomes its own mesh (sharing the model's vertex buffers, only its
 * own index list) hung on a pivot at the hip or the neck, so it can swing. The joints sit under
 * the shell, where a small gap never shows.
 *
 * Walking is a turtle's: diagonal pairs (front left with back right, then the other two) swing
 * forward and back in turn, a foot lifting a little as it comes forward; the head nods with the
 * steps. Standing, the head looks slowly about; greeting, it nods.
 */
export interface LegRigSpec {
  /** Foot centres (model units, x and z), front left, front right, back left, back right. */
  feet: readonly (readonly [number, number])[];
  /** A triangle within this distance (horizontal) of a foot and below `hipY` is that leg. */
  footRadius: number;
  hipY: number;
  /**
   * Triangles further forward than this (z) and above the hips are the head and neck; it turns
   * about `neck` (x, y, z), best at the shell's front edge so the joint hides under it.
   */
  headZ: number;
  neck: readonly [number, number, number];
}

/** Kim Quy ("Turtle", Poly by Google): head toward +z, feet from its claw meshes. */
export const LEG_RIGS: Readonly<Record<string, LegRigSpec>> = {
  kimquy: {
    feet: [
      [-4.3, 6.75],
      [4.3, 6.75],
      [-5.55, -6.8],
      [5.55, -6.8],
    ],
    footRadius: 2.9,
    hipY: 1.0,
    headZ: 5.6,
    neck: [0, 3.4, 5.4],
  },
};

/** Swing of a leg (rad) at full walking pace, and steps per second then. */
const SWING = 0.5;
const STEP_RATE = 1.4;

export interface LegRig {
  /** Animates; returns how far (model units) to lower the body so the swung feet stay on the ground. */
  update(dt: number, action: BodyAction, moving: number): number;
}

/** Splits the meshes under `root` (model space = mesh space: one node, no transforms). */
export function buildLegRig(root: THREE.Object3D, spec: LegRigSpec): LegRig | null {
  const legs = spec.feet.map(() => new THREE.Group());
  const head = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(m);
  });
  if (meshes.length === 0) return null;
  // Pivots: at the hip above each foot (a little inward), and at the neck.
  spec.feet.forEach(([fx, fz], i) => legs[i].position.set(fx * 0.85, spec.hipY, fz * 0.9));
  head.position.set(spec.neck[0], spec.neck[1], spec.neck[2]);
  let moved = 0;
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const index = geo.index;
    const count = index ? index.count : pos.count;
    const corner = (k: number): number => (index ? index.getX(k) : k);
    const parts: number[][] = spec.feet.map(() => []);
    const headTris: number[] = [];
    const body: number[] = [];
    for (let k = 0; k < count; k += 3) {
      const a = corner(k);
      const b = corner(k + 1);
      const c = corner(k + 2);
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      let to: number[] = body;
      if (cz > spec.headZ && cy > spec.hipY + 0.5) to = headTris;
      else if (cy < spec.hipY) {
        for (let i = 0; i < spec.feet.length; i++) {
          if (Math.hypot(cx - spec.feet[i][0], cz - spec.feet[i][1]) < spec.footRadius) {
            to = parts[i];
            break;
          }
        }
      }
      to.push(a, b, c);
    }
    if (body.length === count) continue;
    moved += count - body.length;
    const piece = (tris: number[], pivot: THREE.Group): void => {
      if (tris.length === 0) return;
      // Same vertex buffers, own triangles; shifted so the pivot is its origin.
      const g = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr);
      g.setIndex(tris);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mesh.material);
      m.castShadow = mesh.castShadow;
      m.receiveShadow = mesh.receiveShadow;
      m.frustumCulled = false;
      m.position.set(-pivot.position.x, -pivot.position.y, -pivot.position.z);
      pivot.add(m);
    };
    parts.forEach((tris, i) => piece(tris, legs[i]));
    piece(headTris, head);
    geo.setIndex(body);
  }
  if (moved === 0) return null;
  const parent = meshes[0].parent ?? root;
  parent.add(...legs, head);

  let phase = 0;
  let t = Math.random() * 10;
  let swing = 0;
  // Hip to sole: a leg swung by angle a raises its foot by length · (1 − cos a).
  let soleY = Infinity;
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    soleY = Math.min(soleY, m.geometry.boundingBox?.min.y ?? soleY);
  }
  const legLength = Math.max(0, spec.hipY - soleY);
  return {
    update(dt, action, moving) {
      t += dt;
      // The swing eases in and out with the pace; the steps quicken with it.
      const walking = action === 'move' ? Math.min(1, 0.4 + moving) : 0;
      swing += (walking - swing) * Math.min(1, dt * 6);
      phase += dt * Math.PI * 2 * STEP_RATE * (0.5 + 0.5 * walking);
      const s = Math.sin(phase);
      legs.forEach((leg, i) => {
        // Diagonal pairs in turn: front left + back right, front right + back left.
        const pair = i === 0 || i === 3 ? 1 : -1;
        const a = s * pair;
        leg.rotation.x = -a * SWING * swing;
        // Coming forward, the foot lifts outward a little.
        const out = i % 2 === 0 ? 1 : -1;
        leg.rotation.z = Math.max(0, a) * 0.18 * swing * out;
      });
      if (action === 'greet' || action === 'dance') {
        head.rotation.x = Math.sin(t * 9) * 0.25;
        head.rotation.y = 0;
      } else if (action === 'skill') {
        head.rotation.x = -0.3;
        head.rotation.y = 0;
      } else {
        head.rotation.x = Math.sin(phase * 2) * 0.06 * swing;
        // Standing, it looks slowly about.
        head.rotation.y = Math.sin(t * 0.45) * 0.35 * (1 - swing);
      }
      return legLength * (1 - Math.cos(Math.abs(s) * SWING * swing));
    },
  };
}
