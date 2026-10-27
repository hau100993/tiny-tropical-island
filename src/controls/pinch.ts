/**
 * Two fingers on the scene: a pinch. Reports the change of the distance between them, as a
 * factor (> 1: the fingers moved apart, zoom in). The overview camera (OrbitControls) has its
 * own pinch; this one is for walking.
 */
export class Pinch {
  private readonly points = new Map<number, { x: number; y: number }>();
  private last = 0;

  constructor(
    dom: HTMLElement,
    /** A second finger came down: the one-finger look must let go. */
    private readonly onStart: () => void,
    private readonly onPinch: (factor: number) => void,
  ) {
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.points.size === 2) {
        this.last = this.spread();
        this.onStart();
      }
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.points.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.points.size !== 2) return;
      const d = this.spread();
      if (this.last > 0 && d > 0) this.onPinch(d / this.last);
      this.last = d;
    });
    const end = (e: PointerEvent): void => {
      this.points.delete(e.pointerId);
      this.last = 0;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** Distance (px) between the two fingers. */
  private spread(): number {
    let ax = 0;
    let ay = 0;
    let i = 0;
    let d = 0;
    for (const p of this.points.values()) {
      if (i === 0) {
        ax = p.x;
        ay = p.y;
      } else {
        d = Math.hypot(p.x - ax, p.y - ay);
      }
      i++;
    }
    return d;
  }
}
