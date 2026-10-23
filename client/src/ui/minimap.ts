import { CAR_COLORS, HUD, type BuiltTrack } from '@apex/shared';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const PAD = 12;

export interface MinimapCar {
  pos: { x: number; z: number };
  /** Index into CAR_COLORS. */
  color: number;
}

/**
 * North-up track map. The track outline is drawn once into an offscreen canvas; each update
 * (HUD.minimapHz) copies it and draws every car on top: remote cars as dots, yours as an arrow.
 */
export function createMinimap(root: HTMLElement, initial: BuiltTrack) {
  let track = initial;
  const canvas = document.createElement('canvas');
  canvas.className = 'minimap-canvas';
  root.append(canvas);
  const g = canvas.getContext('2d')!;
  const base = document.createElement('canvas');
  let scale = 1;
  let ox = 0;
  let oz = 0;
  let dpr = 1;
  let acc = Infinity;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const measure = () => {
    [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const s of track.samples) {
      [minX, maxX, minZ, maxZ] = [Math.min(minX, s.x), Math.max(maxX, s.x), Math.min(minZ, s.z), Math.max(maxZ, s.z)];
    }
  };
  measure();

  const toMap = (x: number, z: number): [number, number] => [(x - ox) * scale, (z - oz) * scale];

  const build = () => {
    dpr = Math.min(window.devicePixelRatio, 2);
    const size = Math.round(HUD.minimapSize * dpr);
    canvas.width = canvas.height = base.width = base.height = size;
    canvas.style.width = canvas.style.height = `${HUD.minimapSize}px`;
    const pad = PAD * dpr;
    scale = Math.min((size - 2 * pad) / (maxX - minX), (size - 2 * pad) / (maxZ - minZ));
    // Centre the track in the square.
    ox = (minX + maxX) / 2 - size / 2 / scale;
    oz = (minZ + maxZ) / 2 - size / 2 / scale;

    const b = base.getContext('2d')!;
    b.clearRect(0, 0, size, size);
    b.lineJoin = 'round';
    const path = new Path2D();
    track.samples.forEach((s, i) => {
      const [x, y] = toMap(s.x, s.z);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
    const avgWidth = track.samples.reduce((a, s) => a + s.wl + s.wr, 0) / track.samples.length;
    const roadPx = Math.max(4 * dpr, avgWidth * scale);
    b.strokeStyle = 'rgba(255,255,255,0.85)';
    b.lineWidth = roadPx + 3 * dpr;
    b.stroke(path);
    b.strokeStyle = '#2b2f38';
    b.lineWidth = roadPx;
    b.stroke(path);
    // Start/finish line across the road.
    const s = track.samples[track.startIndex]!;
    const [ax, ay] = toMap(s.x + s.nx * (s.wl + 2), s.z + s.nz * (s.wl + 2));
    const [bx, by] = toMap(s.x - s.nx * (s.wr + 2), s.z - s.nz * (s.wr + 2));
    b.strokeStyle = '#fff';
    b.lineWidth = 2.5 * dpr;
    b.beginPath();
    b.moveTo(ax, ay);
    b.lineTo(bx, by);
    b.stroke();
    acc = Infinity;
  };
  window.addEventListener('resize', build);
  build();

  return {
    /** Redraws the outline for another track. */
    setTrack(next: BuiltTrack) {
      track = next;
      measure();
      build();
    },

    /**
     * @param me your car: position, heading (yaw, 0 = +Z) and colour index
     * @param others visible remote cars
     */
    update(dt: number, me: { x: number; z: number; yaw: number; color: number }, others: Iterable<MinimapCar>) {
      acc += dt;
      if (acc < 1 / HUD.minimapHz) return;
      acc = 0;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(base, 0, 0);
      const r = 4.5 * dpr;
      g.lineWidth = 1.5 * dpr;
      g.strokeStyle = '#000';
      for (const o of others) {
        const [x, y] = toMap(o.pos.x, o.pos.z);
        g.fillStyle = hex(CAR_COLORS[o.color] ?? 0xffffff);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      // You: an arrow pointing where you're heading (map y = world z).
      const [x, y] = toMap(me.x, me.z);
      const fx = Math.sin(me.yaw);
      const fy = Math.cos(me.yaw);
      const s = 8 * dpr;
      g.fillStyle = hex(CAR_COLORS[me.color] ?? 0xffffff);
      g.strokeStyle = '#fff';
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.moveTo(x + fx * s, y + fy * s);
      g.lineTo(x - fx * s * 0.7 + fy * s * 0.6, y - fy * s * 0.7 - fx * s * 0.6);
      g.lineTo(x - fx * s * 0.35, y - fy * s * 0.35);
      g.lineTo(x - fx * s * 0.7 - fy * s * 0.6, y - fy * s * 0.7 + fx * s * 0.6);
      g.closePath();
      g.fill();
      g.stroke();
    },
  };
}
