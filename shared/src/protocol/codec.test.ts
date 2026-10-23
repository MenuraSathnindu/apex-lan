import { describe, expect, it } from 'vitest';
import { decodeC2S, decodeS2C, encode } from './codec.ts';

describe('codec', () => {
  it('round-trips messages', () => {
    expect(decodeC2S(encode({ t: 'ping', clientTime: 12.5 }))).toEqual({ t: 'ping', clientTime: 12.5 });
    const race = { t: 'race', race: { phase: 'countdown', raceId: 2, startsAt: 123, laps: 3, finishDeadline: 0, tyreWear: 'normal', trackId: 'apex-park', session: { kind: 'free', laps: 3, qualifying: null, endsAt: 0, round: null } } } as const;
    expect(decodeS2C(encode(race))).toEqual(race);
  });

  it('rejects malformed input', () => {
    expect(() => decodeC2S('42')).toThrow();
    expect(() => decodeC2S('{"x":1}')).toThrow();
    expect(() => decodeC2S('not json')).toThrow();
  });
});
