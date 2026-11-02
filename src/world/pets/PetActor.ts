import * as THREE from 'three';
import type { BodyAction, PetBody } from './bodies';

/**
 * Following you, each has its own place behind you: two rings (2.4 m and 3.7 m), five places
 * each, the outer ones between the inner ones. Angles (rad) off straight behind you.
 */
const FOLLOW_RINGS = [2.4, 3.7] as const;
const FOLLOW_ANGLES = [
  [0, -0.75, 0.75, -1.5, 1.5],
  [-0.38, 0.38, -1.12, 1.12, 0],
] as const;
/** Flyers keep beside you (at least this far round from behind) and above your head (extra m). */
const FLYER_SIDE = 1.2;
const FLYER_LIFT = 0.9;
/** You further away than this from a pet (m): it stays at the camp. */
const FOLLOW_RANGE = 22;
/** Wandering about the camp, within this radius (m). */
const CAMP_R = 7;
/** Two pets nearer than this (m) are eased apart (see `separate`). */
const PERSONAL_SPACE = 0.8;
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
  private following = false;
  /** A skill's leap under way: from, to, how far through (s) and how long, how high. */
  private leapFrom = { x: 0, z: 0 };
  private leapTo = { x: 0, z: 0 };
  private leapT = -1;
  private leapTime = 0;
  private leapH = 0;

  constructor(
    readonly petId: string,
    public body: PetBody,
    private readonly world: ActorWorld,
    private readonly camp: { x: number; z: number },
    /** Its place round you (0..9, see FOLLOW_ANGLES). */
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

  /**
   * A skill moves it: a jump to (x, z) in `time` s, `height` m at the top. Walkers stop short of
   * the sea (the jump shortens to the last dry ground on the way).
   */
  leap(x: number, z: number, time: number, height: number): void {
    let tx = x;
    let tz = z;
    if (this.body.hover === 0) {
      for (let i = 0; i < 10 && this.world.heightAt(tx, tz) <= WATER; i++) {
        tx = this.x + (tx - this.x) * 0.8;
        tz = this.z + (tz - this.z) * 0.8;
      }
      if (this.world.heightAt(tx, tz) <= WATER) return;
    }
    this.leapFrom.x = this.x;
    this.leapFrom.z = this.z;
    this.leapTo.x = tx;
    this.leapTo.z = tz;
    this.leapT = 0;
    this.leapTime = Math.max(0.1, time);
    this.leapH = height;
  }

  /**
   * Eases two pets apart when they stand nearer than PERSONAL_SPACE (each moves half the
   * overlap a second); walkers never into the sea.
   */
  static separate(a: PetActor, b: PetActor, dt: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d >= PERSONAL_SPACE) return;
    // Exactly on top of each other: apart along a fixed direction.
    const nx = d > 1e-4 ? dx / d : 1;
    const nz = d > 1e-4 ? dz / d : 0;
    const push = (PERSONAL_SPACE - d) * Math.min(1, dt * 2) * 0.5;
    a.nudge(-nx * push, -nz * push);
    b.nudge(nx * push, nz * push);
  }

  private nudge(dx: number, dz: number): void {
    const x = this.x + dx;
    const z = this.z + dz;
    if (this.body.hover === 0 && this.world.heightAt(x, z) <= WATER) return;
    this.x = x;
    this.z = z;
  }

  /** `you`: where you walk (feet) and face ((sin yaw, cos yaw)), or null. */
  update(dt: number, you: { x: number; z: number; yaw: number } | null, wind: number): void {
    this.time += dt;
    this.cheerLeft = Math.max(0, this.cheerLeft - dt);
    this.castLeft = Math.max(0, this.castLeft - dt);
    const follow = you !== null && Math.hypot(you.x - this.x, you.z - this.z) < FOLLOW_RANGE;
    this.following = follow;
    if (this.leapT >= 0) {
      this.updateLeap(dt, wind);
      return;
    }
    if (follow && you) {
      // Its own place behind you (flyers beside you, so they never hang in front of the camera).
      const ring = Math.min(1, Math.floor(this.slot / 5));
      let off: number = FOLLOW_ANGLES[ring][this.slot % 5];
      if (this.body.hover > 0 && Math.abs(off) < FLYER_SIDE) off = off < 0 ? -FLYER_SIDE : FLYER_SIDE;
      const a = you.yaw + Math.PI + off;
      this.tx = you.x + Math.sin(a) * FOLLOW_RINGS[ring];
      this.tz = you.z + Math.cos(a) * FOLLOW_RINGS[ring];
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

  /** Mid-leap: along the line, up and down on a parabola, then it settles where it landed. */
  private updateLeap(dt: number, wind: number): void {
    this.leapT += dt;
    const q = Math.min(1, this.leapT / this.leapTime);
    this.x = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * q;
    this.z = this.leapFrom.z + (this.leapTo.z - this.leapFrom.z) * q;
    this.y = this.groundY(this.x, this.z) + 4 * q * (1 - q) * this.leapH;
    if (q >= 1) {
      this.leapT = -1;
      this.tx = this.x;
      this.tz = this.z;
      this.moving = 0;
    }
    const root = this.body.root;
    root.position.set(this.x, this.y, this.z);
    root.rotation.y = this.yaw;
    this.body.animate(dt, 'skill', 1, wind);
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
    if (this.body.hover === 0) return g;
    return Math.max(g, 0) + this.body.hover + (this.following ? FLYER_LIFT : 0);
  }

  /** Flyers bob (their body animates it, roughly this). */
  private bob(): number {
    return this.body.hover > 0 ? Math.sin(this.time * 2) * 0.05 : 0;
  }
}
