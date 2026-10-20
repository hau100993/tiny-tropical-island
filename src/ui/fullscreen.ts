/** Seconds without moving the mouse before the cursor hides (full screen only). */
const IDLE_MS = 3000;

/**
 * Full screen (`F` or the panel button) through the browser's Fullscreen API, and a cursor that
 * hides over the 3D scene after a few still seconds while in full screen (it comes back as soon
 * as the mouse moves). Browsers only allow entering full screen from a click or key press, so
 * it can't be restored on the next launch.
 */
export class Fullscreen {
  private readonly listeners: Array<(on: boolean) => void> = [];
  private idleTimer = 0;

  constructor() {
    document.addEventListener('fullscreenchange', () => {
      const on = this.active;
      if (!on) this.showCursor();
      else this.armIdle();
      for (const fn of this.listeners) fn(on);
    });
    window.addEventListener('pointermove', () => {
      if (!this.active) return;
      this.showCursor();
      this.armIdle();
    }, { passive: true });
  }

  get active(): boolean {
    return document.fullscreenElement !== null;
  }

  toggle(): void {
    if (this.active) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      // The whole page, so the panel and the Pomodoro card stay available.
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch((e: unknown) => {
        console.info('Full screen refused:', e instanceof Error ? e.message : e);
      });
    }
  }

  onChange(fn: (on: boolean) => void): void {
    this.listeners.push(fn);
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (this.active) document.body.classList.add('cursor-idle');
    }, IDLE_MS);
  }

  private showCursor(): void {
    window.clearTimeout(this.idleTimer);
    document.body.classList.remove('cursor-idle');
  }
}
