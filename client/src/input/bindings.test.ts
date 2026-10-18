import { describe, expect, it } from 'vitest';
import { bindKey, DEFAULT_BINDINGS, keyLabel, sanitizeBindings, unbindKey } from './bindings.ts';

describe('key bindings', () => {
  it('binding a key moves it off any other action', () => {
    const b = bindKey(DEFAULT_BINDINGS, 'handbrake', 1, 'KeyW');
    expect(b.handbrake).toEqual(['Space', 'KeyW']);
    expect(b.throttle).toEqual(['ArrowUp']);
    expect(DEFAULT_BINDINGS.throttle).toEqual(['KeyW', 'ArrowUp']); // not mutated
  });

  it('replaces a slot and caps at two keys', () => {
    expect(bindKey(DEFAULT_BINDINGS, 'throttle', 0, 'KeyI').throttle).toEqual(['KeyI', 'ArrowUp']);
    expect(bindKey(DEFAULT_BINDINGS, 'throttle', 5, 'KeyI').throttle).toEqual(['KeyW', 'ArrowUp']);
  });

  it('unbinds a slot', () => {
    expect(unbindKey(DEFAULT_BINDINGS, 'throttle', 0).throttle).toEqual(['ArrowUp']);
  });

  it('sanitizes stored bindings', () => {
    expect(sanitizeBindings(null)).toEqual(DEFAULT_BINDINGS);
    const b = sanitizeBindings({ throttle: ['KeyI'], brake: ['Escape'], left: 42 });
    expect(b.throttle).toEqual(['KeyI']);
    expect(b.brake).toEqual(DEFAULT_BINDINGS.brake);
    expect(b.left).toEqual(DEFAULT_BINDINGS.left);
  });

  it('labels keys readably', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Numpad8')).toBe('Num 8');
  });
});
