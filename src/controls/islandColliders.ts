import { CircleGrid, CollisionWorld, frame, rayBox, rayCircle, toLocal, type BoxCollider, type CircleCollider, type Frame, type Platform } from './collision';
import type { Heightmap, Surface } from '../world/heightmap';
import type { HouseInfo, LocalBox, LocalRect } from '../world/house';
import type { Placement } from '../world/layout';
import type { TrunkInstance } from '../world/vegetation/forest';

/** What the feet can stand on: terrain surfaces plus the wooden house floor and steps. */
export type WalkSurface = Surface | 'wood';

/** Where the walker is relative to the house roof. */
export type Shelter = 'none' | 'porch' | 'room';

export interface IslandColliderInputs {
  heightmap: Heightmap;
  house: HouseInfo;
  umbrella: Placement;
  trunks: readonly TrunkInstance[];
  rocks: readonly CircleCollider[];
}

/**
 * The island's collision world, built once from the same data that placed the meshes: trunks
 * and rocks as circles; house walls, railings, furniture and stilts as boxes; the floor and
 * steps as platforms. Also answers "am I indoors?" for sound and rain.
 */
export class IslandColliders {
  readonly world: CollisionWorld<WalkSurface>;
  /** Trunks only (no rocks): how dense the forest is around the walker. */
  private readonly trees: CircleGrid;
  private readonly houseFrame: Frame;
  private readonly floorY: number;
  private readonly local = { x: 0, z: 0 };
  /** What the third-person camera can't pass through: walls, roof, floor (see cameraDistance). */
  private readonly cameraBoxes: BoxCollider[];
  private readonly heightmap: Heightmap;
  private readonly house: HouseInfo;
  /** Where walking starts: at the foot of the porch steps, looking out to sea. */
  readonly spawn: { x: number; z: number; yaw: number };

