import * as THREE from 'three';
import { PlantBuilder, bendWithHeight } from './plantBuilder';
import { randRange, type Rng } from '../../core/rng';
import { smoothstep } from '../../core/math';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const C = (hex: string): THREE.Color => new THREE.Color(hex);
/** Random brightness variation of a color. */
const shade = (c: THREE.Color, rng: Rng, amount = 0.12): THREE.Color => c.clone().multiplyScalar(1 + (rng() - 0.5) * 2 * amount);
const dirAt = (angle: number, y = 0): THREE.Vector3 => V(Math.cos(angle), y, Math.sin(angle)).normalize();

/** What a candidate site looks like, for the species' habitat rules. */
export interface Site {
  x: number;
  z: number;
  height: number;
  /** 0 at the coastline … 1 at the island center. */
  inland: number;
  onSand: boolean;
  /** Distance to the house (m). */
  house: number;
  /** Low-frequency noise in [0, 1] for patchy groves. */
  patch: number;
}

export interface Species {
  id: string;
  variants: number;
  build(rng: Rng, variant: number): THREE.BufferGeometry;
  /** Crown footprint radius (m), for spacing. */
  radius: number;
  /** Trunk radius (m) for collision; 0 for soft plants you can walk through. */
  trunk: number;
  layer: 'tree' | 'under';
  castShadow: boolean;
  count: number;
  scale: [number, number];
  /** Probability (0..1) that the species grows at this site. */
  habitat(s: Site): number;
  /** Rotate so local +X points away from the island center (leaning palms). */
  leanOutward?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Palette
const BARK = C('#6f5638');
const BARK_LIGHT = C('#9a7b56');
const BARK_PALE = C('#9a917c');
const LEAF_DARK = C('#24572a');
const LEAF = C('#3d7f2f');
const LEAF_BRIGHT = C('#68b03d');
const LEAF_LIME = C('#86c24a');
const LEAF_OLIVE = C('#5d7a2c');

// Orchard near the house; rainforest deeper inland; palms along the coast.
const orchard = (s: Site): number => 1 - smoothstep(10, 34, s.house);
const forest = (s: Site): number => smoothstep(0.28, 0.55, s.inland) * (1 - 0.85 * orchard(s));
const edge = (s: Site): number => smoothstep(0.12, 0.3, s.inland) * (1 - smoothstep(0.45, 0.6, s.inland));

// ---------------------------------------------------------------------------------------------
// Coconut palm: curved ringed trunk, drooping fronds, coconuts.
const coconut: Species = {
  id: 'coconut',
  variants: 3,
  radius: 3,
  trunk: 0.3,
  layer: 'tree',
  castShadow: true,
  count: 60,
  scale: [0.8, 1.2],
  leanOutward: true,
  habitat: (s) => (1 - smoothstep(0.08, 0.32, s.inland)) * (s.onSand ? 0.7 : 1) + 0.04,
  build(rng, variant) {
    const height = 7 + variant * 1.4;
    const bend = randRange(rng, 1, 2.6);
    const b = new PlantBuilder(rng, bendWithHeight(10, 1));
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= 9; k++) {
      const t = k / 9;
      pts.push(V(bend * t * t, height * t, 0));
      radii.push(0.3 - 0.13 * t + 0.12 * (1 - Math.min(1, t * 8)));
    }
    b.tube(pts, radii, 6, (_t, ring) => (ring % 2 ? BARK : BARK_LIGHT));
    const top = V(bend, height, 0);
    for (let c = 0; c < 3; c++) {
      const a = (c / 3) * Math.PI * 2 + rng();
      b.blob(V(top.x + Math.cos(a) * 0.22, top.y - 0.25, top.z + Math.sin(a) * 0.22), 0.17, V(1, 1, 1), C('#6b5a2a'), 0.1, 0, 0.1);
    }
    for (let f = 0; f < 8; f++) {
      const phi = (f / 8) * Math.PI * 2 + (rng() - 0.5) * 0.5;
      b.leaf(top.clone().add(V(0, -0.05, 0)), dirAt(phi), randRange(rng, 3.4, 4.6), randRange(rng, 0.55, 0.75), {
        lift: randRange(rng, 0.25, 0.55),
        droop: randRange(rng, 0.75, 1.05),
        segs: 6,
        fold: 0.35,
        zigzag: 0.25,
        base: C('#2e6a27'),
        tip: C('#62ad3c'),
      });
    }
    return b.build();
  },
};

