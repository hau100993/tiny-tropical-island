import * as THREE from 'three';
import { seededVariation, type PetLook } from './looks';
import type { SpeciesId } from '../../pets/species';

/** What a pet is doing, for its animation. */
export type BodyAction = 'idle' | 'move' | 'greet' | 'dance' | 'skill';

/**
 * A pet's model and its animation, whatever made it (a hand-built one here, or a loaded .glb for
 * the crab, dragon and bunny). Units: metres; the root stands on the ground at its origin.
 */
export interface PetBody {
  readonly root: THREE.Group;
  /** The top of the head above the root (m, at scale 1). */
  readonly head: number;
  /** Height it flies or floats at (m; 0 walks on the ground). */
  readonly hover: number;
  /** Walking speed (m/s). */
  readonly speed: number;
  animate(dt: number, action: BodyAction, moving: number, wind: number): void;
}

const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x101018, roughness: 0.15 });
const sphere = new THREE.SphereGeometry(1, 16, 12);
const lowSphere = new THREE.SphereGeometry(1, 8, 6);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 8);
const cone = new THREE.ConeGeometry(1, 1, 8);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Two cute eyes: white balls with big dark pupils and a sparkle, looking along +z. */
function eyes(parent: THREE.Object3D, size: number, gap: number, y: number, z: number): void {
  for (const side of [-1, 1]) {
    const white = mesh(sphere, eyeWhite, size, size * 1.1, size * 0.7, side * gap, y, z);
    const pupil = mesh(sphere, eyeBlack, size * 0.72, size * 0.8, size * 0.5, 0, 0, 0.45);
    const glint = mesh(sphere, eyeWhite, 0.25, 0.25, 0.2, 0.25, 0.3, 0.45);
    pupil.add(glint);
    white.add(pupil);
    white.castShadow = false;
    parent.add(white);
  }
}

/** The species' colours, shifted by the individual's seed; shiny ones golden. */
function palette(look: Readonly<PetLook>, colors: number[]): THREE.Color[] {
  const v = seededVariation(look.seed);
  const hsl = { h: 0, s: 0, l: 0 };
  return colors.map((hex) => {
    const c = new THREE.Color(hex);
    c.getHSL(hsl);
    c.setHSL((hsl.h + v.hue + 1) % 1, hsl.s, hsl.l);
    if (look.shiny) c.lerp(new THREE.Color(0xffd36a), 0.5);
    return c;
  });
}

function std(color: THREE.Color, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...opts });
}

/** Builds a hand-made body for the egg species. */
export function buildBody(species: SpeciesId, look: Readonly<PetLook>): PetBody {
  const v = seededVariation(look.seed);
  let body: PetBody;
  switch (species) {
    case 'sparkfly':
      body = sparkfly(look, v.accessory);
      break;
    case 'jelly':
      body = jelly(look, v.accessory);
      break;
    case 'lava':
      body = lava(look, v.accessory);
      break;
    case 'turtle':
      body = turtle(look, v.accessory);
      break;
    default:
      body = owl(look, v.accessory);
  }
  // Built at about the bunny's size; a bit bigger reads better from the overview.
  const size = 1.3 * v.size;
  body.root.scale.setScalar(size);
  body.root.userData.baseScale = size;
  return body;
}

