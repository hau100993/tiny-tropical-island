export type TickFn = (dt: number, elapsed: number) => void;

/**
 * requestAnimationFrame loop with an fps cap and a hard stop while the tab is hidden.
 * `elapsed` only advances while rendering, so animations resume where they paused.
 */
export class Loop {
  /** 0 = no cap (follow the display refresh rate). */
  targetFps = 60;
  /** Duration of the most recent hidden-tab pause, in seconds (shown in the debug overlay). */
  lastPauseSeconds = 0;

  private rafId = 0;
  private running = false;
  private last = 0;
  private elapsed = 0;
  private hiddenAt = 0;

  constructor(private readonly tick: TickFn) {
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Seconds of rendering so far (the shaders' `uTime`). */
  get elapsedSeconds(): number {
    return this.elapsed;
  }

  /**
   * Starts the shader clock again from 0. The GPU keeps time in 32-bit floats, which lose
   * precision as the number grows: after a day or two of rendering, rain and waves would move
   * in visible steps. The caller does this when nobody is watching (tab hidden, or behind a fade).
   */
  resetElapsed(): void {
    this.elapsed = 0;
  }

  start(): void {
    if (this.running || document.hidden) {
      this.running = true;
      return;
    }
    this.running = true;
    this.last = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  private onVisibility = (): void => {
    if (!this.running) return;
    if (document.hidden) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.hiddenAt = performance.now();
    } else {
      if (this.hiddenAt > 0) this.lastPauseSeconds = (performance.now() - this.hiddenAt) / 1000;
      this.last = performance.now();
      if (this.rafId === 0) this.rafId = requestAnimationFrame(this.frame);
    }
  };

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const delta = now - this.last;
    if (this.targetFps > 0) {
      const minDelta = 1000 / this.targetFps;
      // 1 ms tolerance so a 60 Hz display isn't throttled to 30 by timer jitter.
      if (delta < minDelta - 1) return;
      // Keep the remainder so the average rate matches the cap on high-refresh displays.
      this.last = now - (delta % minDelta);
    } else {
      this.last = now;
    }
    const dt = Math.min(delta / 1000, 0.1);
    this.elapsed += dt;
    this.tick(dt, this.elapsed);
  };
}
