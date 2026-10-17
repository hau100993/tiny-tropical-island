import { damp } from './math';

/** A value that eases toward its target, so changes never pop. `rate` is in 1/seconds. */
export class SmoothedValue {
  target: number;
  value: number;

  constructor(initial: number, private readonly rate: number) {
    this.target = initial;
    this.value = initial;
  }

  update(dt: number): void {
    this.value += (this.target - this.value) * damp(this.rate, dt);
  }
}

/**
 * Single source of truth for the environment. UI writes targets; subsystems read values.
 * Later phases add rain, snow, wind, wetness, snow cover, time of day, etc.
 */
export class EnvState {
  readonly waveStrength = new SmoothedValue(0.45, 1.2);

  update(dt: number): void {
    this.waveStrength.update(dt);
  }
}