/** Đom Đóm Sét: a firefly with a glowing tail light, buzzing wings, antennae. Flies. */
function sparkfly(look: Readonly<PetLook>, acc: number): PetBody {
  const [bodyC, glowC, wingC] = palette(look, [0x3a3550, 0xffe14a, 0xcfe8ff]);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const dark = std(bodyC, { roughness: 0.4 });
  const glow = std(glowC, { emissive: glowC, emissiveIntensity: 1.6 });
  const wingMat = std(wingC, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.1 });
  pivot.add(mesh(sphere, dark, 0.13, 0.12, 0.15, 0, 0, 0.08));
  const tail = mesh(sphere, glow, 0.15, 0.14, 0.2, 0, -0.02, -0.16);
  tail.castShadow = false;
  pivot.add(tail);
  eyes(pivot, 0.045, 0.06, 0.04, 0.2);
  const antennae: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const a = mesh(cylinder, dark, 0.008, 0.16, 0.008, side * 0.04, 0.15, 0.15);
    a.rotation.z = -side * 0.4;
    a.rotation.x = 0.4;
    const tip = mesh(sphere, glow, 1.6, 0.18, 1.6, 0, 0.5, 0);
    a.add(tip);
    pivot.add(a);
    antennae.push(a);
  }
  const wingGeo = new THREE.CircleGeometry(1, 12);
  const wings: THREE.Mesh[] = [];
  const pairs = look.level === 2 ? 2 : 1;
  for (let p = 0; p < pairs; p++) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo, wingMat);
      w.scale.set(0.2 - p * 0.05, 0.08, 1);
      w.position.set(side * 0.13, 0.1, 0.02 - p * 0.12);
      w.userData.side = side;
      pivot.add(w);
      wings.push(w);
    }
  }
  // Accessory: a tiny bow, a second glow, or nothing.
  if (acc === 1) pivot.add(mesh(lowSphere, glow, 0.05, 0.05, 0.05, 0, 0.13, 0));
  const sparks: THREE.Mesh[] = [];
  if (look.level === 2) {
    for (let i = 0; i < 4; i++) {
      const s = mesh(sphere, glow, 0.025, 0.025, 0.025);
      s.castShadow = false;
      root.add(s);
      sparks.push(s);
    }
  }
  let t = Math.random() * 10;
  return {
    root,
    head: 0.25,
    hover: 1.1,
    speed: 1.8,
    animate(dt, action, moving) {
      t += dt;
      const buzz = Math.sin(t * 60);
      for (const w of wings) w.rotation.y = (w.userData.side as number) * (0.3 + 0.6 * buzz);
      pivot.position.y = Math.sin(t * 2.2) * 0.06 + (action === 'dance' ? Math.abs(Math.sin(t * 6)) * 0.2 : 0);
      pivot.rotation.x = -moving * 0.35;
      pivot.rotation.z = action === 'dance' ? Math.sin(t * 8) * 0.4 : Math.sin(t * 1.3) * 0.08;
      const pulse = 0.6 + 0.4 * Math.sin(t * (action === 'skill' ? 14 : 3));
      // No PointLight: adding lights would recompile every material in the scene.
      glow.emissiveIntensity = 1 + pulse * (action === 'skill' ? 3 : 1.2);
      for (const a of antennae) a.rotation.y = Math.sin(t * 4) * 0.2;
      sparks.forEach((s, i) => {
        const a = t * 2.5 + (i / sparks.length) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.3, pivot.position.y + 0.05 + Math.sin(t * 3 + i) * 0.05, Math.sin(a) * 0.3);
      });
    },
  };
}