// Banana clump: 2–3 soft stems with huge paddle leaves; one carries a fruit bunch and a purple bud.
const banana: Species = {
  id: 'banana',
  variants: 2,
  radius: 1.8,
  trunk: 0,
  layer: 'tree',
  castShadow: true,
  count: 45,
  scale: [0.85, 1.15],
  habitat: (s) => (s.onSand ? 0 : 0.9 * orchard(s) + 0.25 * edge(s) * s.patch),
  build(rng, variant) {
    const b = new PlantBuilder(rng, bendWithHeight(3.5, 0.45));
    const stems = 2 + variant;
    for (let k = 0; k < stems; k++) {
      const a = (k / stems) * Math.PI * 2 + rng();
      const off = V(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
      const h = randRange(rng, 2.0, 2.9) * (k === 0 ? 1 : 0.8);
      b.tube([off.clone(), off.clone().add(V(0, h * 0.5, 0)), off.clone().add(V(0.05, h, 0))], [0.16, 0.13, 0.1], 7, (t) =>
        C('#7d8f4a').lerp(C('#5b7a33'), t),
      );
      const top = off.clone().add(V(0.05, h, 0));
      const leaves = 6;
      for (let l = 0; l < leaves; l++) {
        const phi = (l / leaves) * Math.PI * 2 + rng() * 0.6;
        b.leaf(top, dirAt(phi, 0.9), randRange(rng, 1.8, 2.4), randRange(rng, 0.38, 0.5), {
          lift: 0.15,
          droop: randRange(rng, 0.55, 0.9),
          segs: 6,
          fold: 0.1,
          base: C('#4d8f30'),
          tip: shade(LEAF_LIME, rng),
          shape: (t) => Math.min(1, t * 6) * (1 - Math.pow(t, 6)),
        });
      }
      if (k === 0) {
        // Fruit bunch hanging from the crown, with the purple flower bud at its end.
        const stalk = [top.clone(), top.clone().add(V(0.4, -0.3, 0)), top.clone().add(V(0.55, -0.9, 0))];
        b.tube(stalk, [0.04, 0.035, 0.03], 5, () => C('#6d7f3a'), 0.2);
        for (let r = 0; r < 5; r++) {
          const y = top.y - 0.35 - r * 0.12;
          for (let f = 0; f < 6; f++) {
            const a2 = (f / 6) * Math.PI * 2 + r;
            b.blob(V(0.45 + Math.cos(a2) * 0.13, y, Math.sin(a2) * 0.13), 0.07, V(0.6, 1.6, 0.6), C(r < 2 ? '#a9b83c' : '#d6c84a'), 0.05, 0, 0.2, 0.05);
          }
        }
        b.cone(top.clone().add(V(0.55, -0.9, 0)), V(0.1, -1, 0), 0.32, 0.11, 6, C('#6e2346'), 0.25);
      }
    }
    return b.build();
  },
};

// Papaya: slender ringed trunk, umbrella of palmate leaves, fruit cluster under the crown.
const papaya: Species = {
  id: 'papaya',
  variants: 2,
  radius: 1.5,
  trunk: 0.12,
  layer: 'tree',
  castShadow: true,
  count: 24,
  scale: [0.85, 1.15],
  habitat: (s) => (s.onSand ? 0 : 0.8 * orchard(s) + 0.08 * edge(s)),
  build(rng, variant) {
    const h = 3.6 + variant * 0.8;
    const b = new PlantBuilder(rng, bendWithHeight(h, 0.5));
    const lean = randRange(rng, 0.1, 0.35);
    const pts = [V(0, 0, 0), V(lean * 0.3, h * 0.5, 0), V(lean, h, 0)];
    b.tube(pts, [0.13, 0.1, 0.07], 6, (_t, ring) => (ring % 2 ? C('#8a8a6a') : C('#a19f7f')));
    const top = V(lean, h, 0);
    for (let l = 0; l < 11; l++) {
      const phi = (l / 11) * Math.PI * 2 + rng() * 0.4;
      const d = dirAt(phi, 0.45);
      const stalkLen = randRange(rng, 0.8, 1.1);
      const end = top.clone().addScaledVector(d, stalkLen).add(V(0, -0.1, 0));
      b.tube([top.clone(), end], [0.025, 0.02], 4, () => C('#9bb05a'), 0.5);
      // Palmate blade: a fan of short lobes.
      for (let lobe = -2; lobe <= 2; lobe++) {
        b.leaf(end, dirAt(phi + lobe * 0.38, -0.1), 0.55, 0.16, {
          lift: 0.05,
          droop: 0.35,
          segs: 3,
          fold: 0.15,
          base: C('#3f8a2f'),
          tip: shade(LEAF_BRIGHT, rng),
        });
      }
    }
    for (let f = 0; f < 8; f++) {
      const a = (f / 8) * Math.PI * 2 + rng();
      const ripe = rng() < 0.35;
      b.blob(V(lean + Math.cos(a) * 0.17, h - 0.35 - rng() * 0.35, Math.sin(a) * 0.17), 0.1, V(0.8, 1.3, 0.8), C(ripe ? '#e88a2a' : '#7fa83a'), 0.05, 0, 0.15, 0.05);
    }
    return b.build();
  },
};

const MOSS = C('#4f6b2a');

/**
 * Bark coloring for tubes: vertical streaks of lighter and darker bark around the trunk, and
 * moss creeping up the base on one side (like the shady side of a real trunk).
 */
function barkColors(rng: Rng, base: THREE.Color): (t: number, ring: number, angle: number) => THREE.Color {
  const tone = shade(base, rng, 0.06);
  const ph = rng() * Math.PI * 2;
  const mossSide = rng() * Math.PI * 2;
  // Each ring gets its own brightness, so the trunk shows irregular bands (bark plates, scars).
  const bands = Array.from({ length: 64 }, () => 0.88 + rng() * 0.24);
  return (t, ring, angle) => {
    const streak = 0.5 + 0.5 * Math.sin(angle * 7 + ph + t * 4) * Math.sin(angle * 3 - ph);
    const c = tone.clone().multiplyScalar((0.62 + 0.55 * streak) * bands[ring % bands.length]);
    const moss = Math.max(0, Math.cos(angle - mossSide)) * (1 - smoothstep(0, 0.25, t));
    return c.lerp(MOSS, moss * 0.7);
  };
}

interface LeafCluster {
  center: THREE.Vector3;
  /** Unit direction from the crown center. */
  dir: THREE.Vector3;
  size: number;
  /** 0 = crown core … 1 = outer surface. */
  outward: number;
}

/**
 * A lush crown: a dark core (so you can't see through it) wrapped in many clusters of
 * individual leaves concentrated near the surface. Each cluster is a spray of ~14 small folded
 * leaves fanning out and drooping from a twig point. Every vertex is shaded by its place in
 * the crown (darker below and inside, brighter on top and at the rim), which gives the foliage
 * depth without extra lights; every leaf flutters on its own in the wind (aTip).
 */
function foliageCrown(
  b: PlantBuilder,
  rng: Rng,
  center: THREE.Vector3,
  radius: number,
  flat: number,
  greens: THREE.Color[],
  count: number,
  leavesPerCluster = 18,
  /** Core radius and leaf-spray size, both relative to the crown radius. */
  shape: { core: number; size: [number, number] } = { core: 0.55, size: [0.16, 0.24] },
): LeafCluster[] {
  const h = radius * flat;
  const depth = (x: number, y: number, z: number): number => {
    const up = (y - center.y) / h; // -1 bottom … 1 top
    const rim = Math.hypot(x - center.x, z - center.z) / radius;
    return Math.min(1.2, Math.max(0.42, 0.55 + 0.28 * (up * 0.5 + 0.5) + 0.25 * rim));
  };
  // Small, ragged dark core: only fills gaps deep inside, never shows as a smooth lump.
  b.blob(center, radius * shape.core, V(1, flat * 0.85, 1), greens[0].clone().multiplyScalar(0.5), 0.4, 1, 0.15, 0.1, depth);

  const clusters: LeafCluster[] = [];
  const leafDir = new THREE.Vector3();
  const baseColor = new THREE.Color();
  const tipColor = new THREE.Color();
  for (let k = 0; k < count; k++) {
    // Random direction, slightly favoring the upper half (light-seeking crown).
    const dir = V(rng() * 2 - 1, rng() * 1.6 - 0.6, rng() * 2 - 1);
    if (dir.lengthSq() < 0.01) continue;
    dir.normalize();
    // Clusters sit on the crown's outer shell, so leaves (not the core) form the surface.
    const outward = 0.72 + 0.28 * Math.sqrt(rng());
    const c = center.clone().add(V(dir.x * radius * outward, dir.y * h * outward, dir.z * radius * outward));
    const size = radius * randRange(rng, shape.size[0], shape.size[1]);
    const green = shade(greens[Math.floor(rng() * greens.length)], rng, 0.1);
    clusters.push({ center: c, dir, size, outward });

    for (let l = 0; l < leavesPerCluster; l++) {
      // Leaves fan out over the outward hemisphere of the twig, drooping a little.
      leafDir.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
      if (leafDir.dot(dir) < 0) leafDir.addScaledVector(dir, -2 * leafDir.dot(dir));
      leafDir.addScaledVector(dir, 0.6).add(V(0, -0.25, 0)).normalize();
      const start = c.clone().addScaledVector(leafDir, size * 0.1);
      const len = size * randRange(rng, 0.8, 1.25);
      const lum = depth(start.x + leafDir.x * len, start.y + leafDir.y * len, start.z + leafDir.z * len) * (0.9 + rng() * 0.2);
      baseColor.copy(green).multiplyScalar(lum * 0.85);
      tipColor.copy(green).multiplyScalar(lum * 1.1);
      b.leafCard(start, leafDir, len, len * 0.42, baseColor, tipColor, 0.5 + rng() * 0.5);
    }
  }
  return clusters;
}

/** Branching tree with a crown made of lumpy blobs (mango, breadfruit, rainforest canopy). */
function crownTree(
  rng: Rng,
  o: {
    height: number;
    /** Where the trunk forks into branches, as a fraction of height. */
    fork?: number;
    trunkR: number;
    bark: THREE.Color;
    crownR: number;
    blobs: number;
    flat: number;
    leaf: THREE.Color[];
    flex: number;
    fruit?: { color: THREE.Color[]; count: number; size: number; elong: number };
    buttress?: boolean;
    /** A liana climbing the trunk. */
    vine?: boolean;
  },
): THREE.BufferGeometry {
  const b = new PlantBuilder(rng, bendWithHeight(o.height, o.flex));
  const forkY = o.height * (o.fork ?? 0.45);
  const lean = V(randRange(rng, -0.3, 0.3), 0, randRange(rng, -0.3, 0.3));
  const bark = barkColors(rng, o.bark);

  // Trunk: a gently meandering, tapering, slightly irregular column whose base flares into
  // root ridges (big plank buttresses on rainforest giants, small root flares on the rest).
  // Rings are denser near the ground, where the shape changes fastest.
  const rings = 10;
  const ys: number[] = [];
  for (let i = 0; i < rings; i++) ys.push(-0.4 + (forkY + 0.4) * Math.pow(i / (rings - 1), 1.6));
  const pts: THREE.Vector3[] = [];
  let wx = 0;
  let wz = 0;
  for (const y of ys) {
    const f = Math.max(0, y) / forkY;
    wx += (rng() - 0.5) * 0.3;
    wz += (rng() - 0.5) * 0.3;
    pts.push(V((lean.x + wx) * f, y, (lean.z + wz) * f));
  }
  const trunkTop = pts[pts.length - 1].clone();
  const radii = ys.map((y) => {
    const f = Math.max(0, y) / forkY;
    return o.trunkR * (1.15 - 0.5 * f) * (1 + 0.45 * Math.exp(-Math.max(0, y) / 0.5));
  });
  const lobes = o.buttress ? 5 : 4;
  const lobeAngles = Array.from({ length: lobes }, (_, k) => (k / lobes) * Math.PI * 2 + (rng() - 0.5) * 0.6);
  const lobeReach = lobeAngles.map(() => (o.buttress ? randRange(rng, 1.6, 2.6) : randRange(rng, 0.35, 0.65)));
  const flareHeight = o.buttress ? 2.6 : 0.9;
  const sharpness = o.buttress ? 14 : 5;
  const ph1 = rng() * Math.PI * 2;
  const ph2 = rng() * Math.PI * 2;
  b.tube(pts, radii, o.buttress ? 30 : 14, bark, 0, (ring, ang) => {
    const flare = Math.pow(Math.max(0, 1 - Math.max(0, ys[ring]) / flareHeight), 1.5);
    let ridge = 0;
    lobeAngles.forEach((la, k) => {
      ridge = Math.max(ridge, Math.pow(Math.max(0, Math.cos(ang - la)), sharpness) * lobeReach[k]);
    });
    // Real trunks are never perfectly round: lumps that drift around the trunk with height
    // (knots, fluting), so the silhouette changes as you walk around it.
    const irregular = 1 + 0.1 * Math.sin(3 * ang + ph1 + ring * 0.7) + 0.07 * Math.sin(5 * ang + ph2 - ring * 1.1);
    return irregular * (1 + flare * ridge);
  });
  if (o.vine) {
    // A liana spiralling up the trunk, with a few leaves.
    const vine: THREE.Vector3[] = [];
    const vineR: number[] = [];
    const start = rng() * Math.PI * 2;
    for (let i = 1; i < rings; i++) {
      const a = start + i * 0.9;
      const r = radii[i] * 1.06;
      vine.push(pts[i].clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r)));
      vineR.push(0.045);
    }
    b.tube(vine, vineR, 4, () => C('#3d4a22'));
    for (let k = 2; k < vine.length; k += 2) {
      const out = vine[k].clone().sub(pts[k + 1]).setY(0).normalize();
      b.leaf(vine[k], out.add(V(0, 0.3, 0)).normalize(), 0.35, 0.12, { lift: 0.1, droop: 0.5, segs: 2, base: LEAF_DARK, tip: LEAF });
    }
  }
  if (o.buttress) {
    // A few short surface roots between the ridges. The same geometry is used on every slope,
    // so they dive steeply: on a downhill side they still end inside the soil, not in mid-air.
    for (let k = 0; k < 4; k++) {
      const a = lobeAngles[k] + Math.PI / lobes + (rng() - 0.5) * 0.4;
      const d = dirAt(a);
      const side = V(-d.z, 0, d.x);
      const len = randRange(rng, 1.3, 2.1);
      const wiggle = (rng() - 0.5) * 0.5;
      const root: THREE.Vector3[] = [];
      for (let s = 0; s <= 4; s++) {
        const t = s / 4;
        root.push(
          V(0, 0, 0)
            .addScaledVector(d, o.trunkR * 0.8 + len * t)
            .addScaledVector(side, Math.sin(t * Math.PI) * wiggle)
            .add(V(0, 0.1 - Math.pow(t, 1.5) * 1.1, 0)),
        );
      }
      b.tube(root, [0.22, 0.17, 0.12, 0.08, 0.05].map((r) => r * o.trunkR * 1.3), 5, bark);
    }
  }
  const crownCenter = V(trunkTop.x * 1.3, o.height - o.crownR * o.flat * 0.9, trunkTop.z * 1.3);
  const branches = 3 + Math.floor(rng() * 2);
  const topR = radii[radii.length - 1];
  for (let k = 0; k < branches; k++) {
    const a = (k / branches) * Math.PI * 2 + rng();
    // Branch ends stay inside the crown, so no bare sticks poke out below the leaves.
    const end = crownCenter.clone().add(V(Math.cos(a) * o.crownR * 0.45, -0.25 * o.crownR * o.flat, Math.sin(a) * o.crownR * 0.45));
    // Branches leave the trunk upward and curve outward, with a little kink in the middle.
    const p1 = trunkTop.clone().lerp(end, 0.3).add(V((rng() - 0.5) * 0.4, o.height * 0.06, (rng() - 0.5) * 0.4));
    const p2 = trunkTop.clone().lerp(end, 0.65).add(V((rng() - 0.5) * 0.5, o.height * 0.04, (rng() - 0.5) * 0.5));
    b.tube([trunkTop.clone().add(V(0, -topR, 0)), p1, p2, end], [topR * 0.85, topR * 0.6, topR * 0.42, topR * 0.25], 7, bark);
    // A smaller side branch from the kink.
    const side = p1.clone().lerp(end, 0.5).add(V(Math.cos(a + 1.2) * o.crownR * 0.35, o.crownR * o.flat * 0.2, Math.sin(a + 1.2) * o.crownR * 0.35));
    b.tube([p1.clone(), p1.clone().lerp(side, 0.5).add(V(0, 0.3, 0)), side], [topR * 0.4, topR * 0.28, topR * 0.16], 5, bark);
  }
  const clusters = foliageCrown(b, rng, crownCenter, o.crownR, o.flat, o.leaf, o.blobs * 7);
  // Fruit hangs from the outer clusters, mostly on the lower half of the crown.
  if (o.fruit) {
    const outer = clusters.filter((c) => c.outward > 0.75);
    const lower = outer.filter((c) => c.dir.y < 0.3);
    const pool = lower.length ? lower : outer;
    for (let k = 0; k < o.fruit.count; k++) {
      const c = pool[Math.floor(rng() * pool.length)];
      const n = c.dir.clone().add(V((rng() - 0.5) * 0.6, -0.4, (rng() - 0.5) * 0.6)).normalize();
      const color = o.fruit.color[Math.floor(rng() * o.fruit.color.length)];
      b.blob(c.center.clone().addScaledVector(n, c.size * 0.95), o.fruit.size, V(1, o.fruit.elong, 1), color, 0.05, 0, 0.3, 0.06);
    }
  }
  return b.build();
}

