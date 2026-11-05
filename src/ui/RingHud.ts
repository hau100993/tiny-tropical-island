import { el } from './components';
import { icons } from './icons';

/** The result stays this long (ms) after the course ends. */
const RESULT_MS = 4500;

/**
 * Vòng Tròn Băng Giá's readout, top middle while a course is flown: the ring you're on of how
 * many, the clock, the difficulty, and a bar of the time left to reach the next ring (it turns
 * amber, then red, as it runs out). At the end: the result for a few seconds. Part of the UI
 * layer, so H hides it.
 */
export class RingHud {
  private readonly root: HTMLElement;
  private readonly count: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly level: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly result: HTMLElement;
  private hideTimer = 0;
  private shown = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'ring-hud');
    this.root.setAttribute('role', 'status');
    const row = el('div', 'ring-hud-row');
    const icon = el('span', 'ring-hud-icon');
    icon.innerHTML = icons.skillRings;
    this.count = el('span', 'ring-hud-count');
    this.clock = el('span', 'ring-hud-clock');
    this.level = el('span', 'ring-hud-level');
    row.append(icon, this.count, this.clock, this.level);
    const track = el('div', 'ring-hud-track');
    this.bar = el('div', 'ring-hud-bar');
    track.append(this.bar);
    this.result = el('div', 'ring-hud-result');
    this.root.append(row, track, this.result);
    parent.append(this.root);
  }

  /** A course begins: `level` as shown (e.g. "Khó"). */
  start(level: string, levelClass: string): void {
    window.clearTimeout(this.hideTimer);
    this.level.textContent = level;
    this.level.className = `ring-hud-level ${levelClass}`;
    this.root.classList.remove('ended');
    this.root.classList.add('on');
  }

  /** Every frame while flying it: rings passed of `total`, seconds so far, the time left (0 … 1). */
  update(passed: number, total: number, elapsed: number, left: number): void {
    const text = `${passed} / ${total}`;
    if (text !== this.shown) {
      this.shown = text;
      this.count.textContent = text;
    }
    this.clock.textContent = `${elapsed.toFixed(1)} s`;
    const k = Math.max(0, Math.min(1, left));
    this.bar.style.transform = `scaleX(${k})`;
    this.bar.classList.toggle('warn', k < 0.4);
    this.bar.classList.toggle('late', k < 0.18);
  }

  /** The end: a line of result (won or not), then it goes. */
  end(text: string, won: boolean): void {
    this.result.textContent = text;
    this.root.classList.add('ended');
    this.root.classList.toggle('won', won);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.root.classList.remove('on', 'ended', 'won'), RESULT_MS);
  }

  /** Gone at once (you got off the manta mid-course). */
  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.root.classList.remove('on', 'ended', 'won');
  }
}
