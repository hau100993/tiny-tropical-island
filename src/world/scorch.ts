import * as THREE from 'three';

/** Soot: how dark a scorched surface gets (its colour × this), and the time to darken (s). */
const SOOT = 0.12;
const DARKEN = 0.12;

interface Burnt {
  root: THREE.Object3D;
  /** s since struck, and how long until it is clean again. */
  age: number;
  time: number;
  /** Each material once, with its own colour (and emissive) from before. */
  mats: { m: THREE.Material & { color: THREE.Color }; color: THREE.Color; emissive: THREE.Color | null }[];
}

/**
 * Scorched by lightning for a few seconds (Mochi's "Lightning Strike"): every material under a
 * character or a creature goes nearly black at once, glowing a dull ember red for a moment,
 * then its colour comes back over the last half of the time. The colours are kept and put back
 * exactly; a second strike on the same thing starts its clock again.
 */
export class Scorcher {
  private readonly burnt: Burnt[] = [];

  burn(root: THREE.Object3D, time: number): void {
    const had = this.burnt.find((b) => b.root === root);
    if (had) {
      had.age = 0;
      had.time = time;
      return;
    }
    const mats: Burnt['mats'] = [];
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        if (seen.has(m) || !('color' in m) || !(m.color instanceof THREE.Color)) continue;
        seen.add(m);
        const withColor = m as THREE.Material & { color: THREE.Color; emissive?: THREE.Color };
        mats.push({ m: withColor, color: withColor.color.clone(), emissive: withColor.emissive instanceof THREE.Color ? withColor.emissive.clone() : null });
      }
    });
    this.burnt.push({ root, age: 0, time, mats });
  }

  /** How scorched it is now: 1 black … 0 clean. */
  private level(b: Burnt): number {
    const t = b.age / b.time;
    return t < DARKEN / b.time ? t / (DARKEN / b.time) : t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / 0.5);
  }

  update(dt: number): void {
    for (let i = this.burnt.length - 1; i >= 0; i--) {
      const b = this.burnt[i];
      b.age += dt;
      const k = this.level(b);
      // A dull red glow in the first moment, like embers in the soot.
      const ember = Math.max(0, 1 - b.age / 0.4) * 0.2;
      for (const { m, color, emissive } of b.mats) {
        m.color.copy(color).multiplyScalar(1 - (1 - SOOT) * k);
        const e = (m as THREE.Material & { emissive?: THREE.Color }).emissive;
        if (e && emissive) e.copy(emissive).lerp(EMBER, ember * k);
      }
      if (b.age >= b.time) {
        for (const { m, color, emissive } of b.mats) {
          m.color.copy(color);
          const e = (m as THREE.Material & { emissive?: THREE.Color }).emissive;
          if (e && emissive) e.copy(emissive);
        }
        this.burnt.splice(i, 1);
      }
    }
  }
}

const EMBER = new THREE.Color(0.9, 0.25, 0.05);
