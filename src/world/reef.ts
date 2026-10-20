import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Heightmap } from './heightmap';
import { patchWorldMaterial, type CausticsUniforms } from './patchMaterial';
import type { SharedUniforms } from '../core/uniforms';
import { createRng, randRange, type Rng } from '../core/rng';

/**
 * The reef around the island, for diving: corals (brain, staghorn, table, sea fan, tube
 * sponges), starfish and urchins on the sand, swaying seaweed, and schools of fish. All
 * instanced: one draw call per kind. Corals get the caustic light like the seabed; seaweed
 * sways in its vertex shader; fish swim in theirs (circling their school's center, tails
 * beating), so the CPU does nothing per frame.
 *
 * Placement: clusters between 1.5 and 9 m deep, most of them off the beach by the house.
 */
export interface Reef {
  group: THREE.Group;
  /** How many of each kind were placed (for tests and the stats). */
  counts: Record<string, number>;
}

const PALETTES = {
  brain: ['#c9a24a', '#9bb35c', '#d98c6a', '#b07cc6'],
  staghorn: ['#e88aa4', '#a173d8', '#f2b04c', '#6cc7c0'],
  table: ['#86b892', '#c9a37c', '#d8c682'],
  fan: ['#b04fd8', '#e4566c', '#f08a3c'],
  tube: ['#eaa83a', '#c84592', '#5aa0d8'],
  star: ['#f07a2a', '#d63a3a', '#3a6fd6'],
  urchin: ['#2a1f3a', '#3b2030'],
} as const;
type CoralKind = keyof typeof PALETTES;

const v3 = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/** Brain coral: a low dome with meandering grooves. ~1 m across. */
function brainGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    v3.fromBufferAttribute(p, i);
    const a = Math.atan2(v3.z, v3.x);
    const groove = 1 + 0.05 * Math.sin(a * 11 + v3.y * 22) * Math.sin(a * 5 - v3.y * 9);
    v3.multiplyScalar(groove);
    v3.y *= 0.7;
    p.setXYZ(i, v3.x, v3.y, v3.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Staghorn: branches forking upward and outward (recursive), ~0.9 m tall. */
function staghornGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const branch = (from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number): void => {
    const g = new THREE.CylinderGeometry(rad * 0.65, rad, len, 5, 1, depth === 0);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(from.x, from.y, from.z);
    parts.push(g);
    if (depth >= 3) return;
    const end = from.clone().addScaledVector(dir, len);
    const n = depth === 0 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng() * 1.2;
      const tilt = 0.35 + rng() * 0.4;
      const d = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)).lerp(dir, 0.35).normalize();
      branch(end, d, len * (0.7 + rng() * 0.2), rad * 0.68, depth + 1);
    }
  };
  branch(new THREE.Vector3(0, -0.05, 0), up.clone(), 0.28, 0.07, 0);
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  parts.forEach((p) => p.dispose());
  if (!g) throw new Error('reef: staghorn merge failed');
  g.computeVertexNormals();
  return g;
}

/** Table coral: a wide, thin plate on a short stalk. */
function tableGeometry(): THREE.BufferGeometry {
  const plate = new THREE.CylinderGeometry(0.6, 0.5, 0.06, 18).translate(0, 0.42, 0);
  const stalk = new THREE.CylinderGeometry(0.06, 0.1, 0.42, 7).translate(0, 0.21, 0);
  const g = mergeGeometries([plate.toNonIndexed(), stalk.toNonIndexed()], false);
  if (!g) throw new Error('reef: table merge failed');
  g.computeVertexNormals();
  return g;
}

/** Sea fan: a wavy, flat half disc standing on edge (seen from both sides). */
function fanGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(0.5, 16, 0, Math.PI);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setZ(i, 0.05 * Math.sin(x * 9) * y);
  }
  g.computeVertexNormals();
  return g;
}

/** Tube sponges: a few open tubes of different heights. */
function tubeGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const h = randRange(rng, 0.3, 0.75);
    const r = randRange(rng, 0.05, 0.09);
    const g = new THREE.CylinderGeometry(r, r * 0.8, h, 9, 1, true).translate(randRange(rng, -0.15, 0.15), h / 2, randRange(rng, -0.15, 0.15));
    parts.push(g.toNonIndexed());
  }
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('reef: tube merge failed');
  g.computeVertexNormals();
  return g;
}

/** Starfish: a flat five-armed star. ~0.25 m. */
function starGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.13 : 0.045;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.012, 0);
  return g;
}

/** Sea urchin: a dark ball with spines. */
function urchinGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.IcosahedronGeometry(0.06, 1)];
  for (let k = 0; k < 18; k++) {
    const d = new THREE.Vector3(rng() - 0.5, rng() * 0.8, rng() - 0.5).normalize();
    const c = new THREE.ConeGeometry(0.006, 0.16, 3).translate(0, 0.08, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, d));
    parts.push(c.toNonIndexed());
  }
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('reef: urchin merge failed');
  g.computeVertexNormals();
  g.translate(0, 0.04, 0);
  return g;
}

