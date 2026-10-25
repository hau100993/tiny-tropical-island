/** Full health, for you and for Mochi. */
export const MAX_HP = 100;
/** Health comes back by itself this fast (per s), once nothing has hit for `after` s. */
const REGEN = { rate: 5, after: 6 } as const;
/** Petting Mochi heals it this much faster. */
const PET_REGEN = 4;

export type Who = 'you' | 'dog';

/**
 * Health for the forest ambushes (activities/ambush.ts): you and Mochi, 0..100, no saving. A
 * hit takes some away; after a few quiet seconds it comes back by itself. Reaching 0 calls
 * `onDown` (you faint and wake on the beach; Mochi lies down a while): health is then restored
 * by whoever handles that (`restore`).
 */
export class Health {
  readonly hp: Record<Who, number> = { you: MAX_HP, dog: MAX_HP };
  /** s since each was last hit. */
  private readonly quiet: Record<Who, number> = { you: Infinity, dog: Infinity };
  private readonly down: Record<Who, boolean> = { you: false, dog: false };

  constructor(private readonly onDown: (who: Who) => void) {}

  /** A hit for `amount`; true if it took them down. */
  hit(who: Who, amount: number): boolean {
    if (this.down[who]) return false;
    this.hp[who] = Math.max(0, this.hp[who] - amount);
    this.quiet[who] = 0;
    if (this.hp[who] > 0) return false;
    this.down[who] = true;
    this.onDown(who);
    return true;
  }

  /** Back on its feet with `hp`. */
  restore(who: Who, hp = MAX_HP): void {
    this.down[who] = false;
    this.hp[who] = Math.min(MAX_HP, hp);
  }

  isDown(who: Who): boolean {
    return this.down[who];
  }

  /** Every frame; `petting`: Mochi is being stroked (it heals faster). */
  update(dt: number, petting: boolean): void {
    for (const who of ['you', 'dog'] as const) {
      this.quiet[who] += dt;
      if (this.down[who] || this.hp[who] >= MAX_HP) continue;
      const fast = who === 'dog' && petting ? PET_REGEN : 1;
      if (this.quiet[who] >= REGEN.after || fast > 1) this.hp[who] = Math.min(MAX_HP, this.hp[who] + REGEN.rate * fast * dt);
    }
  }

  /** Anyone hurt (the bars stay up until both are full). */
  get hurt(): boolean {
    return this.hp.you < MAX_HP || this.hp.dog < MAX_HP;
  }
}
