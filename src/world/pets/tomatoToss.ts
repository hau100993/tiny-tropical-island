import * as THREE from 'three';

/** Tomatoes in the air at once (a fixed pool). */
const POOL = 6;
/** Flight time (s) for a short toss; longer ones add a little per metre. */
const BASE_TIME = 0.42;
const PER_METRE = 0.035;

interface Flight {
  mesh: THREE.Group;
  t: number;
  time: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  arc: number;
  land: (() => void) | null;
}

/**
 * A tomato thrown from you to a pet: a small red ball with a green star of sepals, flying a
 * parabola (higher for longer throws) and spinning. Its landing runs a callback (hearts, EXP).
 * A pool of six meshes sharing one geometry and two materials; hidden when idle.
 */
export class TomatoToss {
  readonly group = new THREE.Group();
  private readonly flights: Flight[] = [];

  constructor() {
    const fruit = new THREE.SphereGeometry(0.085, 14, 10);
    fruit.scale(1, 0.86, 1);
    const cap = new THREE.ConeGeometry(0.06, 0.035, 5, 1);
    cap.translate(0, 0.08, 0);
    const red = new THREE.MeshStandardMaterial({ color: 0xe8342a, roughness: 0.35, metalness: 0 });
    const green = new THREE.MeshStandardMaterial({ color: 0x3f9b2f, roughness: 0.7, flatShading: true });
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(fruit, red), new THREE.Mesh(cap, green));
      mesh.visible = false;
      this.group.add(mesh);
      this.flights.push({ mesh, t: 0, time: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), arc: 0, land: null });
    }
  }

  /** Throws one; `land` runs when it arrives. False if all six are in the air. */
  toss(from: THREE.Vector3, to: THREE.Vector3, land: () => void): boolean {
    const f = this.flights.find((x) => !x.mesh.visible);
    if (!f) return false;
    const dist = from.distanceTo(to);
    f.from.copy(from);
    f.to.copy(to);
    f.t = 0;
    f.time = BASE_TIME + dist * PER_METRE;
    f.arc = 0.35 + dist * 0.12;
    f.land = land;
    f.mesh.visible = true;
    f.mesh.position.copy(from);
    return true;
  }

  update(dt: number): void {
    for (const f of this.flights) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const k = Math.min(1, f.t / f.time);
      f.mesh.position.lerpVectors(f.from, f.to, k);
      f.mesh.position.y += 4 * f.arc * k * (1 - k);
      f.mesh.rotation.x += dt * 9;
      f.mesh.rotation.z += dt * 5;
      if (k >= 1) {
        f.mesh.visible = false;
        const land = f.land;
        f.land = null;
        land?.();
      }
    }
  }
}
