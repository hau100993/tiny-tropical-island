import { CircleGrid, CollisionWorld, frame, toLocal, type BoxCollider, type CircleCollider, type Frame, type Platform } from './collision';
import type { Heightmap, Surface } from '../world/heightmap';
import { HOUSE_DIMS, type HouseInfo } from '../world/house';
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
  /** Where walking starts: at the foot of the porch steps, looking out to sea. */
  readonly spawn: { x: number; z: number; yaw: number };

  constructor(inputs: IslandColliderInputs) {
    const { house, heightmap: hm } = inputs;
    const p = house.placement;
    this.houseFrame = frame(p.x, p.z, p.rotY);
    this.floorY = house.floorY;
    const F = house.floorY;
    const D = HOUSE_DIMS;

    // House-local rectangle → collider in world space (its frame sits at the rectangle center).
    const box = (x0: number, x1: number, z0: number, z1: number, yMin: number, yMax: number): BoxCollider => ({
      ...this.houseRect((x0 + x1) / 2, (z0 + z1) / 2),
      hx: Math.abs(x1 - x0) / 2,
      hz: Math.abs(z1 - z0) / 2,
      yMin,
      yMax,
    });
    const W = D.halfWidth;
    const T = 0.08; // half wall thickness
    const wallTop = F + D.wallHeight;
    const porchEdge = D.porchFront - 0.1;
    const railTop = F + 0.95;
    const boxes: BoxCollider[] = [
      // Room walls; the front wall has a 1.1 m door gap in the middle.
      box(-W, W, D.roomBack - T, D.roomBack + T, F, wallTop),
      box(-W - T, -W + T, D.roomBack, D.roomFront, F, wallTop),
      box(W - T, W + T, D.roomBack, D.roomFront, F, wallTop),
      box(-W, -0.55, D.roomFront - T, D.roomFront + T, F, wallTop),
      box(0.55, W, D.roomFront - T, D.roomFront + T, F, wallTop),
      // Porch railings, open in the middle of the front for the steps.
      box(-W - T, -W + T, D.roomFront, porchEdge, F, railTop),
      box(W - T, W + T, D.roomFront, porchEdge, F, railTop),
      box(-W, -0.7, porchEdge - T, porchEdge + T, F, railTop),
      box(0.7, W, porchEdge - T, porchEdge + T, F, railTop),
      // Furniture: bed, table, stool.
      box(-2.35, -1.35, -1.9, 0.1, F, F + 0.57),
      box(1.0, 2.0, -1.65, -0.95, F, F + 0.78),
      box(1.33, 1.67, -0.78, -0.43, F, F + 0.45),
    ];
    // Stilts under the floor (only matter where the ground is low enough to walk under).
    for (const lz of [-1.9, 0, 1.9, 4.1]) {
      for (const lx of [-2.4, 0, 2.4]) {
        if (lz === 0 && lx === 0) continue;
        // Top just below the floor beams, so it never catches feet on the top step.
        boxes.push(box(lx - 0.1, lx + 0.1, lz - 0.1, lz + 0.1, -100, F - 0.35));
      }
    }

    const floorZ0 = D.roomBack - 0.05;
    const floorZ1 = D.porchFront;
    const floor: Platform<WalkSurface> = {
      ...this.houseRect(0, (floorZ0 + floorZ1) / 2),
      hx: W + 0.1,
      hz: (floorZ1 - floorZ0) / 2,
      height: () => F,
      surface: 'wood',
    };
    // Treads step down from the porch: tread k (1-based) spans [porchFront + (k−1)·depth, porchFront + k·depth].
    const s = house.steps;
    const stairsLen = Math.max(0, s.count - 1) * s.depth;
    const stairsMid = D.porchFront + stairsLen / 2;
    const stairs: Platform<WalkSurface> = {
      ...this.houseRect(0, stairsMid),
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
    const foot = this.houseRect(0, D.porchFront + stairsLen + 1.2);
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
    const lx = Math.abs(this.local.x);
    const lz = this.local.z;
    const D = HOUSE_DIMS;
    if (lx < D.halfWidth && lz > D.roomBack && lz < D.roomFront) return 'room';
    if (lx < D.halfWidth + 0.6 && lz > D.roomBack - 0.5 && lz < D.porchFront + 0.4) return 'porch';
    return 'none';
  }

  /** Tree trunks within `radius` meters. */
  treesNear(x: number, z: number, radius: number): number {
    return this.trees.countWithin(x, z, radius);
  }
}
