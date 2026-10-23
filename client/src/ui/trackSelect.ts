import type { TrackIndexEntry } from '@apex/shared';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Draws a track's outline (north up), with a start/finish tick and a dot showing the direction. */
export function drawTrackPreview(canvas: HTMLCanvasElement, entry: TrackIndexEntry, opts: { stroke?: string; width?: number } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pts = entry.preview;
  if (pts.length < 3) return;
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const pad = 8;
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxZ - minZ || 1));
  const ox = (w - (maxX - minX) * scale) / 2;
  const oz = (h - (maxZ - minZ) * scale) / 2;
  const P = (p: [number, number]): [number, number] => [ox + (p[0] - minX) * scale, oz + (p[1] - minZ) * scale];
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(...P(p)) : g.moveTo(...P(p))));
  g.closePath();
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = (opts.width ?? 3) + 3;
  g.stroke();
  g.strokeStyle = opts.stroke ?? '#e8e8e8';
  g.lineWidth = opts.width ?? 3;
  g.stroke();
  // Start/finish: a red tick across the line, and a dot a little way along (direction).
  const [sx, sy] = P(pts[0]!);
  const [nx, ny] = P(pts[1]!);
  const len = Math.hypot(nx - sx, ny - sy) || 1;
  const [ux, uy] = [(nx - sx) / len, (ny - sy) / len];
  g.strokeStyle = '#ff3b3b';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(sx - uy * 7, sy + ux * 7);
  g.lineTo(sx + uy * 7, sy - ux * 7);
  g.stroke();
  const [dx, dy] = P(pts[Math.min(pts.length - 1, 4)]!);
  g.fillStyle = '#ff3b3b';
  g.beginPath();
  g.arc(dx, dy, 2.5, 0, Math.PI * 2);
  g.fill();
}

/**
 * Full-screen track picker: a card per circuit with its layout, country and length. Opened from
 * the lobby by the host; picking one sends it to the server (which tells everyone).
 */
export function createTrackSelect(root: HTMLElement, onPick: (id: string) => void) {
  root.innerHTML = `
    <div class="ts-panel" role="dialog" aria-label="Choose a track">
      <header class="ts-head">
        <h2>Choose a track</h2>
        <input class="ts-filter" type="search" placeholder="Filter by name or country" aria-label="Filter tracks" />
        <button type="button" class="ts-close" aria-label="Close">✕</button>
      </header>
      <div class="ts-grid"></div>
    </div>`;
  const grid = root.querySelector<HTMLElement>('.ts-grid')!;
  const filter = root.querySelector<HTMLInputElement>('.ts-filter')!;
  let entries: TrackIndexEntry[] = [];
  let current = '';

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    const shown = entries.filter((e) => !q || `${e.name} ${e.country}`.toLowerCase().includes(q));
    grid.innerHTML = shown
      .map(
        (e) => `<button type="button" class="ts-card${e.id === current ? ' selected' : ''}" data-id="${esc(e.id)}">
          <canvas class="ts-map"></canvas>
          <span class="ts-name">${esc(e.name)}</span>
          <span class="ts-meta">${esc(e.country)} · ${e.lengthKm.toFixed(2)} km${e.street ? ' · street' : ''}</span>
        </button>`,
      )
      .join('');
    grid.querySelectorAll<HTMLButtonElement>('.ts-card').forEach((card, i) => {
      drawTrackPreview(card.querySelector('canvas')!, shown[i]!);
      card.addEventListener('click', () => {
        onPick(card.dataset.id!);
        hide();
      });
    });
  };
  const hide = () => {
    root.hidden = true;
  };
  root.querySelector('.ts-close')!.addEventListener('click', hide);
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) hide();
  });
  filter.addEventListener('input', render);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
    }
  });
  hide();

  return {
    show(list: TrackIndexEntry[], selected: string) {
      entries = list;
      current = selected;
      root.hidden = false;
      render();
      filter.focus();
    },
    hide,
    get open() {
      return !root.hidden;
    },
  };
}
