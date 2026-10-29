import * as THREE from 'three';
import { createRng } from '../../core/rng';
import type { PetElement } from '../../pets/species';

/** What makes one individual look like itself. */
export interface PetLook {
  seed: number;
  shiny: boolean;
  level: 1 | 2;
}

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
