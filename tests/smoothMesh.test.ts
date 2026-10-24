import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { smoothSubdivide } from '../src/world/smoothMesh';

describe('smoothSubdivide', () => {
  it('rounds a flat-shaded cube: welded, 4× the triangles, closer to a sphere', () => {
    const cube = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const g = smoothSubdivide(cube, 2);
    expect(g.getIndex()?.count).toBe(12 * 16 * 3);
    // Corners pulled in: every point between the inscribed and the corner sphere, the spread
    // of radii much smaller than the cube's (1 … 1.73).
    const p = g.getAttribute('position');
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getY(i), p.getZ(i));
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(hi / lo).toBeLessThan(1.35);
    expect(g.getAttribute('normal').count).toBe(p.count);
  });

  it('keeps skin weights normalised, from the two ends of an edge', () => {
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    tri.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0], 4));
    tri.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const g = smoothSubdivide(tri, 1);
    const w = g.getAttribute('skinWeight');
    const si = g.getAttribute('skinIndex');
    expect(w.count).toBe(6);
    for (let i = 0; i < w.count; i++) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
    // A new edge point between bone 0 and bone 1: half each.
    const mid = [...Array(w.count).keys()].find((i) => i >= 3 && new Set([si.getX(i), si.getY(i)]).has(0) && new Set([si.getX(i), si.getY(i)]).has(1));
    expect(mid).toBeDefined();
    expect(w.getX(mid as number)).toBeCloseTo(0.5, 5);
    // A lone triangle is all border: a corner moves by the border rule only (¾ itself, ⅛ each
    // border neighbour), so two meshes sharing a border move it alike.
    expect(g.getAttribute('position').getX(1)).toBeCloseTo(0.75, 5);
  });
});
