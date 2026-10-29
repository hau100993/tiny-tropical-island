import * as THREE from 'three';
import type { PetBody } from './bodies';
import type { WildKind } from '../../pets/species';

/** The four egg species that also live wild, each in its own place and time. */
export type VisitorKind = Extract<WildKind, 'frog' | 'bee' | 'spider' | 'deer'>;

export interface VisitorTarget {
  kind: VisitorKind;
  x: number;
  y: number;
  z: number;
  fed(): void;
  join(): void;
}

export interface VisitorHost {
  scene: THREE.Scene;
  heightAt(x: number, z: number): number;
  /** Sand, grass, rock or water under (x, z). */
  surfaceAt(x: number, z: number): string;
  /** Trunks within `r` m (how much forest is around). */
  treesNear(x: number, z: number, r: number): number;
  /** 0 night … 1 full day. */
  daylight(): number;
  /** 0 dry … 1 heavy rain. */
  rain(): number;
  /** Where the house stands (they keep clear of it). */
  house: { x: number; z: number };
  /** Its model (once per kind; reused for every visit). */
  body(kind: VisitorKind): Promise<PetBody>;
  /** Shaders compiled before it first shows. */
  compile(root: THREE.Object3D): Promise<unknown>;
  /** Gone in a puff of sparkles (befriended or startled) at (x, y, z). */
  sparkle(x: number, y: number, z: number): void;
}

interface Habitat {
  /** Is this a place and time for it, around you at (x, z)? */
  here(h: VisitorHost, x: number, z: number): boolean;
  /** Is (x, z) a spot for it to show up on? */
  spot(h: VisitorHost, x: number, z: number): boolean;
  near: number;
  far: number;
  /** Comes nearer than this (m) and it's gone. */
  shy: number;
  /** Hangs this high (spider: from a tree on its thread; bee: flies). */
  lift: number;
}

const HABITATS: Readonly<Record<VisitorKind, Habitat>> = {
  // Ếch Xanh: on wet sand by the sea while it rains.
  frog: {
    here: (h, x, z) => h.rain() > 0.25 && h.heightAt(x, z) < 2.5,
    spot: (h, x, z) => {
      const y = h.heightAt(x, z);
      return y > 0.2 && y < 1 && h.surfaceAt(x, z) === 'sand';
    },
    near: 4,
    far: 9,
    shy: 2.2,
    lift: 0,
  },
  // Ong Vàng: over the open grass on a fine day.
  bee: {
    here: (h, x, z) => h.daylight() > 0.6 && h.rain() < 0.2 && h.surfaceAt(x, z) === 'grass' && h.treesNear(x, z, 8) < 4,
    spot: (h, x, z) => h.surfaceAt(x, z) === 'grass' && h.treesNear(x, z, 4) < 2,
    near: 4,
    far: 9,
    shy: 2,
    lift: 0,
  },
  // Nhện Halloween: in the forest after dark, letting itself down from a tree.
  spider: {
    here: (h, x, z) => h.daylight() < 0.25 && h.treesNear(x, z, 8) >= 6,
    spot: (h, x, z) => h.heightAt(x, z) > 0.5,
    near: 4,
    far: 8,
    shy: 2.5,
    lift: 1.5,
  },
  // Nai Vàng: at the edge of the forest at dawn and dusk; very shy.
  deer: {
    here: (h, x, z) => {
      const d = h.daylight();
      const trees = h.treesNear(x, z, 8);
      return d > 0.12 && d < 0.6 && trees >= 2 && trees <= 7;
    },
    spot: (h, x, z) => h.heightAt(x, z) > 0.8 && h.treesNear(x, z, 3) < 2,
    near: 7,
    far: 12,
    shy: 5,
    lift: 0,
  },
};

const KINDS = Object.keys(HABITATS) as VisitorKind[];
/** One visit lasts (s); between visits (s). */
const STAY = [25, 40] as const;
const GAP = [35, 80] as const;
const FADE = 0.6;

interface Visit {
  kind: VisitorKind;
  body: PetBody;
  x: number;
  z: number;
  y: number;
  t: number;
  stay: number;
  leaving: number;
  happy: number;
  target: VisitorTarget;
  thread: THREE.Line | null;
}

const between = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);

/**
 * Wild Ếch, Ong, Nhện and Nai (Thú Cưng that also live wild): while you walk in the right place
 * at the right time, one now and then shows up a few metres away, watches you, and stays a while;
 * come too close and it's gone. Fed with tomatoes it lingers and, with enough trust, stays as
 * a pet (PetGame). One at a time; models loaded once per kind and reused.
 */
export class WildVisitors {
  private visit: Visit | null = null;
  private gap = between([8, 20]);
  private readonly bodies = new Map<VisitorKind, PetBody>();
  private readonly loading = new Set<VisitorKind>();

