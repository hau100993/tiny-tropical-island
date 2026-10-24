import * as THREE from 'three';

/**
 * Rounds off a flat-shaded low-poly mesh (a skinned one too) once, at load: welds the corners
 * that share a position, splits every triangle in four with Loop subdivision (new points on the
 * edges, old ones pulled toward their neighbours: the surface converges to a smooth curve) and
 * recomputes smooth normals. Skin weights of a new edge point are its two ends' averaged (the
 * four strongest bones kept), so the animation still bends it the same way.
 *
 * Open borders (where one material's mesh meets the next) use the boundary rules, which only
 * look along the border: both meshes move a shared border identically and stay sealed.
 *
 * Attributes other than position, normal, skinIndex and skinWeight (uv, colours) are dropped:
 * use it on plain-coloured models.
 */
export function smoothSubdivide(src: THREE.BufferGeometry, levels = 1): THREE.BufferGeometry {
  let g = weld(src);
  for (let i = 0; i < levels; i++) g = loop(g);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

interface Mesh {
  pos: Float32Array;
  /** Four bones and weights per vertex, or null (not skinned). */
  skinI: Float32Array | null;
  skinW: Float32Array | null;
  index: Uint32Array;
}

function toMesh(g: THREE.BufferGeometry): Mesh {
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const n = pos.count;
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    p[i * 3] = pos.getX(i);
    p[i * 3 + 1] = pos.getY(i);
    p[i * 3 + 2] = pos.getZ(i);
  }
  let skinI: Float32Array | null = null;
  let skinW: Float32Array | null = null;
  if (si && sw) {
    skinI = new Float32Array(n * 4);
    skinW = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      skinI[i * 4] = si.getX(i);
      skinI[i * 4 + 1] = si.getY(i);
      skinI[i * 4 + 2] = si.getZ(i);
      skinI[i * 4 + 3] = si.getW(i);
      skinW[i * 4] = sw.getX(i);
      skinW[i * 4 + 1] = sw.getY(i);
      skinW[i * 4 + 2] = sw.getZ(i);
      skinW[i * 4 + 3] = sw.getW(i);
    }
  }
  const idx = g.getIndex();
  const index = new Uint32Array(idx ? idx.count : n);
  for (let i = 0; i < index.length; i++) index[i] = idx ? idx.getX(i) : i;
  return { pos: p, skinI, skinW, index };
}

function toGeometry(m: Mesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  if (m.skinI && m.skinW) {
    // Bone indices are small integers: a 16-bit attribute, as GLTFLoader gives them.
    g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(m.skinI), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinW, 4));
  }
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  return g;
}

/** One vertex per distinct position (the first corner's skin data kept): an indexed mesh. */
function weld(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = toMesh(src);
  const n = m.pos.length / 3;
  const map = new Map<string, number>();
  const remap = new Uint32Array(n);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${m.pos[i * 3].toFixed(5)},${m.pos[i * 3 + 1].toFixed(5)},${m.pos[i * 3 + 2].toFixed(5)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = keep.length;
      map.set(key, j);
      keep.push(i);
    }
    remap[i] = j;
  }
  const pos = new Float32Array(keep.length * 3);
  const skinI = m.skinI ? new Float32Array(keep.length * 4) : null;
  const skinW = m.skinW ? new Float32Array(keep.length * 4) : null;
  keep.forEach((i, j) => {
    pos.set(m.pos.subarray(i * 3, i * 3 + 3), j * 3);
    if (skinI && m.skinI) skinI.set(m.skinI.subarray(i * 4, i * 4 + 4), j * 4);
    if (skinW && m.skinW) skinW.set(m.skinW.subarray(i * 4, i * 4 + 4), j * 4);
  });
  // Drop triangles that collapsed to a line (two corners welded together).
  const tris: number[] = [];
  for (let t = 0; t < m.index.length; t += 3) {
    const a = remap[m.index[t]];
    const b = remap[m.index[t + 1]];
    const c = remap[m.index[t + 2]];
    if (a !== b && b !== c && c !== a) tris.push(a, b, c);
  }
  return toGeometry({ pos, skinI, skinW, index: Uint32Array.from(tris) });
}