const mango: Species = {
  id: 'mango',
  variants: 2,
  radius: 3.4,
  trunk: 0.3,
  layer: 'tree',
  castShadow: true,
  count: 24,
  scale: [0.85, 1.15],
  habitat: (s) => (s.onSand ? 0 : 0.7 * orchard(s) + 0.15 * edge(s)),
  build: (rng, variant) =>
    variant === 0
      ? // Mango: dense dark crown with yellow-orange fruit.
        crownTree(rng, {
          height: 7.5, fork: 0.3, trunkR: 0.3, bark: C('#5e4a38'), crownR: 3.4, blobs: 9, flat: 0.75, flex: 0.35,
          leaf: [LEAF_DARK, LEAF], fruit: { color: [C('#f2b632'), C('#e8762c'), C('#c94a2a'), C('#9fb43c')], count: 22, size: 0.11, elong: 1.4 },
        })
      : // Breadfruit / jackfruit: lighter, larger leaves and big green fruit.
        crownTree(rng, {
          height: 8.5, fork: 0.32, trunkR: 0.32, bark: BARK_PALE, crownR: 3.6, blobs: 8, flat: 0.8, flex: 0.3,
          leaf: [LEAF, LEAF_BRIGHT], fruit: { color: [C('#8fb03a'), C('#a7b84a')], count: 12, size: 0.22, elong: 1.15 },
        }),
};

