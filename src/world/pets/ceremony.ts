import * as THREE from 'three';
import type { SkillFxSink } from '../creatures/skillFx';
import type { EmberSink } from '../creatures/embers';

/** Hatching: the egg wobbles harder and harder (s), then bursts. */
const WOBBLE = 2.2;
/** Evolving: light gathers round it (s), then the flash. */
const GATHER = 1.8;

interface Show {
  kind: 'hatch' | 'evolve';
  t: number;
  x: number;
  y: number;
  z: number;
  color: number;
  shiny: boolean;
  done: () => void;
  fired: boolean;
}

/**
 * The two big moments: an egg hatching (it appears, wobbles, cracks open in a flash and a burst
 * of rainbow motes, and the new pet is there) and a pet evolving (rainbow light spirals in, a
 * white flash and a shock wave, and it stands there at Level 2). `done` runs at the burst, where
 * the game swaps in the new model.
 */
export class Ceremonies {
  readonly group = new THREE.Group();
  private readonly egg: THREE.Mesh;
  private readonly shows: Show[] = [];

  constructor(
    private readonly fx: SkillFxSink,
    private readonly rainbow: EmberSink,
  ) {
    const geo = new THREE.SphereGeometry(0.22, 20, 14);
    geo.scale(1, 1.3, 1);
    geo.translate(0, 0.28, 0);
    // Cream with soft green spots (vertex colours: no texture).
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const spot = Math.sin(v.x * 31) * Math.sin(v.y * 23 + 1) * Math.sin(v.z * 27 + 2) > 0.35;
      colors.set(spot ? [0.55, 0.85, 0.6] : [1, 0.97, 0.88], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.egg = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }));
    this.egg.castShadow = true;
    this.egg.visible = false;
    this.group.add(this.egg);
  }

  get busy(): boolean {
    return this.shows.length > 0;
  }

  hatch(x: number, y: number, z: number, color: number, shiny: boolean, done: () => void): void {
    this.shows.push({ kind: 'hatch', t: 0, x, y, z, color, shiny, done, fired: false });
    this.fx.focus(x, y + 0.5, z, WOBBLE + 1);
  }

  evolve(x: number, y: number, z: number, color: number, done: () => void): void {
    this.shows.push({ kind: 'evolve', t: 0, x, y, z, color, shiny: false, done, fired: false });
    this.fx.focus(x, y + 0.5, z, GATHER + 1);
    this.fx.sound('charge', 0.8, x, y, z);
  }

  update(dt: number): void {
    for (let i = this.shows.length - 1; i >= 0; i--) {
      const s = this.shows[i];
      s.t += dt;
      if (s.kind === 'hatch') this.stepHatch(s);
      else this.stepEvolve(s, dt);
      if (s.t > (s.kind === 'hatch' ? WOBBLE : GATHER) + 1.2) this.shows.splice(i, 1);
    }
    this.egg.visible = this.shows.some((s) => s.kind === 'hatch' && !s.fired);
  }

  private stepHatch(s: Show): void {
    if (!s.fired) {
      const k = s.t / WOBBLE;
      this.egg.position.set(s.x, s.y, s.z);
      // Rocks harder as it nears the end, with little hops.
      this.egg.rotation.z = Math.sin(s.t * (8 + k * 20)) * 0.25 * k;
      this.egg.position.y = s.y + Math.max(0, Math.sin(s.t * 9)) * 0.05 * k;
      this.egg.scale.setScalar(Math.min(1, s.t * 4));
      if (Math.random() < k * 0.5) this.rainbow.emit(s.x, s.y + 0.4, s.z, (Math.random() - 0.5) * 0.8, 0.6, (Math.random() - 0.5) * 0.8, 0.03);
      if (s.t >= WOBBLE) this.burst(s, 1);
    }
  }

  private stepEvolve(s: Show, dt: number): void {
    if (!s.fired) {
      // Rainbow light spiralling in.
      const k = s.t / GATHER;
      for (let i = 0; i < Math.ceil(120 * dt * (0.5 + k)); i++) {
        const a = s.t * 5 + Math.random() * Math.PI * 2;
        const r = 2.2 * (1 - k) + 0.4;
        const h = Math.random() * 1.8;
        const px = s.x + Math.cos(a) * r;
        const pz = s.z + Math.sin(a) * r;
        this.rainbow.emit(px, s.y + h, pz, (s.x - px) * 1.4 - Math.sin(a) * 2, 0.3, (s.z - pz) * 1.4 + Math.cos(a) * 2, 0.04, Math.random() * 0.8);
      }
      if (s.t >= GATHER) this.burst(s, 1.3);
    }
  }

  private burst(s: Show, size: number): void {
    s.fired = true;
    this.fx.flash(s.x, s.y + 0.6, s.z, 0xffffff, 120 * size, 8, 0.5);
    this.fx.shock(s.x, s.y, s.z, 'energy', s.color, 4 * size, 0.6, 1.2);
    this.fx.shake(s.x, s.y, s.z, 0.3, 0.35);
    this.fx.sound(s.kind === 'hatch' ? 'boom' : 'thunder', 0.6, s.x, s.y, s.z);
    const n = s.shiny ? 220 : 120;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - c * c);
      const v = 1.2 + Math.random() * 3;
      // Shiny: mostly gold.
      const hue = s.shiny && Math.random() < 0.7 ? 0.12 + Math.random() * 0.04 : Math.random() * 0.8;
      this.rainbow.emit(s.x, s.y + 0.5, s.z, Math.cos(a) * r * v, Math.abs(c) * v + 0.6, Math.sin(a) * r * v, 0.04 + Math.random() * 0.05, hue);
    }
    s.done();
  }
}