  constructor(private readonly host: VisitorHost) {}

  /** The one out watching you (it can be fed), appended to `out`. */
  watchers(out: VisitorTarget[]): void {
    const v = this.visit;
    if (!v || v.leaving > 0 || v.t < FADE) return;
    v.target.x = v.x;
    v.target.y = v.y + v.body.head * v.body.root.scale.y + 0.15;
    v.target.z = v.z;
    out.push(v.target);
  }

  /** `you`: where you walk (feet), or null. */
  update(dt: number, you: { x: number; z: number } | null): void {
    const h = this.host;
    if (!this.visit && you) {
      this.gap -= dt;
      if (this.gap <= 0) {
        this.gap = 4;
        const kinds = KINDS.filter((k) => HABITATS[k].here(h, you.x, you.z));
        if (kinds.length > 0) this.start(kinds[Math.floor(Math.random() * kinds.length)], you);
      }
    }
    const v = this.visit;
    if (!v) return;
    v.t += dt;
    v.happy = Math.max(0, v.happy - dt);
    const hab = HABITATS[v.kind];
    const d = you ? Math.hypot(you.x - v.x, you.z - v.z) : Infinity;
    if (v.leaving === 0 && (!you || d < hab.shy || v.t > v.stay || !hab.here(h, you.x, you.z))) {
      v.leaving = 1e-3;
      if (you && d < hab.shy) h.sparkle(v.x, v.y + 0.3, v.z);
    }
    const root = v.body.root;
    let scale = Math.min(1, v.t / FADE);
    if (v.leaving > 0) {
      v.leaving += dt;
      scale = Math.max(0, 1 - v.leaving / FADE);
      if (scale <= 0) {
        this.end();
        return;
      }
    }
    if (you) root.rotation.y = Math.atan2(you.x - v.x, you.z - v.z);
    // The spider lets itself down on its thread, bobbing on it.
    const ground = h.heightAt(v.x, v.z);
    v.y = ground + hab.lift + (v.kind === 'spider' ? Math.sin(v.t * 1.3) * 0.15 : 0);
    root.position.set(v.x, v.y, v.z);
    root.scale.setScalar(Math.max(0.001, scale * ((root.userData.baseScale as number | undefined) ?? 1)));
    v.body.animate(dt, v.happy > 0 ? 'dance' : v.t < 1.2 ? 'greet' : 'idle', 0, 0);
    if (v.thread) {
      const pos = v.thread.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, v.x, ground + 6, v.z);
      pos.setXYZ(1, v.x, v.y + v.body.head * 0.8, v.z);
      pos.needsUpdate = true;
    }
  }

  private start(kind: VisitorKind, you: { x: number; z: number }): void {
    const body = this.bodies.get(kind);
    if (!body) {
      this.load(kind);
      return;
    }
    const hab = HABITATS[kind];
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = hab.near + Math.random() * (hab.far - hab.near);
      const x = you.x + Math.cos(a) * r;
      const z = you.z + Math.sin(a) * r;
      if (!hab.spot(this.host, x, z) || Math.hypot(x - this.host.house.x, z - this.host.house.z) < 7) continue;
      const v: Visit = {
        kind,
        body,
        x,
        z,
        y: this.host.heightAt(x, z),
        t: 0,
        stay: between(STAY),
        leaving: 0,
        happy: 0,
        thread: null,
        target: {
          kind,
          x,
          y: 0,
          z,
          fed: () => {
            if (this.visit !== v) return;
            v.happy = 1.5;
            v.stay = Math.max(v.stay, v.t + 10);
          },
          join: () => {
            if (this.visit !== v) return;
            this.host.sparkle(v.x, v.y + 0.3, v.z);
            v.leaving = 1e-3;
          },
        },
      };
      if (kind === 'spider') {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        v.thread = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.6 }));
        this.host.scene.add(v.thread);
      }
      body.root.visible = true;
      this.visit = v;
      return;
    }
  }

  private end(): void {
    const v = this.visit;
    if (!v) return;
    v.body.root.visible = false;
    if (v.thread) {
      this.host.scene.remove(v.thread);
      v.thread.geometry.dispose();
      (v.thread.material as THREE.Material).dispose();
    }
    this.visit = null;
    this.gap = between(GAP);
  }

  private load(kind: VisitorKind): void {
    if (this.loading.has(kind)) return;
    this.loading.add(kind);
    this.host
      .body(kind)
      .then(async (body) => {
        await this.host.compile(body.root);
        body.root.visible = false;
        this.host.scene.add(body.root);
        this.bodies.set(kind, body);
      })
      .catch((err: unknown) => console.warn('wild visitor failed', err))
      .finally(() => this.loading.delete(kind));
  }
}
