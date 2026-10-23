import { describe, expect, it } from 'vitest';
import { isValidCarState } from './carState.ts';

const base = { p: [0, 1, 0], q: [0, 0, 0, 1], v: [0, 0, 0], wh: new Array(12).fill(0), b: 0 };

describe('isValidCarState', () => {
  it('accepts tyre wear and the pit-lane flag', () => {
    expect(isValidCarState(base)).toBe(true);
    expect(isValidCarState({ ...base, tw: 0.42, pl: 1 })).toBe(true);
    expect(isValidCarState({ ...base, tw: 0, pl: 0 })).toBe(true);
  });

  it('rejects bad tyre wear or pit flags', () => {
    expect(isValidCarState({ ...base, tw: 1.5 })).toBe(false);
    expect(isValidCarState({ ...base, tw: -0.1 })).toBe(false);
    expect(isValidCarState({ ...base, tw: 'x' })).toBe(false);
    expect(isValidCarState({ ...base, pl: 2 })).toBe(false);
  });
});
