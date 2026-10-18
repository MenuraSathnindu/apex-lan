/** Optional "74 fps · 13.5 ms" readout (menu → Graphics → Show FPS counter). */
export function createFpsCounter(root: HTMLElement) {
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
      el.textContent = `${Math.round(frames / time)} fps · ${((time / frames) * 1000).toFixed(1)} ms · worst ${(worst * 1000).toFixed(0)} ms`;
      frames = 0;
      time = 0;
      worst = 0;
    },
  };
}