// Rainforest canopy: tall straight trunks and broad, layered crowns in varied greens.
const canopy: Species = {
  id: 'canopy',
  variants: 3,
  radius: 4,
  trunk: 0.35,
  layer: 'tree',
  castShadow: true,
  count: 150,
  scale: [0.85, 1.2],
  habitat: (s) => (s.onSand ? 0 : forest(s) * (0.6 + 0.4 * s.patch)),
  build: (rng, variant) =>
    crownTree(rng, {
      height: 13 + variant * 1.5,
      fork: 0.4,
      trunkR: 0.34,
      // Dark brown, grey-brown and reddish bark across the three variants.
      bark: [C('#5a4632'), C('#6d6556'), C('#7a5440')][variant],
      crownR: 5,
      blobs: 14,
      flat: 0.7,
      flex: 0.4,
      leaf: variant === 0 ? [LEAF_DARK, LEAF] : variant === 1 ? [LEAF_OLIVE, LEAF] : [LEAF, LEAF_BRIGHT],
      vine: variant !== 1,
    }),
};

// Emergent giants (kapok/ceiba-like): towering pale trunks, buttress roots, wide flat crowns.
const emergent: Species = {
  id: 'emergent',
  variants: 2,
  radius: 7,
  trunk: 0.9,
  layer: 'tree',
  castShadow: true,
  count: 14,
  scale: [0.9, 1.15],
  habitat: (s) => (s.onSand ? 0 : smoothstep(0.5, 0.8, s.inland) * (1 - orchard(s))),
  build: (rng, variant) =>
    crownTree(rng, {
      height: 23 + variant * 4,
      trunkR: 0.75,
      bark: BARK_PALE,
      fork: 0.55,
      crownR: 7,
      blobs: 18,
      flat: 0.45,
      flex: 0.3,
      leaf: [LEAF_DARK, LEAF_OLIVE, LEAF],
      buttress: true,
      vine: variant === 0,
    }),
};

