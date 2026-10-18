import { describe, expect, it } from 'vitest';
import { renderQr } from './qr.ts';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('renderQr', () => {
  const url = 'http://192.168.1.10:3000';

  it('packs two module rows per line, with a quiet zone', () => {
    const lines = strip(renderQr(url)).split('\n');
    // Version 2 = 25 modules + 2-module border on each side.
    expect(lines.every((l) => l.length === 29)).toBe(true);
    expect(lines).toHaveLength(15);
    expect(lines[0]!.trim()).toBe('');
  });

  it('draws the top-left finder pattern (dark = glyph in colour mode)', () => {
    const line = strip(renderQr(url)).split('\n')[1]!; // module rows 2 and 3
    expect(line.slice(2, 9)).toBe('█▀▀▀▀▀█');
  });

  it('inverts glyphs without colour, for dark terminals', () => {
    const plain = renderQr(url, { color: false });
    expect(plain).not.toContain('\x1b[');
    expect(plain.split('\n')[1]!.slice(2, 9)).toBe(' ▄▄▄▄▄ ');
  });
});
