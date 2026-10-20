import * as THREE from 'three';
import { BOARD } from '../activities/surfPhysics';

const C = {
  deck: [0.96, 0.95, 0.9],
  bottom: [0.93, 0.91, 0.86],
  rail: [0.1, 0.62, 0.66],
  stripe: [0.98, 0.45, 0.2],
  stringer: [0.55, 0.4, 0.25],
  fin: [0.12, 0.14, 0.16],
  pad: [0.15, 0.17, 0.2],
} as const;

/** Outline half width along the board (t = 0 nose … 1 tail): a rounded nose, widest ahead of the middle, a squash tail. */
const halfWidth = (t: number): number => {
  const nose = Math.sin(Math.min(1, t / 0.42) * Math.PI / 2) ** 0.75;
  const tail = 0.62 + 0.38 * Math.cos(Math.max(0, (t - 0.45) / 0.55) * Math.PI / 2) ** 0.9;
  return BOARD.halfWidth * nose * tail;
};
/** Rocker: the nose kicks up, the tail a little. */
const rocker = (t: number): number => 0.13 * Math.max(0, 1 - t / 0.35) ** 2.2 + 0.035 * Math.max(0, (t - 0.75) / 0.25) ** 2;
/** Thickness: full in the middle, thin at nose and tail. */
const thick = (t: number): number => 0.07 * Math.sin(Math.PI * Math.min(1, 0.04 + t * 0.94)) ** 0.5;

/**
 * A funboard, built in code: lofted from an outline, a rocker line and a thickness curve, with
 * domed deck, soft rails, a stringer, a stripe, a tail pad and three fins. Origin at the
 * waterline in the middle, nose toward −Z (the deck is BOARD.deckY above the origin there).
 */
export function createSurfboard(): THREE.Group {
  const N = 40;
  const R = 14;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const L = BOARD.length;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -L / 2 + t * L;
    const w = Math.max(halfWidth(t), 0.004);
    const h = thick(t);
    // Origin at the waterline: the middle of the deck sits deckY above it.
    const mid = rocker(t) + BOARD.deckY - h * 0.85;
    for (let k = 0; k < R; k++) {
      // Round the cross-section: k = 0 … R/2 the deck (dome), the rest the bottom (flatter).
      const a = (k / R) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = w * Math.sign(c) * Math.abs(c) ** 0.6;
      const y = s > 0 ? mid + h * 0.85 * s ** 0.5 : mid + h * 0.15 * s;
      pos.push(x, y, z);
      const rail = Math.abs(c) > 0.85;
      let rgb: readonly number[] = s > 0 ? C.deck : C.bottom;
      if (rail) rgb = C.rail;
      else if (s > 0 && Math.abs(x) < 0.008) rgb = C.stringer;
      else if (s > 0 && t > 0.18 && t < 0.24) rgb = C.stripe;
      else if (s > 0 && t > 0.83) rgb = C.pad;
      col.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < R; k++) {
      const a = i * R + k;
      const b = i * R + ((k + 1) % R);
      const c = a + R;
      const d = b + R;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const plastic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 });
  const board = new THREE.Mesh(g, plastic);
  board.castShadow = true;
  board.receiveShadow = true;

  // Three fins under the tail (thruster).
  const finMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(...C.fin), roughness: 0.4 });
  const group = new THREE.Group();
  group.name = 'surfboard';
  group.add(board);
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.lineTo(0.11, 0);
  finShape.quadraticCurveTo(0.05, -0.04, 0.1, -0.11);
  finShape.quadraticCurveTo(0.02, -0.07, 0, 0);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.008, bevelEnabled: false });
  finGeo.translate(0, 0, -0.004);
  finGeo.rotateY(Math.PI / 2);
  for (const [x, t, toe] of [[0, 0.94, 0], [-0.17, 0.86, 0.06], [0.17, 0.86, -0.06]] as const) {
    const fin = new THREE.Mesh(finGeo, finMat);
    const z = -L / 2 + t * L;
    fin.position.set(x * (halfWidth(t) / BOARD.halfWidth), rocker(t) + BOARD.deckY - thick(t) * 0.85 - thick(t) * 0.15, z - 0.05);
    fin.rotation.y = toe;
    fin.castShadow = true;
    group.add(fin);
  }
  return group;
}