// Tree fern: thin dark trunk with a crown of feathery fronds — classic rainforest understory.
const treeFern: Species = {
  id: 'treeFern',
  variants: 2,
  radius: 1.8,
  trunk: 0.12,
  layer: 'tree',
  castShadow: true,
  count: 70,
  scale: [0.8, 1.25],
  habitat: (s) => (s.onSand ? 0 : forest(s) * 0.9),
  build(rng, variant) {
    const h = 2.8 + variant * 1.2;
    const b = new PlantBuilder(rng, bendWithHeight(h, 0.4));
    b.tube([V(0, 0, 0), V(0.1, h * 0.5, 0), V(0.15, h, 0)], [0.16, 0.13, 0.11], 6, () => C('#4a3a2a'));
    const top = V(0.15, h, 0);
    for (let f = 0; f < 11; f++) {
      b.leaf(top, dirAt((f / 11) * Math.PI * 2 + rng() * 0.4), randRange(rng, 1.8, 2.4), 0.32, {
        lift: 0.45,
        droop: 0.85,
        segs: 9,
        fold: 0.15,
        zigzag: 0.55,
        base: C('#3b7a2c'),
        tip: shade(LEAF_LIME, rng),
      });
    }
    return b.build();
  },
};

// Frangipani (hoa sứ): forked grey branches, leaf rosettes at the tips, fragrant blossoms.
const frangipani: Species = {
  id: 'frangipani',
  variants: 2,
  radius: 2.2,
  trunk: 0.15,
  layer: 'tree',
  castShadow: true,
  count: 18,
  scale: [0.85, 1.2],
  habitat: (s) => (s.onSand ? 0.15 * edge(s) : 0.6 * orchard(s) + 0.25 * edge(s)),
  build(rng, variant) {
    const b = new PlantBuilder(rng, bendWithHeight(4.5, 0.3));
    const bark = barkColors(rng, C('#8f8a78'));
    const petal = variant === 0 ? C('#fbf6ea') : C('#f08cb0');
    b.tube([V(0, -0.3, 0), V(0, 0.9, 0), V(0.05, 1.5, 0)], [0.17, 0.14, 0.12], 8, bark);
    const fork = V(0.05, 1.5, 0);
    // Child branches start a little inside their parent, so joints have no open seams.
    const sunk = V(0, -0.15, 0);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rng() * 0.6;
      const mid = fork.clone().add(V(Math.cos(a) * 0.8, 1.1, Math.sin(a) * 0.8));
      b.tube([fork.clone().add(sunk), fork.clone().lerp(mid, 0.5).add(V(0, 0.1, 0)), mid], [0.11, 0.09, 0.08], 6, bark);
      for (let j = 0; j < 2; j++) {
        const a2 = a + (j - 0.5) * 0.9;
        const tip = mid.clone().add(V(Math.cos(a2) * 0.7, 1.0 + rng() * 0.5, Math.sin(a2) * 0.7));
        b.tube([mid.clone().add(sunk), tip], [0.075, 0.05], 5, bark);
        for (let l = 0; l < 6; l++) {
          b.leaf(tip, dirAt((l / 6) * Math.PI * 2 + rng(), 0.5), 0.55, 0.12, { lift: 0.15, droop: 0.45, segs: 3, base: LEAF, tip: LEAF_BRIGHT });
        }
        for (let f = 0; f < 5; f++) {
          const n = V(rng() - 0.5, 1, rng() - 0.5).normalize();
          b.flower(tip.clone().add(V((rng() - 0.5) * 0.3, 0.12 + rng() * 0.1, (rng() - 0.5) * 0.3)), n, 0.09, 5, petal, C('#f6c94a'));
        }
      }
    }
    return b.build();
  },
};

