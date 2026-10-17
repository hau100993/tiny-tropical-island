/**
 * Measures GPU time of the render call with EXT_disjoint_timer_query_webgl2.
 * Results arrive a few frames late (the GPU runs behind the CPU), so queries are polled.
 * If the extension is missing, `lastMs` stays NaN and the overlay shows "–".
 */
export class GpuTimer {
  lastMs = Number.NaN;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private readonly free: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    while (this.pending.length > 0) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
      if (!disjoint) this.lastMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      this.pending.shift();
      this.free.push(q);
    }
  }
}
