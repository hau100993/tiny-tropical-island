import * as THREE from 'three';
import { seededVariation, type PetLook } from './looks';
import { SPECIES, type SpeciesId } from '../../pets/species';

/** What a pet is doing, for its animation. */
export type BodyAction = 'idle' | 'move' | 'greet' | 'dance' | 'skill';

/**
 * A pet's model and its animation, whatever made it (a loaded .glb, or the stand-in below).
 * Units: metres; the root stands on the ground at its origin.
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
const blush = new THREE.MeshStandardMaterial({ color: 0xff8fa8, roughness: 0.6, transparent: true, opacity: 0.7 });
const sphere = new THREE.SphereGeometry(1, 20, 14);
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
    const white = mesh(sphere, eyeWhite, size, size * 1.15, size * 0.7, side * gap, y, z);
    const pupil = mesh(sphere, eyeBlack, size * 0.72, size * 0.82, size * 0.5, 0, -0.05, 0.45);
    pupil.add(mesh(sphere, eyeWhite, 0.25, 0.25, 0.2, 0.25, 0.3, 0.45));
    white.add(pupil);
    white.castShadow = false;
    parent.add(white);
  }
}

/** The species' emoji on a little sprite (a stand-in has to say what it is). */
function emojiSprite(emoji: string): THREE.Sprite {
  // (No DOM in the unit tests: a blank sprite.)
  if (typeof document === 'undefined') return new THREE.Sprite();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  if (g) {
    g.font = '48px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, 32, 36);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.setScalar(0.22);
  return s;
}

/**
 * Until a species' model file is there: a round, soft, big-eyed little body in its colour with
 * blushing cheeks and its emoji floating over it; it bounces when it moves and hops when happy.
 */
export function standInBody(species: SpeciesId, look: Readonly<PetLook>): PetBody {
  const sp = SPECIES[species];
  const v = seededVariation(look.seed);
  const color = new THREE.Color(sp.color);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL((hsl.h + v.hue + 1) % 1, hsl.s, hsl.l);
  if (look.shiny) color.lerp(new THREE.Color(0xffd36a), 0.55);
  const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: look.shiny ? 0.3 : 0 });
  const root = new THREE.Group();
  // Coloured here already: the game doesn't tint it again.
  root.userData.standIn = true;
  const pivot = new THREE.Group();
  root.add(pivot);
  pivot.add(mesh(sphere, skin, 0.26, 0.24, 0.24, 0, 0.25, 0));
  for (const side of [-1, 1]) {
    pivot.add(mesh(sphere, skin, 0.07, 0.05, 0.07, side * 0.15, 0.04, 0.06));
    const ear = mesh(cone, skin, 0.06, 0.12, 0.06, side * 0.13, 0.47, 0);
    ear.rotation.z = -side * 0.4;
    pivot.add(ear);
    const cheek = mesh(sphere, blush, 0.045, 0.03, 0.02, side * 0.15, 0.22, 0.21);
    cheek.castShadow = false;
    pivot.add(cheek);
  }
  eyes(pivot, 0.055, 0.09, 0.3, 0.2);
  const tag = emojiSprite(sp.emoji);
  tag.position.set(0, 0.68, 0);
  pivot.add(tag);
  const hover = species === 'bee' || species === 'cloudDragon' ? 1 : 0;
  let t = Math.random() * 10;
  let hop = 0;
  return {
    root,
    head: 0.5,
    hover,
    speed: 1.4,
    animate(dt, action, moving) {
      t += dt;
      const hopping = moving > 0.1 || action === 'dance' || action === 'greet';
      hop = hopping ? (hop + dt * (action === 'dance' ? 3 : 2.3)) % 1 : 0;
      const air = hopping ? Math.sin(hop * Math.PI) : 0;
      const squash = hopping ? (hop < 0.1 || hop > 0.9 ? 0.85 : 1.06) : 1 + Math.sin(t * 2) * 0.03;
      pivot.position.y = air * 0.2 + (hover > 0 ? Math.sin(t * 2) * 0.06 : 0);
      pivot.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
      pivot.rotation.z = action === 'dance' ? Math.sin(t * 7) * 0.25 : 0;
      skin.emissive.setHex(action === 'skill' ? sp.color : 0x000000).multiplyScalar(0.4);
      tag.position.y = 0.68 + Math.sin(t * 1.5) * 0.02;
    },
  };
}