const SEAWEED_VERT = /* glsl */ `
  vec3 ip = vec3(instanceMatrix[3]);
  float ph = ip.x * 0.9 + ip.z * 0.7;
  float bend = transformed.y * transformed.y;
  transformed.x += sin(uTime * 1.1 + ph + transformed.y * 1.8) * 0.16 * bend;
  transformed.z += cos(uTime * 0.8 + ph * 1.3 + transformed.y * 1.4) * 0.1 * bend;
`;

const FISH_VERT = /* glsl */ `
attribute vec3 iCenter;  // school center
attribute vec4 iSwim;    // radius, angular speed (rad/s, signed), phase, length (m)
attribute vec3 iOffset;  // place in the school (right, up, along)
attribute vec3 iColor;
attribute vec3 iColor2;
uniform float uTime;
varying vec3 vColor;
varying vec3 vColor2;
varying vec3 vNormalW;
varying vec3 vLocal;
#include <fog_pars_vertex>
void main() {
  float a = iSwim.z + uTime * iSwim.y;
  float r = iSwim.x;
  // Heading along the circle (tangent), the direction of travel.
  vec3 dir = normalize(vec3(-sin(a), 0.0, cos(a)) * sign(iSwim.y));
  vec3 right = vec3(-dir.z, 0.0, dir.x);
  // Each fish weaves a little around its place in the school.
  float wob = iSwim.z * 13.0 + iOffset.x * 3.1;
  vec3 c = iCenter + vec3(cos(a) * r, 0.35 * sin(uTime * 0.27 + iSwim.z), sin(a) * r);
  c += right * (iOffset.x + 0.15 * sin(uTime * 0.9 + wob)) + vec3(0.0, iOffset.y + 0.1 * sin(uTime * 1.3 + wob), 0.0) + dir * iOffset.z;
  // The body bends: the tail half swings side to side (faster for small fish).
  vec3 p = position;
  float beat = sin(uTime * (14.0 - 20.0 * iSwim.w) + wob - p.z * 6.0);
  p.x += beat * 0.12 * smoothstep(-0.1, 0.6, p.z);
  p *= iSwim.w;
  vLocal = position;
  // Local −Z is the nose: world = right·x + up·y − dir·z.
  vec3 w = c + right * p.x + vec3(0.0, p.y, 0.0) - dir * p.z;
  vNormalW = normalize(right * normal.x + vec3(0.0, normal.y, 0.0) - dir * normal.z);
  vColor = iColor;
  vColor2 = iColor2;
  vec4 mvPosition = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FISH_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uDayLight;
varying vec3 vColor;
varying vec3 vColor2;
varying vec3 vNormalW;
varying vec3 vLocal;
#include <fog_pars_fragment>
void main() {
  vec3 n = normalize(vNormalW);
  // Stripes across the body, a paler belly.
  float stripe = step(0.62, fract(vLocal.z * 3.2 + 0.3));
  vec3 base = mix(vColor, vColor2, stripe);
  base = mix(base, vec3(0.9), smoothstep(0.0, -0.3, vLocal.y) * 0.35);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  vec3 light = vec3(0.35, 0.5, 0.55) + uSunColor * diff * 0.9;
  // A silvery sheen on top.
  light += vec3(0.25) * pow(max(n.y, 0.0), 4.0);
  vec3 col = base * light * (0.06 + 0.94 * uDayLight);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Fish body: a slim ellipsoid (nose at −Z) with a forked tail fin, 1 m long before scaling. */
function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 10, 7);
  body.scale(0.2, 0.42, 1);
  const tail = new THREE.BufferGeometry();
  const t = [0, 0, 0.42, 0, 0.26, 0.72, 0, 0.0, 0.58, 0, 0, 0.42, 0, 0.0, 0.58, 0, -0.26, 0.72];
  tail.setAttribute('position', new THREE.Float32BufferAttribute(t, 3));
  tail.computeVertexNormals();
  const dorsal = new THREE.BufferGeometry();
  dorsal.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.18, -0.15, 0, 0.36, 0.1, 0, 0.18, 0.25], 3));
  dorsal.computeVertexNormals();
  const b = body.toNonIndexed();
  b.deleteAttribute('uv');
  const g = mergeGeometries([b, tail, dorsal], false);
  if (!g) throw new Error('reef: fish merge failed');
  return g;
}

interface Spot {
  x: number;
  z: number;
  y: number;
}

/** A point on the seabed `depth` m deep at `angle` from the island center (the outermost one). */
function seabedAt(hm: Heightmap, angle: number, depth: number): Spot {
  const r = hm.shoreDistance(angle, -depth);
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;
  return { x, z, y: hm.heightAt(x, z) };
}

export function createReef(hm: Heightmap, seed: number, shared: SharedUniforms, caustics: CausticsUniforms, houseAngle: number): Reef {
  const rng = createRng(seed);
  const group = new THREE.Group();
  group.name = 'reef';
  const counts: Record<string, number> = {};

  // Cluster centers: most off the house beach (the diving spot), some all round the island.
  const clusters: Spot[] = [];
  for (let i = 0; i < 46; i++) {
    const near = i < 28;
    const a = near ? houseAngle + randRange(rng, -0.75, 0.75) : rng() * Math.PI * 2;
    clusters.push(seabedAt(hm, a, randRange(rng, 2.2, 8)));
  }
  const kinds: Array<[CoralKind, number, THREE.BufferGeometry, number, number]> = [
    // kind, per cluster, geometry, min scale, max scale
    ['brain', 3, brainGeometry(), 0.4, 1.3],
    ['staghorn', 3, staghornGeometry(createRng(seed + 1)), 0.6, 1.4],
    ['table', 1, tableGeometry(), 0.6, 1.5],
    ['fan', 2, fanGeometry(), 0.6, 1.3],
    ['tube', 2, tubeGeometry(createRng(seed + 2)), 0.7, 1.3],
    ['star', 2, starGeometry(), 0.7, 1.4],
    ['urchin', 2, urchinGeometry(createRng(seed + 3)), 0.8, 1.4],
  ];
  const coral = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  patchWorldMaterial(coral, { caustics }, shared);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();
  for (const [kind, per, geo, s0, s1] of kinds) {
    const list: Spot[] = [];
    for (const c of clusters) {
      const n = Math.round(per * randRange(rng, 0.5, 1.8));
      for (let k = 0; k < n; k++) {
        const x = c.x + randRange(rng, -4, 4);
        const z = c.z + randRange(rng, -4, 4);
        const y = hm.heightAt(x, z);
        if (y > -1.4 || y < -11) continue;
        list.push({ x, z, y });
      }
    }
    const mesh = new THREE.InstancedMesh(geo, coral, list.length);
    list.forEach((p, i) => {
      const k = randRange(rng, s0, s1);
      // Corals grow upright; starfish and urchins lie flat; fans stand across the current.
      e.set(kind === 'fan' ? randRange(rng, -0.15, 0.15) : 0, rng() * Math.PI * 2, kind === 'brain' || kind === 'table' ? randRange(rng, -0.1, 0.1) : 0);
      q.setFromEuler(e);
      s.set(k, k * (kind === 'brain' ? randRange(rng, 0.7, 1.2) : 1), k);
      pos.set(p.x, p.y - 0.03 * k, p.z);
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);
      const pal = PALETTES[kind];
      color.set(pal[Math.floor(rng() * pal.length)]).multiplyScalar(randRange(rng, 0.85, 1.1));
      mesh.setColorAt(i, color);
    });
    mesh.name = `reef-${kind}`;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    group.add(mesh);
    counts[kind] = list.length;
  }

  // Seaweed: ribbons in clumps, swaying in the swell.
  {
    const blade = new THREE.PlaneGeometry(0.06, 1, 1, 8).translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = shared.uTime;
      shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>\n${SEAWEED_VERT}`);
    };
    const list: Array<Spot & { h: number }> = [];
    for (let i = 0; i < 70; i++) {
      const c = i < 40 ? clusters[i % clusters.length] : seabedAt(hm, rng() * Math.PI * 2, randRange(rng, 1.5, 6));
      const cx = c.x + randRange(rng, -5, 5);
      const cz = c.z + randRange(rng, -5, 5);
      for (let k = 0; k < 9; k++) {
        const x = cx + randRange(rng, -0.6, 0.6);
        const z = cz + randRange(rng, -0.6, 0.6);
        const y = hm.heightAt(x, z);
        if (y > -1.2 || y < -10) continue;
        list.push({ x, z, y, h: Math.min(-y - 0.4, randRange(rng, 0.5, 1.6)) });
      }
    }
    const mesh = new THREE.InstancedMesh(blade, mat, list.length);
    const greens = ['#5f9d4a', '#8aa83c', '#4f8b5f', '#9a8a3a'];
    list.forEach((p, i) => {
      q.setFromEuler(e.set(randRange(rng, -0.1, 0.1), rng() * Math.PI, randRange(rng, -0.1, 0.1)));
      m.compose(pos.set(p.x, p.y - 0.05, p.z), q, s.set(randRange(rng, 0.8, 1.6), p.h, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color.set(greens[Math.floor(rng() * greens.length)]));
    });
    // Instances sway outside their bounds; the patch is small, just never cull it.
    mesh.frustumCulled = false;
    mesh.name = 'reef-seaweed';
    group.add(mesh);
    counts.seaweed = list.length;
  }

  // Fish: schools circling over the reef, a few small groups close to the corals.
  {
    const centers: Array<{ c: Spot; r: number; n: number; size: number; colors: [string, string]; spread: number }> = [];
    const schoolColors: Array<[string, string]> = [
      ['#f2d23a', '#f2d23a'], // yellow tang
      ['#3a7fe0', '#f2d23a'], // blue and yellow
      ['#c8d4dc', '#7f8e99'], // silver
      ['#f07a2a', '#ffffff'], // clownfish
      ['#2fb5c8', '#1d5b8c'], // blue-green
      ['#e04a6a', '#f2b0c0'], // pink
    ];
    for (let i = 0; i < 14; i++) {
      const big = i < 6;
      const a = i < 10 ? houseAngle + randRange(rng, -0.8, 0.8) : rng() * Math.PI * 2;
      const bed = seabedAt(hm, a, big ? randRange(rng, 4, 9) : randRange(rng, 2.5, 6));
      // A circle that stays in water deep enough for the whole school.
      let r = big ? randRange(rng, 4, 8) : randRange(rng, 1.2, 2.5);
      const spread = big ? 1.6 : 0.6;
      // Highest seabed under the circle (and the school's width around it).
      let top = bed.y;
      for (let tries = 0; tries < 6; tries++) {
        top = bed.y;
        for (let k = 0; k < 16; k++) {
          const t = (k / 16) * Math.PI * 2;
          for (const rr of [r - spread, r, r + spread]) top = Math.max(top, hm.heightAt(bed.x + Math.cos(t) * rr, bed.z + Math.sin(t) * rr));
        }
        if (top < -2) break;
        r *= 0.7;
      }
      // Above the reef all the way round, still under the surface.
      const y = Math.min(-0.9, top + spread * 0.4 + (big ? randRange(rng, 1, 2) : randRange(rng, 0.5, 0.9)));
      centers.push({
        c: { x: bed.x, z: bed.z, y },
        r,
        n: big ? 18 + Math.floor(rng() * 14) : 4 + Math.floor(rng() * 4),
        size: big ? randRange(rng, 0.26, 0.4) : randRange(rng, 0.2, 0.32),
        colors: schoolColors[Math.floor(rng() * schoolColors.length)],
        spread,
      });
    }
    const total = centers.reduce((n, c) => n + c.n, 0);
    const geo = new THREE.InstancedBufferGeometry();
    const base = fishGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    const iCenter = new Float32Array(total * 3);
    const iSwim = new Float32Array(total * 4);
    const iOffset = new Float32Array(total * 3);
    const iColor = new Float32Array(total * 3);
    const iColor2 = new Float32Array(total * 3);
    let f = 0;
    for (const sc of centers) {
      const speed = (rng() < 0.5 ? -1 : 1) * randRange(rng, 0.35, 0.7) / sc.r;
      const phase = rng() * Math.PI * 2;
      const c1 = new THREE.Color(sc.colors[0]);
      const c2 = new THREE.Color(sc.colors[1]);
      for (let k = 0; k < sc.n; k++, f++) {
        iCenter.set([sc.c.x, sc.c.y, sc.c.z], f * 3);
        iSwim.set([sc.r, speed, phase, sc.size * randRange(rng, 0.85, 1.15)], f * 4);
        iOffset.set([randRange(rng, -1, 1) * sc.spread * 0.6, randRange(rng, -0.5, 0.5) * sc.spread * 0.5, randRange(rng, -1, 1) * sc.spread], f * 3);
        iColor.set([c1.r, c1.g, c1.b], f * 3);
        iColor2.set([c2.r, c2.g, c2.b], f * 3);
      }
    }
    geo.setAttribute('iCenter', new THREE.InstancedBufferAttribute(iCenter, 3));
    geo.setAttribute('iSwim', new THREE.InstancedBufferAttribute(iSwim, 4));
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(iOffset, 3));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));
    geo.setAttribute('iColor2', new THREE.InstancedBufferAttribute(iColor2, 3));
    geo.instanceCount = total;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: FISH_VERT,
      fragmentShader: FISH_FRAG,
      side: THREE.DoubleSide,
      fog: true,
    });
    mat.uniforms.uTime = shared.uTime;
    mat.uniforms.uSunDir = shared.uSunDir;
    mat.uniforms.uSunColor = shared.uSunColor;
    mat.uniforms.uDayLight = shared.uDayLight;
    const fish = new THREE.Mesh(geo, mat);
    fish.name = 'reef-fish';
    fish.frustumCulled = false;
    group.add(fish);
    counts.fish = total;
  }
  return { group, counts };
}
