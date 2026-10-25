/** Slowly drifting colour blobs (centre colour, radius as a fraction of the width, drift rates in Hz). */
const BLOBS: ReadonlyArray<{ color: string; r: number; fx: number; fy: number; phase: number }> = [
  { color: 'rgba(31,181,168,0.85)', r: 0.55, fx: 0.031, fy: 0.023, phase: 0 },
  { color: 'rgba(42,111,214,0.8)', r: 0.6, fx: 0.019, fy: 0.029, phase: 2.1 },
  { color: 'rgba(226,121,143,0.6)', r: 0.42, fx: 0.027, fy: 0.017, phase: 4.2 },
  { color: 'rgba(243,180,91,0.45)', r: 0.36, fx: 0.015, fy: 0.033, phase: 1.3 },
];

/**
 * The desk monitors' background: colour blobs drifting over dark teal. They are drawn on a canvas
 * `scale` times smaller than the screen and scaled up when painted; the scaling blurs them for
 * free (no blur filter). The small canvas is also what the glass cards "see through".
 */
export class ScreenBackdrop {
  readonly small: CanvasRenderingContext2D;

  /** `w`×`h`: the screen canvas size; `phase` shifts the drift so two screens differ. */
  constructor(
    private readonly w: number,
    private readonly h: number,
    readonly scale = 8,
    private readonly phase = 0,
  ) {
    const c = document.createElement('canvas');
    c.width = Math.round(w / scale);
    c.height = Math.round(h / scale);
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.small = g;
  }

  /** Moves the blobs to time `t` (s) on the small canvas. */
  update(t: number): void {
    const b = this.small;
    const bw = b.canvas.width;
    const bh = b.canvas.height;
    b.fillStyle = '#0b2230';
    b.fillRect(0, 0, bw, bh);
    for (const blob of BLOBS) {
      const p = blob.phase + this.phase;
      const cx = bw * (0.5 + 0.42 * Math.sin(t * blob.fx * 2 * Math.PI + p));
      const cy = bh * (0.5 + 0.4 * Math.cos(t * blob.fy * 2 * Math.PI + p * 1.7));
      const r = blob.r * bw;
      const grad = b.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, blob.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = grad;
      b.fillRect(0, 0, bw, bh);
    }
  }

  /** Paints it over the whole screen canvas, darkened by `shade` (0..1) for the text on top. */
  paint(g: CanvasRenderingContext2D, shade: number): void {
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.small.canvas, 0, 0, this.w, this.h);
    g.fillStyle = `rgba(5,14,22,${shade})`;
    g.fillRect(0, 0, this.w, this.h);
  }
}