/** Sứa Mây: a cloud jellyfish, a pulsing bell and swaying tentacles. Floats. */
function jelly(look: Readonly<PetLook>, acc: number): PetBody {
  const [bellC, innerC, tentC] = palette(look, [0x9fd6ff, 0xffb8e6, 0xc8f0ff]);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const bellMat = std(bellC, { transparent: true, opacity: 0.72, emissive: bellC, emissiveIntensity: 0.35, roughness: 0.15 });
  const innerMat = std(innerC, { emissive: innerC, emissiveIntensity: 0.5 });
  const tentMat = std(tentC, { transparent: true, opacity: 0.7, emissive: tentC, emissiveIntensity: 0.3 });
  const bellGeo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const bell = new THREE.Mesh(bellGeo, bellMat);
  bell.scale.set(0.3, 0.26, 0.3);
  bell.castShadow = true;
  pivot.add(bell);
  pivot.add(mesh(sphere, innerMat, 0.13, 0.1, 0.13, 0, 0.05, 0));
  eyes(pivot, 0.035, 0.08, 0.1, 0.25);
  // A frill round the rim.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 24), bellMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.04;
  pivot.add(rim);
  const tentacles: THREE.Object3D[][] = [];
  const count = look.level === 2 ? 8 : 6;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const chain: THREE.Object3D[] = [];
    let parent: THREE.Object3D = pivot;
    for (let k = 0; k < 3; k++) {
      const seg = new THREE.Group();
      seg.position.set(k === 0 ? Math.cos(a) * 0.18 : 0, k === 0 ? 0.02 : -0.13, k === 0 ? Math.sin(a) * 0.18 : 0);
      seg.add(mesh(cylinder, tentMat, 0.018 - k * 0.004, 0.14, 0.018 - k * 0.004, 0, -0.07, 0));
      parent.add(seg);
      chain.push(seg);
      parent = seg;
    }
    tentacles.push(chain);
  }
  if (look.level === 2 || acc === 2) {
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 16), innerMat);
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 0.27;
    pivot.add(crown);
  }
  let t = Math.random() * 10;
  return {
    root,
    head: 0.3,
    hover: 1.0,
    speed: 1.1,
    animate(dt, action) {
      t += dt;
      const rate = action === 'skill' ? 7 : action === 'dance' ? 5 : 2.4;
      const pulse = Math.sin(t * rate);
      bell.scale.set(0.3 * (1 + 0.08 * pulse), 0.26 * (1 - 0.1 * pulse), 0.3 * (1 + 0.08 * pulse));
      pivot.position.y = Math.sin(t * 1.3) * 0.08 - pulse * 0.02;
      pivot.rotation.y += dt * (action === 'dance' ? 3 : 0.3);
      tentacles.forEach((chain, i) => {
        chain.forEach((seg, k) => {
          seg.rotation.x = Math.sin(t * 2 + i + k * 0.8) * (0.2 + 0.1 * k);
          seg.rotation.z = Math.cos(t * 1.7 + i * 1.3 + k) * (0.15 + 0.1 * k);
        });
      });
      bellMat.emissiveIntensity = 0.35 + (action === 'skill' ? 0.6 : 0.15) * (0.5 + 0.5 * pulse);
    },
  };
}

/** Bé Dung Nham: a lava slime with a cooling crust, hopping with squash and stretch. */
function lava(look: Readonly<PetLook>, acc: number): PetBody {
  const [hotC, crustC, flameC] = palette(look, [0xff6a1a, 0x5a2a1a, 0xffc23a]);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const hot = std(hotC, { emissive: hotC, emissiveIntensity: 0.9, roughness: 0.3 });
  const crust = std(crustC, { roughness: 0.9, flatShading: true });
  const flame = std(flameC, { emissive: flameC, emissiveIntensity: 2, transparent: true, opacity: 0.85 });
  const blob = mesh(sphere, hot, 0.28, 0.24, 0.28, 0, 0.24, 0);
  pivot.add(blob);
  // Crust plates on its back.
  for (let i = 0; i < 5; i++) {
    const a = i * 2.3;
    const p = mesh(lowSphere, crust, 0.1, 0.04, 0.09, Math.cos(a) * 0.14, 0.4 + (i % 2) * 0.02, Math.sin(a) * 0.12 - 0.05);
    p.rotation.set(Math.sin(a) * 0.5, a, Math.cos(a) * 0.4);
    pivot.add(p);
  }
  eyes(pivot, 0.05, 0.1, 0.3, 0.24);
  const flames: THREE.Mesh[] = [];
  const flameCount = look.level === 2 ? 3 : acc === 3 ? 1 : 0;
  for (let i = 0; i < flameCount; i++) {
    const f = mesh(cone, flame, 0.05, 0.16, 0.05, (i - (flameCount - 1) / 2) * 0.09, 0.52, -0.02);
    f.castShadow = false;
    pivot.add(f);
    flames.push(f);
  }
  if (look.level === 2) {
    for (const side of [-1, 1]) {
      const horn = mesh(cone, crust, 0.04, 0.12, 0.04, side * 0.15, 0.46, 0.05);
      horn.rotation.z = -side * 0.5;
      pivot.add(horn);
    }
  }
  let t = Math.random() * 10;
  let hop = 0;
  return {
    root,
    head: 0.5,
    hover: 0,
    speed: 1.3,
    animate(dt, action, moving) {
      t += dt;
      // Hops while moving or dancing; a slow wobble otherwise.
      const hopping = moving > 0.1 || action === 'dance' || action === 'greet';
      hop = hopping ? (hop + dt * (action === 'dance' ? 3.2 : 2.4)) % 1 : Math.max(0, hop - dt);
      const air = hopping ? Math.sin(hop * Math.PI) : 0;
      const squash = hopping ? (hop < 0.12 || hop > 0.88 ? 0.75 : 1.12) : 1 + Math.sin(t * 2) * 0.04;
      pivot.position.y = air * 0.28;
      pivot.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      hot.emissiveIntensity = 0.8 + 0.3 * Math.sin(t * 3) + (action === 'skill' ? 1.2 : 0);
      flames.forEach((f, i) => {
        f.scale.y = 0.13 + 0.05 * Math.sin(t * 13 + i * 2);
        f.rotation.z = Math.sin(t * 7 + i) * 0.2;
      });
    },
  };
}

