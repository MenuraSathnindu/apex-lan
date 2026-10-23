import { describe, expect, it } from 'vitest';
import { countdownMs } from '@apex/shared';
import { setup } from './roomHarness.testutil.ts';

describe('Room broadcast rules', () => {
  it('quick race countdown lasts the light sequence', () => {
    const { room, join, now } = setup();
    const a = join('Ann');
    room.handle(a, { t: 'start' });
    const race = a.last('race').race;
    expect(race.phase).toBe('countdown');
    expect(race.startsAt - now()).toBe(countdownMs('free', race.raceId));
  });
});