/** Little things worn on top: Level 2 without its own model, and a bow for the girls. */
export type Accessory = 'bow' | 'flowers' | 'leafCrown' | 'crown' | 'flames' | 'pumpkin' | 'sword' | 'sunCrown';

/** Each species' Level 2 accessory when it has no Level 2 model of its own. */
export const LEVEL2_ACCESSORY: Readonly<Partial<Record<SpeciesId, Accessory>>> = {
  deer: 'flowers',
  na: 'leafCrown',
  frog: 'crown',
  tiger: 'flames',
  bee: 'crown',
  cloudDragon: 'sunCrown',
  kind7: 'crown',
  kind8: 'sunCrown',
  spider: 'pumpkin',
  kimquy: 'sword',
};

/**
 * Puts an accessory on a pet: `top` is the height of the head (in the root's own units), `back`
 * how far behind the middle its back is (for things carried on the back). Unscaled by the root:
 * the accessory is sized for a pet about half a metre tall and scales with it.
 */
export function addAccessory(root: THREE.Object3D, kind: Accessory, top: number, back = 0.12): void {
  const g = new THREE.Group();
  g.name = `acc-${kind}`;
  const m = (hex: number, glow = 0): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: hex, roughness: 0.4, emissive: hex, emissiveIntensity: glow });
  switch (kind) {
    case 'bow': {
      const pink = m(0xff6fa8, 0.1);
      const left = mesh(cone, pink, 0.05, 0.07, 0.03, -0.04, 0, 0);
      left.rotation.z = Math.PI / 2;
      const right = mesh(cone, pink, 0.05, 0.07, 0.03, 0.04, 0, 0);
      right.rotation.z = -Math.PI / 2;
      g.add(left, right, mesh(sphere, pink, 0.022, 0.022, 0.022));
      g.position.set(0.08, top - 0.02, 0.02);
      g.rotation.z = -0.3;
      break;
    }
    case 'flowers': {
      const colors = [0xff9ad0, 0xffffff, 0xffd34d];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        g.add(mesh(sphere, m(colors[i % 3], 0.2), 0.03, 0.03, 0.03, Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1));
      }
      g.position.y = top;
      break;
    }
    case 'leafCrown': {
      const leaf = m(0x4fae3c, 0.05);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const l = mesh(cone, leaf, 0.03, 0.09, 0.015, Math.cos(a) * 0.08, 0.03, Math.sin(a) * 0.08);
        l.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
        g.add(l);
      }
      g.position.y = top;
      break;
    }
    case 'crown':
    case 'sunCrown': {
      const gold = m(kind === 'crown' ? 0xffcf3a : 0xffa020, kind === 'crown' ? 0.25 : 0.9);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 20), gold);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(cone, gold, 0.018, 0.06, 0.018, Math.cos(a) * 0.075, 0.03, Math.sin(a) * 0.075));
      }
      g.position.y = top;
      break;
    }
    case 'flames': {
      const fire = m(0xff7a1a, 1.6);
      for (let i = 0; i < 3; i++) g.add(mesh(cone, fire, 0.04, 0.14, 0.04, 0, 0.06, -i * 0.09));
      g.position.set(0, top - 0.08, -back * 0.3);
      break;
    }
    case 'pumpkin': {
      const orange = m(0xff8a1a, 0.5);
      g.add(mesh(sphere, orange, 0.11, 0.08, 0.11), mesh(cone, m(0x3f7a2a), 0.015, 0.05, 0.015, 0, 0.09, 0));
      g.position.set(0, top - 0.05, -back);
      break;
    }
    case 'sword': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.36, 0.008), m(0xbfe8ff, 1.2));
      blade.position.y = 0.18;
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), m(0xe0b83a, 0.3));
      g.add(blade, guard);
      g.position.set(0, top - 0.1, -back);
      g.rotation.z = 0.5;
      break;
    }
  }
  root.add(g);
}