/** Rùa Rêu: a slow mossy turtle with a little tree on its shell. */
function turtle(look: Readonly<PetLook>, acc: number): PetBody {
  const [shellC, skinC, leafC, bloomC] = palette(look, [0x6b8a3a, 0x9cc46a, 0x4fae3c, 0xff9ad0]);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const shellMat = std(shellC, { flatShading: true, roughness: 0.85 });
  const skin = std(skinC, { roughness: 0.7 });
  const leaf = std(leafC, { flatShading: true, roughness: 0.8 });
  const bark = std(new THREE.Color(0x7a5534), { roughness: 0.9 });
  const shellGeo = new THREE.SphereGeometry(1, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.scale.set(0.34, 0.24, 0.4);
  shell.position.y = 0.12;
  shell.castShadow = true;
  pivot.add(shell);
  pivot.add(mesh(cylinder, shellMat, 0.35, 0.04, 0.41, 0, 0.12, 0));
  const head = new THREE.Group();
  head.position.set(0, 0.17, 0.4);
  head.add(mesh(sphere, skin, 0.12, 0.1, 0.13));
  eyes(head, 0.032, 0.06, 0.03, 0.1);
  pivot.add(head);
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [[-0.24, 0.24], [0.24, 0.24], [-0.24, -0.24], [0.24, -0.24]]) {
    const leg = mesh(cylinder, skin, 0.07, 0.12, 0.07, x, 0.06, z);
    pivot.add(leg);
    legs.push(leg);
  }
  // The little tree: a trunk and a crown (bigger and in bloom at Level 2).
  const big = look.level === 2;
  pivot.add(mesh(cylinder, bark, 0.025, 0.16, 0.025, 0, 0.42, -0.02));
  const crown = mesh(lowSphere, leaf, big ? 0.2 : 0.13, big ? 0.16 : 0.11, big ? 0.2 : 0.13, 0, big ? 0.6 : 0.54, -0.02);
  pivot.add(crown);
  if (big || acc === 1) {
    const bloom = std(bloomC, { emissive: bloomC, emissiveIntensity: 0.25 });
    for (let i = 0; i < (big ? 6 : 2); i++) {
      const a = i * 2.1;
      pivot.add(mesh(sphere, bloom, 0.035, 0.035, 0.035, Math.cos(a) * 0.15, 0.62 + Math.sin(i) * 0.05, Math.sin(a) * 0.15 - 0.02));
    }
  }
  let t = Math.random() * 10;
  return {
    root,
    head: 0.7,
    hover: 0,
    speed: 0.7,
    animate(dt, action, moving) {
      t += dt;
      const step = t * 6;
      legs.forEach((leg, i) => {
        leg.rotation.x = moving > 0.05 ? Math.sin(step + (i % 2 === 0 ? 0 : Math.PI)) * 0.5 : 0;
      });
      head.position.z = 0.4 + (action === 'greet' || action === 'skill' ? 0.06 : 0) + Math.sin(t * 1.2) * 0.01;
      head.rotation.y = action === 'dance' ? Math.sin(t * 4) * 0.5 : Math.sin(t * 0.5) * 0.25;
      pivot.rotation.z = action === 'dance' ? Math.sin(t * 5) * 0.12 : 0;
      pivot.position.y = action === 'dance' ? Math.abs(Math.sin(t * 5)) * 0.06 : moving > 0.05 ? Math.abs(Math.sin(step)) * 0.015 : 0;
      crown.rotation.y = Math.sin(t * 0.8) * 0.15;
    },
  };
}