// Hibiscus (dâm bụt): leafy bush covered in big five-petal blooms.
const hibiscus: Species = {
  id: 'hibiscus',
  variants: 3,
  radius: 1.1,
  trunk: 0,
  layer: 'under',
  castShadow: false,
  count: 50,
  scale: [0.8, 1.2],
  habitat: (s) => (s.onSand ? 0.1 : 0.7 * orchard(s) + 0.35 * edge(s)),
  build(rng, variant) {
    const b = new PlantBuilder(rng, bendWithHeight(1.6, 0.15));
    const petal = [C('#d81f3c'), C('#f2c12e'), C('#ef6fa3')][variant];
    bushStems(b, rng, 0.7);
    const clusters = foliageCrown(b, rng, V(0, 0.8, 0), 0.75, 0.85, [LEAF, LEAF_DARK, LEAF_BRIGHT], 34, 14, BUSH_SHAPE);
    // Blooms sit on the outer leaf sprays, facing outward.
    const outer = clusters.filter((c) => c.outward > 0.8 && c.dir.y > -0.3);
    for (let f = 0; f < 16 && outer.length > 0; f++) {
      const c = outer[Math.floor(rng() * outer.length)];
      b.flower(c.center.clone().addScaledVector(c.dir, c.size * 0.8), c.dir, 0.12, 5, shade(petal, rng, 0.08), C('#f7e7a0'));
    }
    return b.build();
  },
};

