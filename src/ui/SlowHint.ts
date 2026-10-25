import { button, el } from './components';
import { vi } from './strings.vi';
import { QUALITY_LEVELS, type QualityLevel } from '../core/quality';
import { readStored, writeStored } from '../core/storage';

/** Frames before this (s, after the first frame) aren't counted: shaders and textures still settle. */
const WARMUP_S = 3;
/** Measured over this long (s) of steady rendering. */
const WINDOW_S = 10;
/** A gap longer than this (s) between frames (tab hidden, a stall) restarts the measurement. */
const GAP_S = 0.5;
/** Below this average the device is "slow" for the quality in use. */
const SLOW_FPS = 40;
/** The quality at which "Để nguyên" was chosen: no hint there again on this device. */
const DISMISS_KEY = 'tsw.slowHintDismissed';

/**
 * Measures the frame rate once, a few seconds after the scene shows (any device, phones
 * included), and if it is low offers one quality level down. A hint only: nothing changes
 * unless it is accepted, and a quality chosen by hand is never overridden.
 */
export class SlowHint {
  private readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private lastT = -1;
  private warm = 0;
  private time = 0;
  private frames = 0;
  private done = false;

  constructor(
    parent: HTMLElement,
    private readonly quality: () => QualityLevel,
    private readonly setQuality: (level: QualityLevel) => void,
  ) {
    this.root = el('div', 'slow-hint');
    this.root.setAttribute('role', 'status');
    this.root.hidden = true;
    this.text = el('span', '');
    const lower = button(vi.slowHint.lower, () => {
      const next = this.lowerLevel();
      if (next) this.setQuality(next);
      this.root.hidden = true;
    }, 'btn primary small');
    const keep = button(vi.slowHint.keep, () => {
      writeStored(DISMISS_KEY, this.quality());
      this.root.hidden = true;
    }, 'btn small');
    this.root.append(this.text, lower, keep);
    parent.append(this.root);
  }

  /** Every rendered frame; `now` in seconds (performance.now() / 1000). */
  frame(now: number): void {
    if (this.done) return;
    const dt = this.lastT < 0 ? 0 : now - this.lastT;
    this.lastT = now;
    if (dt > GAP_S) {
      this.time = 0;
      this.frames = 0;
      return;
    }
    if (this.warm < WARMUP_S) {
      this.warm += dt;
      return;
    }
    this.time += dt;
    this.frames++;
    if (this.time < WINDOW_S) return;
    this.done = true;
    const fps = this.frames / this.time;
    const next = this.lowerLevel();
    if (fps >= SLOW_FPS || !next || readStored(DISMISS_KEY) === JSON.stringify(this.quality())) return;
    this.text.textContent = vi.slowHint.text(Math.round(fps), vi.panel.qualityNames[next]);
    this.root.hidden = false;
  }

  private lowerLevel(): QualityLevel | null {
    const i = QUALITY_LEVELS.indexOf(this.quality());
    return i > 0 ? QUALITY_LEVELS[i - 1] : null;
  }
}