  constructor(inputs: IslandColliderInputs) {
    const { house, heightmap: hm } = inputs;
    const p = house.placement;
    this.houseFrame = frame(p.x, p.z, p.rotY);
    this.floorY = house.floorY;
    this.house = house;
    const F = house.floorY;

    // House-local box → collider in world space (its frame sits at the box center).
    const box = (l: LocalBox): BoxCollider => ({
      ...this.houseRect((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2),
      hx: (l.x1 - l.x0) / 2,
      hz: (l.z1 - l.z0) / 2,
      yMin: l.y0,
      yMax: l.y1,
    });
    // Walls, glass, railings, furniture and stilts all come from the house itself.
    const boxes: BoxCollider[] = house.solids.map(box);

    const fl = house.floor;
    const floor: Platform<WalkSurface> = {
      ...this.houseRect((fl.x0 + fl.x1) / 2, (fl.z0 + fl.z1) / 2),
      hx: (fl.x1 - fl.x0) / 2,
      hz: (fl.z1 - fl.z0) / 2,
      height: () => F,
      surface: 'wood',
    };
    // Treads step down from the deck: tread k (1-based) spans [z0 + (k−1)·depth, z0 + k·depth].
    const s = house.stairs;
    const stairsLen = Math.max(0, s.count - 1) * s.depth;
    const stairs: Platform<WalkSurface> = {
      ...this.houseRect(s.x, s.z0 + stairsLen / 2),
      hx: s.halfWidth,
      hz: stairsLen / 2,
      height: (_lx, lz) => {
        const along = lz + stairsLen / 2;
        const k = Math.min(s.count - 1, Math.floor(along / s.depth) + 1);
        return F - k * s.rise;
      },
      surface: 'wood',
    };

    // Beach umbrella pole and lounge chair (local frame of the beach set, see props.ts).
    const u = inputs.umbrella;
    const uf = frame(u.x, u.z, u.rotY);
    const ground = hm.heightAt(u.x, u.z);
    const at = (lx: number, lz: number): { x: number; z: number } => ({
      x: uf.cx + lx * uf.cos + lz * uf.sin,
      z: uf.cz - lx * uf.sin + lz * uf.cos,
    });
    const chair = at(-1.1, -0.05);
    boxes.push({ cx: chair.x, cz: chair.z, cos: uf.cos, sin: uf.sin, hx: 0.32, hz: 0.95, yMin: ground - 1, yMax: ground + 0.6 });

    const circles: CircleCollider[] = [
      ...inputs.trunks.map((t) => ({ x: t.x, z: t.z, r: t.radius })),
      ...inputs.rocks,
      { x: u.x, z: u.z, r: 0.06 },
    ];
    this.world = new CollisionWorld<WalkSurface>(hm, circles, boxes, [floor, stairs]);
    this.heightmap = hm;
    // The camera stays out of full-height solids (walls, glass), the roof, the floor slab and
    // the steps; furniture and railings don't block it.
    this.cameraBoxes = [
      ...house.solids.filter((l) => l.y0 >= F - 0.01 && l.y1 >= F + 2.4).map(box),
      ...house.cameraSolids.map(box),
    ];
    const foot = this.houseRect(s.x, s.z0 + stairsLen + 1.2);
    // Camera yaw whose forward (−Z rotated by yaw) equals the house's local +Z.
    this.spawn = { x: foot.cx, z: foot.cz, yaw: p.rotY + Math.PI };
    this.trees = new CircleGrid(inputs.trunks.map((t) => ({ x: t.x, z: t.z, r: t.radius })), 6);
  }

  /** Frame of a rectangle centered at house-local (lx, lz), rotated like the house. */
  private houseRect(lx: number, lz: number): Frame {
    const f = this.houseFrame;
    return { cx: f.cx + lx * f.cos + lz * f.sin, cz: f.cz - lx * f.sin + lz * f.cos, cos: f.cos, sin: f.sin };
  }

  /** Under the roof? 'room' = inside the walls (rain is muffled), 'porch' = under the eaves. */
  shelterAt(x: number, z: number, feetY: number): Shelter {
    if (feetY < this.floorY - 0.3) return 'none';
    toLocal(this.houseFrame, x, z, this.local);
    if (inside(this.house.room, this.local.x, this.local.z)) return 'room';
    if (inside(this.house.roof, this.local.x, this.local.z)) return 'porch';
    return 'none';
  }

  /** World position of a house-local point. */
  houseToWorld(lx: number, lz: number, out: { x: number; z: number }): { x: number; z: number } {
    const f = this.houseFrame;
    out.x = f.cx + lx * f.cos + lz * f.sin;
    out.z = f.cz - lx * f.sin + lz * f.cos;
    return out;
  }

  /** House-local position of a world point. */
  worldToHouse(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    toLocal(this.houseFrame, x, z, out);
    return out;
  }

  /** Camera yaw that looks along house-local +Z (out through the glass wall, to the sea). */
  get seaYaw(): number {
    return this.house.placement.rotY + Math.PI;
  }

  /**
   * How far the third-person camera can back away from the head at (ox, oy, oz) along the unit
   * direction (dx, dy, dz) before it hits a wall, the roof, the floor, a trunk or the ground.
   */
  cameraDistance(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    let t = max;
    for (const b of this.cameraBoxes) t = Math.min(t, rayBox(b, ox, oy, oz, dx, dy, dz));
    const h = Math.hypot(dx, dz);
    if (h > 1e-6) {
      // rayCircle works in the horizontal plane: convert its 2D distance back along the 3D ray.
      const ux = dx / h;
      const uz = dz / h;
      this.trees.forEachNear(ox + dx * max * 0.5, oz + dz * max * 0.5, max * 0.5, (c) => {
        const t2 = rayCircle(c, ox, oz, ux, uz);
        if (t2 < Infinity) t = Math.min(t, t2 / h);
      });
    }
    // Terrain: march along the ray, stop a little above the ground.
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const s = (t * i) / steps;
      if (oy + dy * s < this.heightmap.heightAt(ox + dx * s, oz + dz * s) + 0.25) {
        t = (t * (i - 1)) / steps;
        break;
      }
    }
    return t;
  }

  /** Lowest camera height at (x, z) that stays clear of the sea surface and its waves. */
  waterClearance(x: number, z: number): number {
    return this.heightmap.heightAt(x, z) < 0.5 ? 0.45 : -Infinity;
  }

  /** Tree trunks within `radius` meters. */
  treesNear(x: number, z: number, radius: number): number {
    return this.trees.countWithin(x, z, radius);
  }
}

function inside(r: LocalRect, x: number, z: number): boolean {
  return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
}
