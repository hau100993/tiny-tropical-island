/** Called with an absolute AudioContext time; schedule every event that starts before it. */
export type ScheduleFn = (until: number) => void;

const TICK_MS = 250;
/** Look-ahead while visible: short, so changes (volume, density) apply quickly. */
const VISIBLE_HORIZON = 1.5;
/**
 * Look-ahead while the tab is hidden. Chrome may run hidden-tab timers only once per minute,
 * so events are queued far enough ahead that sound never stalls between timer ticks.
 */
const HIDDEN_HORIZON = 75;

/**
 * Look-ahead scheduler for timed sound events (wave swells, bird calls, gusts).
 * Events are placed on the audio clock (sample-accurate), never on the JS timer.
 */
export class Scheduler {
  private readonly clients = new Set<ScheduleFn>();
  private timer = 0;

  constructor(private readonly ctx: BaseAudioContext) {
    this.timer = window.setInterval(this.tick, TICK_MS);
    document.addEventListener('visibilitychange', this.tick);
  }

  add(fn: ScheduleFn): void {
    this.clients.add(fn);
    fn(this.horizon());
  }

  remove(fn: ScheduleFn): void {
    this.clients.delete(fn);
  }

  private horizon(): number {
    return this.ctx.currentTime + (document.hidden ? HIDDEN_HORIZON : VISIBLE_HORIZON);
  }

  private tick = (): void => {
    const until = this.horizon();
    for (const fn of this.clients) fn(until);
  };

  dispose(): void {
    window.clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.tick);
    this.clients.clear();
  }
}
