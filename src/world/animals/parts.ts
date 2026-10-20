import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Builds a small animal from vertex-coloured parts merged into one geometry. Each vertex also
 * carries `aPart` (vec2), which the animal's vertex shader reads to know what moves: e.g. a
 * wing's weight, a flipper's side. One geometry per species → one draw call for all of them.
 */
export class PartBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** Adds `g` (ownership taken) in one colour; `part` = what the shader animates (0 = still). */
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, part: [number, number] = [0, 0]): void {
    const c = new THREE.Color(color);
    this.addFn(g, () => c, () => part);
  }

  /** Per-vertex colour and part from the vertex position. */
  addFn(
    g: THREE.BufferGeometry,
    color: (p: THREE.Vector3) => THREE.Color,
    part: (p: THREE.Vector3) => [number, number],
  ): void {
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const pos = geo.getAttribute('position');
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const prt = new Float32Array(n * 2);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      const c = color(p);
      col.set([c.r, c.g, c.b], i * 3);
      prt.set(part(p), i * 2);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPart', new THREE.BufferAttribute(prt, 2));
    this.parts.push(geo);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    if (!g) throw new Error('PartBuilder: merge failed');
    g.computeBoundingSphere();
    return g;
  }
}

/** A flat triangle fan (both faces) from points in order; for fins, wings, flukes. */
export function flat(points: Array<[number, number, number]>): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    for (const k of [0, i, i + 1]) pos.push(...points[k]);
    for (const k of [0, i + 1, i]) pos.push(...points[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Vertex-coloured standard material whose vertices are moved by `motion` (GLSL run on
 * `transformed`, before instancing and skinning; `aPart`, `iAnim` and `uTime` are available).
 * `iAnim` is a per-instance vec2 (phase, amount) set with `animAttribute`.
 */
export function animatedMaterial(
  motion: string,
  time: { value: number },
  opts: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, ...opts });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aPart;
attribute vec2 iAnim;
uniform float uTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
${motion}
}`,
      );
  };
  // Distinct program per motion (three caches programs by onBeforeCompile's source otherwise).
  m.customProgramCacheKey = () => motion;
  return m;
}

/** Adds the per-instance `iAnim` attribute (phase, amount) to an instanced mesh's geometry. */
export function animAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 2), 2).setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('iAnim', a);
  return a;
}
