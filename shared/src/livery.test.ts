import { describe, expect, it } from 'vitest';
import { CAR_COLORS } from './constants.ts';
import { LIVERY_PRESETS, presetLivery, sanitizeLivery } from './livery.ts';

describe('livery', () => {
  it('has a preset for every grid colour, led by that colour', () => {
    expect(LIVERY_PRESETS.length).toBe(CAR_COLORS.length);
    LIVERY_PRESETS.forEach((l, i) => expect(l.primary).toBe(CAR_COLORS[i]));
  });

  it('presetLivery wraps and returns a copy', () => {
    expect(presetLivery(CAR_COLORS.length)).toEqual(LIVERY_PRESETS[0]);
    presetLivery(0).primary = 0;
    expect(LIVERY_PRESETS[0]!.primary).toBe(CAR_COLORS[0]);
  });

  it('keeps valid fields and replaces bad ones', () => {
    const fb = presetLivery(2);
    expect(sanitizeLivery({ primary: 0x123456, secondary: 0xffffff, accent: 0, number: 44 }, fb)).toEqual({
      primary: 0x123456,
      secondary: 0xffffff,
      accent: 0,
      number: 44,
    });
    expect(sanitizeLivery({ primary: -1, secondary: 'red', accent: 0x1000000, number: 100 }, fb)).toEqual(fb);
    expect(sanitizeLivery({ number: 3.5 }, fb).number).toBe(fb.number);
    expect(sanitizeLivery(null, fb)).toEqual(fb);
    expect(sanitizeLivery('x', fb)).toEqual(fb);
  });
});
