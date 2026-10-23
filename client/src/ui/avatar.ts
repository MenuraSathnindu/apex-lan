/** Escapes text for innerHTML. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Profile photo, or the tag on the livery colour when there is none. `size` in CSS px. */
export function avatarHtml(p: { photo: string | null; tag: string; color?: number }, size: number, extraClass = ''): string {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px;--av:${hex(p.color ?? 0x3a3f4b)}`;
  return p.photo
    ? `<img class="avatar ${extraClass}" src="${esc(p.photo)}" alt="" style="${style}" loading="lazy" decoding="async" />`
    : `<span class="avatar avatar-tag ${extraClass}" style="${style}">${esc(p.tag)}</span>`;
}

/** 83456 → "1:23.456". */
export function formatLap(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** Sector time "28.512" (no minutes). */
export function formatSector(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(3);
}