/** Cú Trăng: a round owl with big eyes and ear tufts; flaps up to fly when it moves. */
function owl(look: Readonly<PetLook>, acc: number): PetBody {
  const [featherC, faceC, beakC, haloC] = palette(look, [0x6c6a8f, 0xe8e2f2, 0xf2b84a, 0xc8ccff]);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const feather = std(featherC, { roughness: 0.8, flatShading: true });
  const face = std(faceC, { roughness: 0.7 });
  const beak = std(beakC, { roughness: 0.4 });
  pivot.add(mesh(sphere, feather, 0.22, 0.27, 0.2, 0, 0.3, 0));
  pivot.add(mesh(sphere, face, 0.17, 0.15, 0.08, 0, 0.36, 0.13));
  const eyeGroup = new THREE.Group();
  eyeGroup.position.set(0, 0.38, 0.17);
  eyes(eyeGroup, 0.055, 0.07, 0, 0);
  pivot.add(eyeGroup);
  const b = mesh(cone, beak, 0.025, 0.06, 0.025, 0, 0.32, 0.2);
  b.rotation.x = Math.PI;
  pivot.add(b);
  for (const side of [-1, 1]) {
    const tuft = mesh(cone, feather, 0.04, 0.1, 0.04, side * 0.12, 0.55, 0.02);
    tuft.rotation.z = -side * 0.35;
    pivot.add(tuft);
  }
  const wings: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const w = mesh(sphere, feather, 0.06, 0.18, 0.13, side * 0.2, 0.28, -0.02);
    w.userData.side = side;
    pivot.add(w);
    wings.push(w);
  }
  for (const side of [-1, 1]) pivot.add(mesh(lowSphere, beak, 0.04, 0.025, 0.05, side * 0.07, 0.03, 0.06));
  let halo: THREE.Mesh | null = null;
  if (look.level === 2 || acc === 2) {
    const m = std(haloC, { emissive: haloC, emissiveIntensity: 1.2 });
    halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 32), m);
    halo.position.set(0, 0.42, -0.14);
    pivot.add(halo);
  }
  let t = Math.random() * 10;
  let fly = 0;
  return {
    root,
    head: 0.6,
    hover: 0,
    speed: 1.6,
    animate(dt, action, moving) {
      t += dt;
      // Takes off when it moves (or casts), settles when still.
      const up = moving > 0.15 || action === 'skill';
      fly += (up ? 1 : -1) * dt * 2.5;
      fly = Math.min(1, Math.max(0, fly));
      const flap = fly > 0 ? Math.sin(t * 16) : Math.sin(t * 1.5) * 0.1;
      for (const w of wings) w.rotation.z = (w.userData.side as number) * (0.2 + (fly > 0 ? 0.9 * flap : 0.05));
      pivot.position.y = fly * (0.9 + Math.sin(t * 3) * 0.08) + (action === 'dance' ? Math.abs(Math.sin(t * 6)) * 0.1 : 0);
      // The head turns to look about (owls!).
      eyeGroup.rotation.y = action === 'idle' ? Math.sin(t * 0.7) * 0.6 : 0;
      pivot.rotation.z = action === 'dance' ? Math.sin(t * 6) * 0.25 : 0;
      if (halo) halo.rotation.z += dt * 0.8;
    },
  };
}
