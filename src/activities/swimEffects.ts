import { WakeKind, type WakeSink } from '../water/WakeMap';
import type { SpraySink } from '../water/Spray';
import type { SwimStroke, Walker } from '../controls/walker';
import { clamp } from '../core/math';

/** tan(19.47°): the Kelvin wake half-angle (see KayakActivity). */
const KELVIN = 0.354;

/**
 * What a swimmer leaves on the water: a small V from the head and shoulders, white water
 * from the flutter kick (crawl) or a swirl after each frog kick (breaststroke), a splash ring
 * and droplets where each hand goes in.
 */
export class SwimEffects {
  private timer = 0;

  constructor(
    private readonly wake: WakeSink | null,
    private readonly spray: SpraySink,
  ) {}

  /** Every frame while swimming. */
  update(dt: number, w: Readonly<Walker>): void {
    this.timer -= dt;
    if (!this.wake || !w.swimming || w.speed < 0.12 || this.timer > 0) return;
    this.timer = 0.06;
    const k = clamp(w.speed / 1.2, 0, 1.2);
    // Swimming direction (the body faces where it moves).
    const fx = w.vel.x / Math.max(w.speed, 1e-3);
    const fz = w.vel.y / Math.max(w.speed, 1e-3);
    const out = KELVIN * w.speed;
    for (const side of [-1, 1]) {
      // Right of the swimming direction: (−fz, fx).
      const x = w.x + fx * 0.35 - fz * side * 0.2;
      const z = w.z + fz * 0.35 + fx * side * 0.2;
      this.wake.emit(WakeKind.Blob, x, z, -fz * side * out, fx * side * out, 2.2, 0.06, 0.3, 0.1 * k, 0.03 * k);
    }
    // The kick, about 1.3 m behind the head: churned white water when crawling.
    if (w.crawl > 0.5) {
      const x = w.x - fx * 1.3 + (Math.random() - 0.5) * 0.25;
      const z = w.z - fz * 1.3 + (Math.random() - 0.5) * 0.25;
      this.wake.emit(WakeKind.Blob, x, z, 0, 0, 1.4, 0.12, 0.35, 0.3 * k, 0.03 * k);
    }
  }

  /** A hand enters the water (crawl), or the frog kick ends (breaststroke). */
  stroke(e: SwimStroke, w: Readonly<Walker>): void {
    const fx = -Math.sin(w.yaw);
    const fz = -Math.cos(w.yaw);
    if (e.kind === 'crawl') {
      // In front of the shoulder of that arm.
      const x = w.x + fx * 0.75 - fz * e.side * 0.22;
      const z = w.z + fz * 0.75 + fx * e.side * 0.22;
      this.wake?.emit(WakeKind.Ring, x, z, 0, 0, 0.9, 0.08, 0.6, 0.35 * e.strength, 0.04 * e.strength);
      for (let i = 0; i < 3 + Math.round(5 * e.strength); i++) {
        const a = Math.random() * Math.PI * 2;
        this.spray.drop(x, w.surfaceY + 0.05, z, w.vel.x + Math.cos(a) * 0.5, 0.8 + Math.random() * 1.2, w.vel.y + Math.sin(a) * 0.5, 0.01 + Math.random() * 0.01);
      }
    } else {
      // The feet snap together behind: a swirl of water there, the head pushing a ring ahead.
      this.wake?.emit(WakeKind.Eddy, w.x - fx * 1.4, w.z - fz * 1.4, 0, 0, 3.5, 0.25, 0.7, 0.22 * e.strength, 0.04);
      this.wake?.emit(WakeKind.Ring, w.x + fx * 0.3, w.z + fz * 0.3, 0, 0, 1.2, 0.2, 0.9, 0.14 * e.strength, 0.035);
    }
  }
}
