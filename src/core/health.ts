/** Full health (Mochi, and each wild one in a fight). */
export const MAX_HP = 100;
/** Health comes back by itself this fast (per s), once nothing has hit for `after` s. */
const REGEN = { rate: 5, after: 6 } as const;
/** Petting Mochi heals it this much faster. */
const PET_REGEN = 4;

/**
 * Mochi's health in the forest fights (activities/ambush.ts), 0..100, not saved. A hit takes
 * some away; after a few quiet seconds it comes back by itself (faster while you stroke it).
 * Reaching 0 calls `onDown` (it lies down to rest); whoever handles that calls `restore`.
 * (You have no health: a hit on you is only splashes, 2026-10-25.)
 */
export class Health {
  hp = MAX_HP;
  /** s since the last hit. */
  private quiet = Infinity;
  private down = false;

  constructor(private readonly onDown: () => void) {}

  /** A hit for `amount`; true if it took it down. */
  hit(amount: number): boolean {
    if (this.down) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.quiet = 0;
    if (this.hp > 0) return false;
    this.down = true;
    this.onDown();
    return true;
  }

  /** Back on its feet with `hp`. */
  restore(hp = MAX_HP): void {
    this.down = false;
    this.hp = Math.min(MAX_HP, hp);
  }

  get isDown(): boolean {
    return this.down;
  }

  get hurt(): boolean {
    return this.hp < MAX_HP;
  }

  /** Every frame; `petting`: it is being stroked (it heals at once, faster). */
  update(dt: number, petting: boolean): void {
    this.quiet += dt;
    if (this.down || this.hp >= MAX_HP) return;
    if (this.quiet >= REGEN.after || petting) this.hp = Math.min(MAX_HP, this.hp + REGEN.rate * (petting ? PET_REGEN : 1) * dt);
  }
}
