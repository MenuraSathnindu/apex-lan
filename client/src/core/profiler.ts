/**
 * Lightweight frame profiler: CPU time of the physics steps and of the render call
 * (scene graph + WebGL command submission), plus real GPU time via a WebGL timer query
 * when the browser offers EXT_disjoint_timer_query_webgl2. Averages over ~1 s windows.
 */
export class FrameProfiler {
  /** Latest averages (ms per frame). gpu is null when timer queries aren't available. */
  readonly stats = { step: 0, render: 0, gpu: null as number | null, frames: 0 };
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly queries: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  private acc = { step: 0, render: 0, gpu: 0, gpuN: 0, frames: 0, time: 0 };
  private t0 = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  beginStep(): void {
    this.t0 = performance.now();
  }

  endStep(): void {
    this.acc.step += performance.now() - this.t0;
  }

  beginRender(): void {
    this.t0 = performance.now();
    if (this.ext && !this.active && this.queries.length < 4) {
      this.active = this.gl.createQuery();
      if (this.active) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
    }
  }

  endRender(dt: number): void {
    this.acc.render += performance.now() - this.t0;
    const gl = this.gl;
    if (this.ext && this.active) {
      gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.queries.push(this.active);
      this.active = null;
    }
    // Collect finished queries (results arrive a frame or two later).
    while (this.queries.length && gl.getQueryParameter(this.queries[0]!, gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.queries.shift()!;
      if (!gl.getParameter(this.ext!.GPU_DISJOINT_EXT)) {
        this.acc.gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        this.acc.gpuN++;
      }
      gl.deleteQuery(q);
    }
    this.acc.frames++;
    this.acc.time += dt;
    if (this.acc.time >= 1) {
      const n = this.acc.frames;
      this.stats.step = this.acc.step / n;
      this.stats.render = this.acc.render / n;
      this.stats.gpu = this.acc.gpuN ? this.acc.gpu / this.acc.gpuN : null;
      this.stats.frames = n / this.acc.time;
      this.acc = { step: 0, render: 0, gpu: 0, gpuN: 0, frames: 0, time: 0 };
    }
  }
}
