import * as THREE from 'three';

/** Full-screen loading overlay driven by three's default LoadingManager. */
export function createLoadingScreen(root: HTMLElement) {
  root.innerHTML = `<div class="loading-box"><div class="loading-title">apex-lan</div>
    <div class="loading-bar"><div class="loading-fill"></div></div>
    <div class="loading-text">Loading…</div></div>`;
  const fill = root.querySelector<HTMLElement>('.loading-fill')!;
  const text = root.querySelector<HTMLElement>('.loading-text')!;
  THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => {
    fill.style.width = `${Math.round((loaded / total) * 100)}%`;
    text.textContent = `Loading ${url.split('/').pop()} (${loaded}/${total})`;
  };
  return {
    setText(t: string) {
      text.textContent = t;
    },
    hide() {
      root.classList.add('loading-done');
      setTimeout(() => root.remove(), 600);
    },
  };
}
