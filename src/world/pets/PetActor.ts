import * as THREE from 'three';
import type { BodyAction, PetBody } from './bodies';

/** Following you: they keep about this far, each at its own place round you (m). */
const FOLLOW_GAP = 2.4;
/** You further away than this from a pet (m): it stays at the camp. */
const FOLLOW_RANGE = 22;
/** Wandering about the camp, within this radius (m). */
const CAMP_R = 5;
/** Ground lower than this (m) is sea: walkers never go there. */
const WATER = 0.15;

export interface ActorWorld {
  heightAt(x: number, z: number): number;
}

/**
 * A new pet on the island (hatched or befriended): wanders about the camp, follows you while you
 * walk nearby (each at its own place round you), turns to face where it goes, cheers when fed
 * and plays its skill animation while a skill runs. Flyers and floaters keep their height over
 * the ground (and may cross a little water); walkers stay on land.
 */
export class PetActor {
  x: number;
  z: number;
  y = 0;
  yaw = Math.random() * Math.PI * 2;
  /** Live position for skills (read while they run). */
  readonly caster = { x: 0, y: 0, z: 0, yaw: 0 };
  private tx: number;
  private tz: number;
  private wanderIn = 0;
  private moving = 0;
  private cheerLeft = 0;
  private castLeft = 0;
  private time = Math.random() * 10;

  constructor(
    readonly petId: string,
    public body: PetBody,
    private readonly world: ActorWorld,
    private readonly camp: { x: number; z: number },
    /** Its place in the line round you (0..4). */
    public slot: number,
    start: { x: number; z: number },
  ) {
    this.x = this.tx = start.x;
    this.z = this.tz = start.z;
    this.y = this.groundY(start.x, start.z);
    body.root.position.set(this.x, this.y, this.z);
  }

  /** Swaps the model (Level 2, a new look): same place and heading. */
  setBody(body: PetBody): void {
    this.body = body;
    body.root.position.set(this.x, this.y, this.z);
    body.root.rotation.y = this.yaw;
  }

  /** Top of the head (world). */
  headTop(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.x, this.y + this.body.head * this.body.root.scale.y + this.bob(), this.z);
  }

  /** Fed or petted: a happy little dance. */
  cheer(): void {
    this.cheerLeft = 1.6;
  }

  /** A skill is running for `seconds`: its cast pose meanwhile. */
  casting(seconds: number): void {
    this.castLeft = seconds;
  }

  get busy(): boolean {
    return this.castLeft > 0;
  }

  /** `you`: where you walk (feet), or null. */
  update(dt: number, you: { x: number; z: number } | null, wind: number): void {
    this.time += dt;
    this.cheerLeft = Math.max(0, this.cheerLeft - dt);
    this.castLeft = Math.max(0, this.castLeft - dt);
    const follow = you !== null && Math.hypot(you.x - this.x, you.z - this.z) < FOLLOW_RANGE;
    if (follow && you) {
      // Its own place round you: a fan behind and beside.
      const a = Math.atan2(this.x - you.x, this.z - you.z) * 0.3 + (this.slot - 2) * 0.9;
      this.tx = you.x + Math.sin(a) * FOLLOW_GAP;
      this.tz = you.z + Math.cos(a) * FOLLOW_GAP;
    } else {
      this.wanderIn -= dt;
      if (this.wanderIn <= 0) {
        this.wanderIn = 4 + Math.random() * 5;
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * CAMP_R;
          const x = this.camp.x + Math.cos(a) * r;
          const z = this.camp.z + Math.sin(a) * r;
          if (this.body.hover > 0 || this.world.heightAt(x, z) > WATER) {
            this.tx = x;
            this.tz = z;
            break;
          }
        }
      }
    }
    const dx = this.tx - this.x;
    const dz = this.tz - this.z;
    const dist = Math.hypot(dx, dz);
    const still = this.castLeft > 0 || this.cheerLeft > 0;
    const want = !still && dist > (follow ? 0.6 : 0.3) ? Math.min(1, dist / 1.5) : 0;
    this.moving += (want - this.moving) * Math.min(1, dt * 5);
    if (this.moving > 0.02 && dist > 1e-3) {
      // Hurries when far behind.
      const speed = this.body.speed * (dist > 6 ? 1.8 : 1) * this.moving;
      const step = Math.min(dist, speed * dt);
      const nx = this.x + (dx / dist) * step;
      const nz = this.z + (dz / dist) * step;
      // Walkers stop at the water's edge.
      if (this.body.hover > 0 || this.world.heightAt(nx, nz) > WATER) {
        this.x = nx;
        this.z = nz;
      } else {
        this.tx = this.x;
        this.tz = this.z;
      }
      const yaw = Math.atan2(dx, dz);
      let d = yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 6);
    } else if (follow && you) {
      // Waiting: faces you.
      const yaw = Math.atan2(you.x - this.x, you.z - this.z);
      let d = yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 2);
    }
    const ground = this.groundY(this.x, this.z);
    this.y += (ground - this.y) * Math.min(1, dt * 8);
    const action: BodyAction = this.castLeft > 0 ? 'skill' : this.cheerLeft > 0 ? (this.cheerLeft > 1.1 ? 'greet' : 'dance') : this.moving > 0.1 ? 'move' : 'idle';
    const root = this.body.root;
    root.position.set(this.x, this.y, this.z);
    root.rotation.y = this.yaw;
    this.body.animate(dt, action, this.moving, wind);
    this.caster.x = this.x;
    this.caster.y = this.y + this.body.head * 0.6 * root.scale.y;
    this.caster.z = this.z;
    this.caster.yaw = this.yaw;
  }

  /** A ray (view) through its body? A sphere round its middle, good enough to click on. */
  hitBy(ray: THREE.Ray, tmp: THREE.Vector3): number | null {
    const s = this.body.root.scale.y;
    tmp.set(this.x, this.y + this.body.head * 0.5 * s + this.bob(), this.z);
    const r = Math.max(0.3, this.body.head * 0.6 * s);
    if (ray.distanceSqToPoint(tmp) > r * r) return null;
    return ray.origin.distanceTo(tmp);
  }

  private groundY(x: number, z: number): number {
    const g = this.world.heightAt(x, z);
    return (this.body.hover > 0 ? Math.max(g, 0) : g) + this.body.hover;
  }

  /** Flyers bob (their body animates it, roughly this). */
  private bob(): number {
    return this.body.hover > 0 ? Math.sin(this.time * 2) * 0.05 : 0;
  }
}