/**
 * Bushes are small, so leaves relative to the bush are much bigger than on a tree, and the
 * core is tiny: otherwise the core shows through as a smooth dark lump.
 */
const BUSH_SHAPE = { core: 0.3, size: [0.32, 0.45] as [number, number] };

/** A few woody stems from the ground up into a bush, visible under its leaves. */
function bushStems(b: PlantBuilder, rng: Rng, height: number): void {
  const bark = barkColors(rng, C('#5e4a38'));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng();
    const top = V(Math.cos(a) * 0.3, height, Math.sin(a) * 0.3);
    b.tube([V(0, -0.1, 0), V(top.x * 0.4, height * 0.5, top.z * 0.4), top], [0.04, 0.03, 0.02], 4, bark);
  }
}

// Understory shrubs: low dark-green mounds filling the forest floor.
const shrub: Species = {
  id: 'shrub',
  variants: 2,
  radius: 1,
  trunk: 0,
  layer: 'under',
  castShadow: false,
  count: 280,
  scale: [0.7, 1.5],
  habitat: (s) => (s.onSand ? 0 : 0.9 * forest(s) + 0.3 * edge(s)),
  build(rng, variant) {
    const b = new PlantBuilder(rng, bendWithHeight(1.2, 0.1));
    const greens = variant === 0 ? [LEAF_DARK, LEAF, LEAF_BRIGHT] : [LEAF_OLIVE, LEAF, LEAF_LIME];
    bushStems(b, rng, 0.45);
    // Variant 1 is lower and wider, like a spreading ground shrub.
    foliageCrown(b, rng, V(0, variant ? 0.45 : 0.55, 0), variant ? 0.75 : 0.62, variant ? 0.6 : 0.8, greens, 30, 14, BUSH_SHAPE);
    return b.build();
  },
};

