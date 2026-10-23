import { describe, expect, it } from 'vitest';
import { Spectator } from './spectator.ts';

describe('Spectator', () => {
  it('follows the leader until told otherwise', () => {
    const s = new Spectator();
    expect(s.target([3, 5, 7], 5)).toBe(5);
    expect(s.target([3, 5, 7], 7)).toBe(7);
  });

  it('cycles through the visible cars in order and wraps', () => {
    const s = new Spectator();
    s.target([3, 5, 7], 5);
    s.cycle([3, 5, 7]);
    expect(s.target([3, 5, 7], 5)).toBe(7);
    s.cycle([3, 5, 7]);
    expect(s.target([3, 5, 7], 5)).toBe(3);
  });

  it('falls back to the leader when the followed car disappears, and to nothing with no cars', () => {
    const s = new Spectator();
    s.follow(7);
    expect(s.target([3, 5], 5)).toBe(5);
    expect(s.target([], null)).toBeNull();
    s.follow(null);
    expect(s.target([3, 5], null)).toBe(3);
  });
});