/** One step of Loop subdivision. */
function loop(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = toMesh(g);
  const nv = m.pos.length / 3;
  const tri = m.index;
  const key = (a: number, b: number): number => (a < b ? a * nv + b : b * nv + a);
  // Edges: their ends, the corners opposite them (one: a border; two: inside), the new point.
  const edges = new Map<number, { a: number; b: number; opp: number[]; mid: number }>();
  for (let t = 0; t < tri.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = tri[t + k];
      const b = tri[t + ((k + 1) % 3)];
      const c = tri[t + ((k + 2) % 3)];
      const id = key(a, b);
      const e = edges.get(id);
      if (e) e.opp.push(c);
      else edges.set(id, { a, b, opp: [c], mid: -1 });
    }
  }
  // Neighbours of each vertex, and its border neighbours (along border edges).
  const nbr: number[][] = Array.from({ length: nv }, () => []);
  const border: number[][] = Array.from({ length: nv }, () => []);
  for (const e of edges.values()) {
    nbr[e.a].push(e.b);
    nbr[e.b].push(e.a);
    if (e.opp.length === 1) {
      border[e.a].push(e.b);
      border[e.b].push(e.a);
    }
  }
  const total = nv + edges.size;
  const pos = new Float32Array(total * 3);
  const skinI = m.skinI ? new Float32Array(total * 4) : null;
  const skinW = m.skinW ? new Float32Array(total * 4) : null;
  const P = m.pos;
  // The old vertices, moved.
  for (let v = 0; v < nv; v++) {
    let wSelf = 1;
    let list: number[] = [];
    let wEach = 0;
    if (border[v].length === 2) {
      wSelf = 3 / 4;
      list = border[v];
      wEach = 1 / 8;
    } else if (border[v].length === 0 && nbr[v].length >= 3) {
      const n = nbr[v].length;
      const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
      wSelf = 1 - n * beta;
      list = nbr[v];
      wEach = beta;
    }
    // (A corner of the border or a non-manifold point stays put.)
    for (let c = 0; c < 3; c++) {
      let s = P[v * 3 + c] * wSelf;
      for (const u of list) s += P[u * 3 + c] * wEach;
      pos[v * 3 + c] = s;
    }
    if (skinI && skinW && m.skinI && m.skinW) {
      skinI.set(m.skinI.subarray(v * 4, v * 4 + 4), v * 4);
      skinW.set(m.skinW.subarray(v * 4, v * 4 + 4), v * 4);
    }
  }
  // The new edge points.
  let next = nv;
  const bones = new Map<number, number>();
  for (const e of edges.values()) {
    e.mid = next++;
    const inside = e.opp.length === 2;
    for (let c = 0; c < 3; c++) {
      pos[e.mid * 3 + c] = inside
        ? (3 / 8) * (P[e.a * 3 + c] + P[e.b * 3 + c]) + (1 / 8) * (P[e.opp[0] * 3 + c] + P[e.opp[1] * 3 + c])
        : 0.5 * (P[e.a * 3 + c] + P[e.b * 3 + c]);
    }
    if (skinI && skinW && m.skinI && m.skinW) {
      bones.clear();
      for (const v of [e.a, e.b]) {
        for (let k = 0; k < 4; k++) {
          const w = m.skinW[v * 4 + k] * 0.5;
          if (w <= 0) continue;
          const b = m.skinI[v * 4 + k];
          bones.set(b, (bones.get(b) ?? 0) + w);
        }
      }
      const top = [...bones.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
      for (let k = 0; k < 4; k++) {
        skinI[e.mid * 4 + k] = top[k] ? top[k][0] : 0;
        skinW[e.mid * 4 + k] = top[k] ? top[k][1] / sum : 0;
      }
    }
  }
  // Each triangle → four.
  const index = new Uint32Array(tri.length * 4);
  let o = 0;
  const mid = (a: number, b: number): number => (edges.get(key(a, b)) as { mid: number }).mid;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t];
    const b = tri[t + 1];
    const c = tri[t + 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    index.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], o);
    o += 12;
  }
  return toGeometry({ pos, skinI, skinW, index });
}
