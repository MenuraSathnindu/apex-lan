import { encode } from 'uqr';

/** Quiet zone in modules. The spec asks for 4; 2 scans fine and keeps the code small. */
const BORDER = 2;
// Explicit black-on-bright-white, so the code has the right polarity on dark *and* light terminals.
const COLORS = '\x1b[30;107m';
const RESET = '\x1b[0m';

/**
 * Renders `text` as a QR code for the terminal: two modules per character cell using
 * half blocks (▀ ▄ █), so it stays roughly square and about 15 lines tall for a LAN URL.
 * With `color: false` it emits no escape codes and assumes a dark terminal (light = █).
 */
export function renderQr(text: string, { color = true }: { color?: boolean } = {}): string {
  const { data, size } = encode(text, { ecc: 'M', border: BORDER });
  const dark = (x: number, y: number) => y < size && data[y]![x]!;
  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x++) {
      // In color mode the glyph is the black foreground; without color it's the light one.
      const top = dark(x, y) === color;
      const bottom = (y + 1 < size ? dark(x, y + 1) : false) === color;
      line += top ? (bottom ? '█' : '▀') : bottom ? '▄' : ' ';
    }
    lines.push(color ? COLORS + line + RESET : line);
  }
  return lines.join('\n');
}
