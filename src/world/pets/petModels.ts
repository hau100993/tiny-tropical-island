import * as THREE from 'three';
import { prepareSkinned, fitToHeight } from '../creatures/glbUtil';
import type { BodyAction, PetBody } from './bodies';
import type { SpeciesId } from '../../pets/species';

/**
 * The egg species' models: src/assets/creatures/pets/<species>-<l1|l2|shiny>.glb (Poly Pizza
 * files, see MODEL_SOURCES in pets/species.ts). Found at build time: a file that isn't there
 * simply isn't offered, and the game falls back (Level 1's model with a new look in code, or a
 * stand-in body). Each loads only when a pet of its kind first appears.
 */
const FILES = import.meta.glob('../../assets/creatures/pets/*.glb', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

export type ModelVariant = 'l1' | 'l2' | 'shiny';

export function hasModel(species: SpeciesId, variant: ModelVariant): boolean {
  return `../../assets/creatures/pets/${species}-${variant}.glb` in FILES;
}

/** How each species stands in the world: height (m), flying height, walking speed. */
const FIT: Readonly<Partial<Record<SpeciesId, { height: number; hover: number; speed: number }>>> = {
  deer: { height: 0.95, hover: 0, speed: 1.8 },
  na: { height: 0.6, hover: 0, speed: 1.1 },
  frog: { height: 0.5, hover: 0, speed: 1.4 },
  tiger: { height: 0.85, hover: 0, speed: 2 },
  bee: { height: 0.5, hover: 1.1, speed: 1.8 },
  cloudDragon: { height: 0.85, hover: 1.3, speed: 2.1 },
  kind7: { height: 0.7, hover: 0, speed: 1.5 },
  kind8: { height: 0.7, hover: 0, speed: 1.5 },
  spider: { height: 0.55, hover: 0, speed: 1.6 },
  kimquy: { height: 0.75, hover: 0, speed: 0.8 },
};

export function fitOf(species: SpeciesId): { height: number; hover: number; speed: number } {
  return FIT[species] ?? { height: 0.7, hover: 0, speed: 1.4 };
}

/**
 * Which clip plays for each action, by name: files name them differently ("Idle", "Walk",
 * "Flying_Idle", "Bite_Front", "Yes"…), so a list of patterns is tried in order.
 */
const CLIP_PATTERNS: Readonly<Record<BodyAction, readonly RegExp[]>> = {
  idle: [/^(.*\|)?idle$/i, /flying_idle|idle/i, /fly/i, /walk/i],
  move: [/walk/i, /run/i, /fast_fly|fly/i, /hop|jump/i, /swim/i],
  skill: [/attack|punch|bite|headbutt|spell|shoot|cast|sting|roar/i, /jump/i],
  greet: [/yes|wave|greet|happy/i, /jump/i, /dance/i],
  dance: [/dance/i, /jump/i, /yes|wave/i],
};

function pickClip(clips: THREE.AnimationClip[], action: BodyAction): THREE.AnimationClip | null {
  for (const re of CLIP_PATTERNS[action]) {
    const c = clips.find((a) => re.test(a.name));
    if (c) return c;
  }
  return null;
}

/** A pet from a .glb: fitted to its height, its clips crossfaded by action; a gentle bob if it has none. */
export async function loadPetModel(species: SpeciesId, variant: ModelVariant): Promise<PetBody> {
  const url = await FILES[`../../assets/creatures/pets/${species}-${variant}.glb`]();
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
  prepareSkinned(scene);
  const fit = fitOf(species);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds are unreliable: never culled (they are small and few).
    mesh.frustumCulled = false;
  });
  const fitted = fitToHeight(scene, fit.height, species);
  // Stand it on its feet, centred.
  const box = new THREE.Box3().setFromObject(fitted);
  fitted.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.add(fitted);
  root.add(pivot);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = new Map<BodyAction, THREE.AnimationAction>();
  for (const a of ['idle', 'move', 'skill', 'greet', 'dance'] as const) {
    const clip = pickClip(gltf.animations, a);
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    act.play();
    act.setEffectiveWeight(a === 'idle' ? 1 : 0);
    actions.set(a, act);
  }
  const weights = new Map<THREE.AnimationAction, number>();
  for (const act of new Set(actions.values())) weights.set(act, act === actions.get('idle') ? 1 : 0);
  let t = Math.random() * 10;
  return {
    root,
    head: fit.height,
    hover: fit.hover,
    speed: fit.speed,
    animate(dt, action, moving) {
      t += dt;
      const want = actions.get(action) ?? actions.get('idle');
      // Crossfade: the wanted clip toward 1, the others toward 0 (normalized).
      let sum = 0;
      for (const [act, w] of weights) {
        const next = w + ((act === want ? 1 : 0) - w) * Math.min(1, dt * 8);
        weights.set(act, next);
        sum += next;
      }
      for (const [act, w] of weights) act.setEffectiveWeight(sum > 0 ? w / sum : 0);
      const walk = actions.get('move');
      if (walk) walk.timeScale = action === 'move' ? 0.6 + moving * 0.8 : 1;
      mixer.update(dt);
      // Without clips (or as a little life on top): a bob, hops when happy.
      const happy = action === 'greet' || action === 'dance';
      pivot.position.y = actions.size === 0 || happy ? Math.abs(Math.sin(t * (happy ? 7 : 2))) * (happy ? 0.12 : 0.03) : 0;
      pivot.rotation.z = actions.size === 0 && happy ? Math.sin(t * 6) * 0.15 : 0;
    },
  };
}
