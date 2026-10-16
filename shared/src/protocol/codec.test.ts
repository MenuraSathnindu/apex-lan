import { describe, expect, it } from 'vitest';
import { decodeC2S, decodeS2C, encode } from './codec.ts';

describe('codec', () => {
  it('round-trips messages', () => {
    expect(decodeC2S(encode({ t: 'ping', clientTime: 12.5 }))).toEqual({ t: 'ping', clientTime: 12.5 });
    expect(decodeS2C(encode({ t: 'playerCount', count: 3 }))).toEqual({ t: 'playerCount', count: 3 });
  });

  it('rejects malformed input', () => {
    expect(() => decodeC2S('42')).toThrow();
    expect(() => decodeC2S('{"x":1}')).toThrow();
    expect(() => decodeC2S('not json')).toThrow();
  });
});
