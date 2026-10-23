import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS } from '../constants.ts';
import { RACE } from '../tuning.ts';
import { MAX_COUNTDOWN_MS, countdownMs, lightsHoldMs, lightsStartAt, litLights } from './startLights.ts';

const L = RACE.lights;

describe('start lights', () => {
  it('hold is deterministic and within 1-3 s', () => {
    const holds = new Set<number>();
    for (let id = 1; id <= 200; id++) {
      const h = lightsHoldMs(id);
      expect(h).toBe(lightsHoldMs(id));
      expect(h).toBeGreaterThanOrEqual(L.holdMinMs);
      expect(h).toBeLessThanOrEqual(L.holdMaxMs);
      holds.add(Math.round(h / 100));
    }
    // Not the same every race.
    expect(holds.size).toBeGreaterThan(10);
  });

  it('countdown is lead + 5 lights + hold for races, COUNTDOWN_MS for qualifying', () => {
    for (const kind of ['free', 'sprint', 'race'] as const) {
      expect(countdownMs(kind, 7)).toBe(L.leadMs + L.count * L.intervalMs + lightsHoldMs(7));
      expect(countdownMs(kind, 7)).toBeLessThanOrEqual(MAX_COUNTDOWN_MS);
    }
    expect(countdownMs('qualifying', 7)).toBe(COUNTDOWN_MS);
  });

  it('lights come on one per second and go out at startsAt', () => {
    const startsAt = 100_000;
    const id = 3;
    const first = lightsStartAt(startsAt, id);
    expect(first).toBe(startsAt - lightsHoldMs(id) - (L.count - 1) * L.intervalMs);
    expect(litLights(first - 1, startsAt, id)).toBe(0);
    expect(litLights(first, startsAt, id)).toBe(1);
    expect(litLights(first + L.intervalMs, startsAt, id)).toBe(2);
    expect(litLights(first + 4 * L.intervalMs, startsAt, id)).toBe(5);
    expect(litLights(startsAt - 1, startsAt, id)).toBe(5);
    expect(litLights(startsAt, startsAt, id)).toBe(0);
  });
});
