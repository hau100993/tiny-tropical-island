/**
 * The soundscape on/off switch, shared by the right desk monitor (🌊) and the video's corner
 * button. A playing video silences the soundscape unless you turned it back on while a video
 * played; that choice is kept for later videos until you turn it off again.
 */
export class AmbienceSwitch {
  /** The soundscape is wanted (off only after you switch it off with no video playing). */
  private wanted = true;
  /** Keep it playing under a video. */
  private withVideo = false;
  private videoPlaying = false;
  private readonly listeners: Array<(on: boolean) => void> = [];

  /** `apply(muted)` is called whenever the effective state changes (and once now). */
  constructor(private readonly apply: (muted: boolean) => void) {
    apply(false);
  }

  /** The soundscape is heard. */
  get on(): boolean {
    return this.wanted && (!this.videoPlaying || this.withVideo);
  }

  onChange(fn: (on: boolean) => void): void {
    this.listeners.push(fn);
  }

  setVideoPlaying(playing: boolean): void {
    if (playing === this.videoPlaying) return;
    const before = this.on;
    this.videoPlaying = playing;
    this.changed(before);
  }

  toggle(): void {
    const before = this.on;
    if (before) {
      if (this.videoPlaying) this.withVideo = false;
      else this.wanted = false;
    } else {
      this.wanted = true;
      if (this.videoPlaying) this.withVideo = true;
    }
    this.changed(before);
  }

  private changed(before: boolean): void {
    const on = this.on;
    if (on === before) return;
    this.apply(!on);
    for (const fn of this.listeners) fn(on);
  }
}
