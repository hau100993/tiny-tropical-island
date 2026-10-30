import * as THREE from 'three';
import { createRng } from '../../core/rng';
import { sharedUniforms } from '../../core/uniforms';
import type { PetElement } from '../../pets/species';

/** What makes one individual look like itself. */
export interface PetLook {
  seed: number;
  shiny: boolean;
  level: 1 | 2;
  /** Its species' colours for this model file (PAINT), by material name. */
  paint?: Readonly<Record<string, Paint>>;
}

/** A material's new colour (sRGB hex), and a faint glow of that colour (0..1) if any. */
export interface Paint {
  color: number;
  glow?: number;
}

/**
 * Species colours over the model files' own (keyed `<species>-<l1|l2>`, then by material
 * name): the island is mostly green and sand, so each wears its name and element clearly. A
 * frog brighter than the grass, a yellow bee with black bands, an orange tiger, a golden deer
 * and turtle, a pale moon dragon, a fire-red Thú Hiếm, a pumpkin-marked spider. Files not
 * listed (Bé Na, Cá Ngựa, the textured ones) keep their colours.
 */
export const PAINT: Readonly<Record<string, Readonly<Record<string, Paint>>>> = {
  'frog-l1': { Green: { color: 0x7fdc4a }, Yellow: { color: 0xffd447 } },
  'bee-l1': { Armabee_Main: { color: 0xf7c51e }, Armabee_Secondary: { color: 0x1e1a14 }, Wings: { color: 0xe6f2ff } },
  'tiger-l1': { Cat_Main: { color: 0xf08a24 }, Cat_Secondary: { color: 0x2b1d14 } },
  'deer-l1': { Main: { color: 0xd9a441 }, Main_Light: { color: 0xf6e7c4 }, Main_Dark: { color: 0xa8742f }, Eye_Lighter: { color: 0xe0b060 } },
  'deer-l2': { Material: { color: 0xd4a03c }, 'Material.003': { color: 0xf6e7c4 } },
  'kimquy-l1': { lambert2SG: { color: 0xb8860b }, lambert6SG: { color: 0xffd34d, glow: 0.15 } },
  'cloudDragon-l1': { Squidle_Main: { color: 0xb8c4ff }, Squidle_Secondary: { color: 0xf4f6ff } },
  'cloudDragon-l2': { Demon_Main: { color: 0x8f9cff } },
  'kind8-l1': { Monkroose_Main: { color: 0xe8603a }, Monkroose_Secondary: { color: 0xffd9a0 }, Monkroose_Ears: { color: 0x7a2e1a } },
  'spider-l1': { Material: { color: 0x2a2233 }, 'Material.001': { color: 0xff7a1a, glow: 0.35 } },
};

/**
 * Rim light: a thin bright edge where the surface turns away from the view, so a pet stands out
 * from the grass whatever its colour. In the fragment shader, 1 − dot(normal, toCamera) is 0
 * facing you and 1 at the silhouette; cubed, it is only the edge. Added to the emitted light,
 * fainter at night.
 */
const RIM_COLOR = new THREE.Color(0xfff4dc);
const RIM_STRENGTH = 0.35;

/** The element's colour (auras, glows). */
export const ELEMENT_COLOR: Readonly<Record<PetElement, number>> = {
  water: 0x48c4ff,
  fire: 0xff7a2a,
  grass: 0x6ee05a,
  spark: 0xffd84a,
  moon: 0xb6b8ff,
};

const SHINY_GOLD = new THREE.Color(0xffd36a);

/** Size (×) and hue shift (turns) from the seed: every individual a little different. */
export function seededVariation(seed: number): { size: number; hue: number; accessory: number } {
  const rng = createRng(seed);
  return { size: 0.9 + rng() * 0.2, hue: (rng() - 0.5) * 0.08, accessory: Math.floor(rng() * 4) };
}

/**
 * Gives a model its own materials (clones, so tinting one copy leaves the others alone), then
 * shifts their hue a little; shiny ones go golden and shimmer. Run once per model.
 */
