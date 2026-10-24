import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { findMarks } from './checkMarks.mjs';

describe('findMarks', () => {
  it('flags series, team, manufacturer and regulation names', () => {
    const text = ['const a = 1;', 'the F1 car', 'a Formula One race', 'Porsche-like', 'open the DRS', 'the Grand Prix'].join('\n');
    expect(findMarks('src/x.ts', text).map((m: { line: number }) => m.line)).toEqual([2, 3, 4, 5, 6]);
  });

  it('ignores ordinary words that contain a short term', () => {
    expect(findMarks('src/x.ts', 'const gp = pad.poll(); // afford, formula, halo, fordable, mercedesbenz-free')).toEqual([]);
  });

  it('reports file, line and the matched term', () => {
    expect(findMarks('docs/a.md', 'ok\nlike a Ferrari')).toEqual([{ file: 'docs/a.md', line: 2, term: 'Ferrari' }]);
  });

  it('allows the README disclaimer and the dataset link in credits, nowhere else', () => {
    const disclaimer = 'This is an unofficial fan project and is not affiliated with or endorsed by Formula One Group or the FIA. All trademarks belong to their owners.';
    expect(findMarks('README.md', disclaimer)).toEqual([]);
    expect(findMarks('docs/x.md', disclaimer)).toHaveLength(1);
    expect(findMarks('README.md', 'race the FIA way')).toHaveLength(1);
    const link = '<https://github.com/bacinger/f1-circuits>';
    expect(findMarks('CREDITS.md', link)).toEqual([]);
    expect(findMarks('src/x.ts', link)).toHaveLength(1);
  });
});
