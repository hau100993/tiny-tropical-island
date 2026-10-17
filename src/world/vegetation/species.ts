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
const BARK_GREY = C('#6f6858');
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
    flowers?: { color: THREE.Color; count: number };
    buttress?: boolean;
  },
): THREE.BufferGeometry {
  const b = new PlantBuilder(rng, bendWithHeight(o.height, o.flex));
  const forkY = o.height * (o.fork ?? 0.45);
  const lean = V(randRange(rng, -0.3, 0.3), 0, randRange(rng, -0.3, 0.3));
  const trunkTop = V(lean.x, forkY, lean.z);
  b.tube([V(0, 0, 0), V(lean.x * 0.4, forkY * 0.5, lean.z * 0.4), trunkTop], [o.trunkR * 1.25, o.trunkR, o.trunkR * 0.85], 7, () => shade(o.bark, rng, 0.05));
  if (o.buttress) {
    // Plank-like buttress roots of rainforest giants.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rng() * 0.5;
      const out = o.trunkR * randRange(rng, 2.6, 3.6);
      const up = o.height * randRange(rng, 0.09, 0.13);
      const d = dirAt(a);
      b.fin(V(d.x * o.trunkR * 0.6, up, d.z * o.trunkR * 0.6), V(d.x * o.trunkR * 0.7, -0.2, d.z * o.trunkR * 0.7), V(d.x * out, -0.2, d.z * out), shade(o.bark, rng, 0.05));
    }
  }
  const crownCenter = V(lean.x * 1.5, o.height - o.crownR * o.flat * 0.9, lean.z * 1.5);
  const branches = 3 + Math.floor(rng() * 2);
  for (let k = 0; k < branches; k++) {
    const a = (k / branches) * Math.PI * 2 + rng();
    // Branch ends stay inside the crown, so no bare sticks poke out below the leaves.
    const end = crownCenter.clone().add(V(Math.cos(a) * o.crownR * 0.45, -0.25 * o.crownR * o.flat, Math.sin(a) * o.crownR * 0.45));
    const mid = trunkTop.clone().lerp(end, 0.5).add(V(0, o.height * 0.05, 0));
    b.tube([trunkTop.clone(), mid, end], [o.trunkR * 0.7, o.trunkR * 0.45, o.trunkR * 0.25], 5, () => shade(o.bark, rng, 0.05));
  }
  const blobCenters: THREE.Vector3[] = [];
  for (let k = 0; k < o.blobs; k++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * o.crownR * 0.75;
    const c = crownCenter.clone().add(V(Math.cos(a) * r, (rng() - 0.5) * o.crownR * o.flat * 0.9, Math.sin(a) * r));
    blobCenters.push(c);
    const color = shade(o.leaf[Math.floor(rng() * o.leaf.length)], rng, 0.08);
    const s = randRange(rng, 0.45, 0.65) * o.crownR;
    b.blob(c, s, V(1, o.flat, 1), color, 0.25, 1, 0.3);
  }
  // Fruit and flowers sit just outside the crown surface, mostly on the lower half.
  const onCrown = (lower: boolean): { p: THREE.Vector3; n: THREE.Vector3 } => {
    const c = blobCenters[Math.floor(rng() * blobCenters.length)];
    const n = V(rng() - 0.5, lower ? -rng() * 0.8 : rng() - 0.2, rng() - 0.5).normalize();
    const r = o.crownR * 0.55;
    return { p: c.clone().add(V(n.x * r, n.y * r * o.flat, n.z * r)), n };
  };
  if (o.fruit) {
    for (let k = 0; k < o.fruit.count; k++) {
      const { p } = onCrown(true);
      const color = o.fruit.color[Math.floor(rng() * o.fruit.color.length)];
      b.blob(p, o.fruit.size, V(1, o.fruit.elong, 1), color, 0.05, 0, 0.3, 0.06);
    }
  }
  if (o.flowers) {
    for (let k = 0; k < o.flowers.count; k++) {
      const { p, n } = onCrown(false);
      b.flower(p, n, randRange(rng, 0.25, 0.4), 5, shade(o.flowers.color, rng, 0.1), C('#ffd84a'), 0.35);
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
          height: 7.5, trunkR: 0.28, bark: BARK_GREY, crownR: 3.4, blobs: 9, flat: 0.75, flex: 0.35,
          leaf: [LEAF_DARK, LEAF], fruit: { color: [C('#f2b632'), C('#e8762c'), C('#c94a2a'), C('#9fb43c')], count: 22, size: 0.11, elong: 1.4 },
        })
      : // Breadfruit / jackfruit: lighter, larger leaves and big green fruit.
        crownTree(rng, {
          height: 8.5, trunkR: 0.3, bark: BARK_PALE, crownR: 3.6, blobs: 8, flat: 0.8, flex: 0.3,
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
      trunkR: 0.32,
      bark: variant === 1 ? BARK_PALE : BARK_GREY,
      crownR: 5,
      blobs: 14,
      flat: 0.7,
      flex: 0.4,
      leaf: variant === 0 ? [LEAF_DARK, LEAF] : variant === 1 ? [LEAF_OLIVE, LEAF] : [LEAF, LEAF_BRIGHT],
      // One variant flowers like a flame tree (phượng): crimson-orange blooms over the canopy.
      flowers: variant === 2 ? { color: C('#e2482a'), count: 70 } : undefined,
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
    const bark = C('#8f8a78');
    const petal = variant === 0 ? C('#fbf6ea') : C('#f08cb0');
    b.tube([V(0, 0, 0), V(0, 0.9, 0), V(0.05, 1.5, 0)], [0.16, 0.14, 0.12], 6, () => bark);
    const fork = V(0.05, 1.5, 0);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rng() * 0.6;
      const mid = fork.clone().add(V(Math.cos(a) * 0.8, 1.1, Math.sin(a) * 0.8));
      b.tube([fork.clone(), mid], [0.1, 0.08], 5, () => bark);
      for (let j = 0; j < 2; j++) {
        const a2 = a + (j - 0.5) * 0.9;
        const tip = mid.clone().add(V(Math.cos(a2) * 0.7, 1.0 + rng() * 0.5, Math.sin(a2) * 0.7));
        b.tube([mid.clone(), tip], [0.07, 0.05], 5, () => bark);
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
    const centers: THREE.Vector3[] = [];
    for (let k = 0; k < 6; k++) {
      const c = V((rng() - 0.5) * 1.0, 0.45 + rng() * 0.8, (rng() - 0.5) * 1.0);
      centers.push(c);
      b.blob(c, randRange(rng, 0.38, 0.5), V(1, 0.85, 1), shade(LEAF, rng), 0.25, 1, 0.3);
    }
    for (let f = 0; f < 16; f++) {
      const c = centers[Math.floor(rng() * centers.length)];
      const n = V(rng() - 0.5, rng() * 0.8, rng() - 0.5).normalize();
      b.flower(c.clone().addScaledVector(n, 0.45), n, 0.13, 5, petal, C('#f7e7a0'));
    }
    return b.build();
  },
};

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
    const greens = variant === 0 ? [LEAF_DARK, LEAF] : [LEAF_OLIVE, LEAF];
    for (let k = 0; k < 4; k++) {
      b.blob(V((rng() - 0.5) * 0.9, 0.3 + rng() * 0.35, (rng() - 0.5) * 0.9), randRange(rng, 0.35, 0.5), V(1, 0.75, 1), shade(greens[k % 2], rng), 0.3, 1, 0.25);
    }
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