export function tintModel(root: THREE.Object3D, look: Readonly<PetLook>): void {
  const v = seededVariation(look.seed);
  const hsl = { h: 0, s: 0, l: 0 };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m) => {
      const c = m.clone() as THREE.MeshStandardMaterial;
      const paint = look.paint?.[m.name];
      if (paint && c.color) {
        c.color.set(paint.color);
        if (paint.glow && c.emissive) c.emissive.set(paint.color).multiplyScalar(paint.glow);
      }
      addRim(c);
      if (c.color) {
        c.color.getHSL(hsl);
        // Near-white and near-black parts (eyes, teeth) keep their colour.
        if (hsl.s > 0.12 && hsl.l > 0.08 && hsl.l < 0.92) {
          c.color.setHSL((hsl.h + v.hue + 1) % 1, hsl.s, hsl.l);
          if (look.shiny) {
            c.color.lerp(SHINY_GOLD, 0.55);
            if (c.emissive) c.emissive.copy(SHINY_GOLD).multiplyScalar(0.12);
            if ('metalness' in c) c.metalness = 0.35;
          }
        }
      }
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
}

/** Gives a standard material the rim light (see RIM_COLOR): a few lines in its fragment shader. */
function addRim(m: THREE.MeshStandardMaterial): void {
  if (!(m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial) return;
  // On top of any patch it already has (the world's wetness and snow on some models).
  const before = m.onBeforeCompile.bind(m);
  const beforeKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uRimColor = { value: RIM_COLOR };
    // Own names: a world patch underneath may declare uDayLight already.
    shader.uniforms.uPetDay = sharedUniforms.uDayLight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uPetDay;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // vViewPosition is minus the view-space position: from the point toward the camera.
          float facing = saturate(dot(normal, normalize(vViewPosition)));
          float rim = pow(1.0 - facing, 3.0);
          totalEmissiveRadiance += uRimColor * rim * ${RIM_STRENGTH.toFixed(2)} * (0.35 + 0.65 * uPetDay);
        }`,
      );
  };
  // The same shader program for every pet material with the rim (not one per closure).
  m.customProgramCacheKey = () => `${beforeKey()}|pet-rim`;
}

/**
 * Level 2 on any model: bigger (×1.18 on its own scale), its materials glow faintly in the
 * element's colour, and a slowly turning ring of light lies at its feet. Returns the ring so the
 * caller can spin it (`spinAura`). Idempotent: a second call returns the existing ring.
 */
export function applyLevel2(root: THREE.Object3D, element: PetElement, radius: number): THREE.Mesh {
  const existing = root.getObjectByName('pet-aura') as THREE.Mesh | undefined;
  if (existing) return existing;
  const base = (root.userData.baseScale as number | undefined) ?? root.scale.x;
  root.userData.baseScale = base;
  root.scale.setScalar(base * 1.18);
  const color = new THREE.Color(ELEMENT_COLOR[element]);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name === 'pet-aura') return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const s = m as THREE.MeshStandardMaterial;
      if (s.emissive && s.emissive.getHex() === 0) s.emissive.copy(color).multiplyScalar(0.08);
    }
  });
  const ring = new THREE.Mesh(auraGeometry(), auraMaterial(color));
  ring.name = 'pet-aura';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  // In the model's own units (the root is scaled).
  ring.scale.setScalar(radius / (base * 1.18));
  ring.renderOrder = 2;
  root.add(ring);
  return ring;
}

export function spinAura(ring: THREE.Object3D | null, dt: number): void {
  if (ring) ring.rotation.z += dt * 0.6;
}

let auraGeo: THREE.BufferGeometry | null = null;

/** A thin ring with three gaps (a magic circle), radius 1. */
function auraGeometry(): THREE.BufferGeometry {
  auraGeo ??= new THREE.RingGeometry(0.82, 1, 48, 1, 0, Math.PI * 2);
  return auraGeo;
}

function auraMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    // Three arcs (gaps every 120°), brightest in the middle of the band.
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vP;
      void main() {
        float a = atan(vP.y, vP.x);
        float arcs = smoothstep(0.15, 0.35, abs(sin(a * 1.5)));
        float r = length(vP);
        float band = 1.0 - abs(r - 0.91) / 0.09;
        gl_FragColor = vec4(uColor * band * arcs * 0.9, 1.0);
      }
    `,
  });
}