// Ground ferns: arching feathery fronds from a single crown.
const fern: Species = {
  id: 'fern',
  variants: 2,
  radius: 0.9,
  trunk: 0,
  layer: 'under',
  castShadow: false,
  count: 260,
  scale: [0.8, 1.5],
  habitat: (s) => (s.onSand ? 0 : forest(s) + 0.2 * edge(s)),
  build(rng, variant) {
    const b = new PlantBuilder(rng, bendWithHeight(1, 0.08));
    const n = 9 + variant * 3;
    for (let f = 0; f < n; f++) {
      b.leaf(V(0, 0.05, 0), dirAt((f / n) * Math.PI * 2 + rng() * 0.5), randRange(rng, 0.8, 1.2), 0.18, {
        lift: 0.9,
        droop: 1.0,
        segs: 7,
        fold: 0.1,
        zigzag: 0.6,
        base: C('#2f6b28'),
        tip: shade(variant ? LEAF_LIME : LEAF_BRIGHT, rng),
      });
    }
    return b.build();
  },
};

// Heliconia (chuối mỏ két): upright paddle leaves and zig-zag "lobster claw" flower spikes.
const heliconia: Species = {
  id: 'heliconia',
  variants: 2,
  radius: 0.9,
  trunk: 0,
  layer: 'under',
  castShadow: false,
  count: 60,
  scale: [0.8, 1.2],
  habitat: (s) => (s.onSand ? 0 : 0.5 * forest(s) + 0.5 * edge(s) + 0.3 * orchard(s)),
  build(rng, variant) {
    const b = new PlantBuilder(rng, bendWithHeight(1.8, 0.2));
    for (let l = 0; l < 6; l++) {
      const a = (l / 6) * Math.PI * 2 + rng();
      b.leaf(V(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1), dirAt(a, 3.2), randRange(rng, 1.4, 1.8), 0.2, {
        lift: 0,
        droop: 0.35,
        segs: 5,
        fold: 0.1,
        base: C('#3c7a2c'),
        tip: shade(LEAF_BRIGHT, rng),
        shape: (t) => Math.min(1, t * 2.5) * (1 - Math.pow(t, 4)),
      });
    }
    const bract = variant === 0 ? C('#e0302a') : C('#f2b928');
    const lip = variant === 0 ? C('#f4d03f') : C('#e05a2a');
    for (let s = 0; s < 2; s++) {
      const base = V((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3);
      const h = randRange(rng, 1.1, 1.5);
      b.tube([base.clone(), base.clone().add(V(0, h, 0))], [0.03, 0.025], 4, () => C('#5f8a35'), 0.3);
      for (let k = 0; k < 6; k++) {
        const side = k % 2 ? 1 : -1;
        const y = h - 0.05 - k * 0.11;
        b.cone(base.clone().add(V(0, y, 0)), V(side, 0.6, 0.2 * side), 0.2, 0.05, 4, k === 0 ? lip : bract, 0.35);
      }
    }
    return b.build();
  },
};

/** Placement order matters: big trees claim space first, the understory fills in around them. */
export const SPECIES: readonly Species[] = [
  emergent, canopy, mango, coconut, papaya, banana, frangipani, treeFern, hibiscus, heliconia, shrub, fern,
];
