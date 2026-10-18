import type { FrameProfiler } from '../core/profiler.ts';

/**
 * Optional readout (menu → Graphics → Show FPS counter): fps, frame time, worst frame, and
 * where the time goes — physics CPU, render CPU, GPU (when the browser exposes GPU timers).
 */
export function createFpsCounter(root: HTMLElement, profiler: FrameProfiler) {
  const el = document.createElement('div');
  el.className = 'fps-counter';
  el.hidden = true;
  root.append(el);
  let frames = 0;
  let time = 0;
  let worst = 0;

  return {
    show(on: boolean) {
      el.hidden = !on;
    },
    /** Call every frame with the frame time in seconds. */
    frame(dt: number) {
      if (el.hidden) return;
      frames++;
      time += dt;
      worst = Math.max(worst, dt);
      if (time < 0.5) return;
      const p = profiler.stats;
      const gpu = p.gpu === null ? '' : ` · gpu ${p.gpu.toFixed(1)}`;
      el.textContent = `${Math.round(frames / time)} fps · ${((time / frames) * 1000).toFixed(1)} ms (worst ${(worst * 1000).toFixed(0)}) · physics ${p.step.toFixed(1)} · render ${p.render.toFixed(1)}${gpu}`;
      frames = 0;
      time = 0;
      worst = 0;
    },
  };
}
