import { describe, expect, it } from 'vitest';
import { RACE, TRACK_STYLE, countdownMs, freeSession, lightsStartAt, type CarState } from '@apex/shared';
import type { SessionOutcome } from './room.ts';
import { setup, track, type FakeConn } from './roomHarness.testutil.ts';

const at = (x: number, z: number): CarState => ({ p: [x, 0.7, z], q: [0, 0, 0, 1], v: [0, 0, 0], wh: new Array(12).fill(0), b: 0 });

const step = track.samples[1]!.s;
/** A state `off` metres left of the centreline at distance `s`, moving forward at `speed`. */
const beside = (s: number, off: number, speed: number): CarState => {
  const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
  return { p: [smp.x + smp.nx * off, 0.7, smp.z + smp.nz * off], q: [0, 0, 0, 1], v: [smp.tx * speed, 0, smp.tz * speed], wh: new Array(12).fill(0), b: 0 };
};
/** Drives sideways off the track at distance `s` and back, a metre per state (plausible movement). */
const excursion = (h: { send: (c: FakeConn, s: CarState) => void; wait: (ms: number) => void }, c: FakeConn, s: number) => {
  const smp = track.samples[Math.floor(s / step)]!;
  const out = smp.wl + TRACK_STYLE.curbWidth + RACE.trackLimits.margin + 2;
  const offs = [...Array.from({ length: Math.ceil(out) + 1 }, (_, k) => k), ...Array.from({ length: Math.ceil(out) + 1 }, (_, k) => Math.ceil(out) - k)];
  for (const off of offs) {
    h.send(c, beside(s, off, 30));
    h.wait(1000 / 30);
  }
};

/** Starts a quick race with Ann and Ben; returns the light timings. */
function quickRace() {
  const h = setup();
  const a = h.join('Ann');
  const b = h.join('Ben');
  h.room.handle(a, { t: 'setLaps', laps: 1 });
  h.room.handle(a, { t: 'start' });
  const race = a.last('race').race;
  return { ...h, a, b, startsAt: race.startsAt, lightsAt: lightsStartAt(race.startsAt, race.raceId) };
}

/** Reports a parked state from each car (at its grid spot) and keeps the others alive. */
const report = (h: ReturnType<typeof quickRace>, c: FakeConn, s: CarState) => {
  h.send(c, s);
  for (const o of h.conns) h.room.handle(o, { t: 'ping', clientTime: 0 });
  h.room.update();
};

describe('Room broadcast rules', () => {
  it('quick race countdown lasts the light sequence', () => {
    const { room, join, now } = setup();
    const a = join('Ann');
    room.handle(a, { t: 'start' });
    const race = a.last('race').race;
    expect(race.phase).toBe('countdown');
    expect(race.startsAt - now()).toBe(countdownMs('free', race.raceId));
  });

  it('a car that rolls before lights out gets +5 s and a steward penalty', () => {
    const h = quickRace();
    const grid = track.spawnGrid;
    const ann = grid[0]!.position;
    h.wait(h.lightsAt - h.now() + 100);
    report(h, h.a, at(ann.x, ann.z));
    report(h, h.b, at(grid[1]!.position.x, grid[1]!.position.z));
    h.wait(1000);
    // Ann creeps 2 m forward before the lights go out.
    report(h, h.a, at(ann.x + 2 * Math.sin(grid[0]!.yaw), ann.z + 2 * Math.cos(grid[0]!.yaw)));
    const e = h.b.last('steward').e;
    expect(e).toMatchObject({ id: h.idOf(h.a), kind: 'penalty', reason: 'jumpStart', penaltyMs: RACE.penaltyMs });
    h.go();
    h.room.update();
    expect(h.b.last('standings').standings.find((s) => s.id === h.idOf(h.a))!.penaltyMs).toBe(RACE.penaltyMs);
    // Only once.
    report(h, h.a, at(ann.x + 5, ann.z + 5));
    expect(h.b.inbox.filter((m) => m.t === 'steward')).toHaveLength(1);
  });

  it('a car that waits gets nothing', () => {
    const h = quickRace();
    const p = track.spawnGrid[0]!.position;
    h.wait(h.lightsAt - h.now() + 100);
    report(h, h.a, at(p.x, p.z));
    h.go();
    report(h, h.a, at(p.x + 3, p.z));
    expect(h.b.inbox.some((m) => m.t === 'steward')).toBe(false);
  });

  it('qualifying has no jump starts', () => {
    const h = setup();
    const a = h.join('Ann');
    h.room.runSession({ session: { kind: 'qualifying', laps: 3, qualifying: { mode: 'timed', minutes: 5 }, endsAt: 0, round: null }, trackId: track.def.id, tyreWear: 'normal', entrants: [h.idOf(a)] }, () => {});
    h.send(a, at(0, 0));
    h.wait(1000);
    h.send(a, at(10, 10));
    expect(a.inbox.some((m) => m.t === 'steward')).toBe(false);
  });

  it('a penalised winner is classified behind a car that finished within the penalty', () => {
    const h = setup();
    const a = h.join('Ann');
    const b = h.join('Ben');
    const done: SessionOutcome[] = [];
    h.room.runSession({ session: freeSession(1), trackId: track.def.id, tyreWear: 'normal', entrants: [h.idOf(a), h.idOf(b)] }, (o) => done.push(o));
    const race = a.last('race').race;
    h.wait(lightsStartAt(race.startsAt, race.raceId) - h.now() + 100);
    h.send(a, at(0, 0));
    h.wait(500);
    h.send(a, at(3, 0));
    expect(a.last('steward').e.reason).toBe('jumpStart');
    h.go();
    // Ann is a little faster (≈1 s over the lap), less than the 5 s penalty.
    h.together([{ c: a, s: -10, speed: 40 }, { c: b, s: -10, speed: 39 }], track.length / 39 + 3);
    h.wait(RACE.finishGraceMs);
    expect(done).toHaveLength(1);
    const [first, second] = done[0]!.classification;
    expect(first!.playerId).toBe(h.idOf(b));
    expect(second!.playerId).toBe(h.idOf(a));
    expect(second!.totalMs! - first!.totalMs!).toBeGreaterThan(RACE.penaltyMs - 2000);
  });

  it('third track-limits strike in a race gives +5 s (warnings before)', () => {
    const h = quickRace();
    h.go();
    const s0 = track.length / 2;
    for (let k = 0; k < 3; k++) excursion(h, h.a, s0 + k * 20);
    const events = h.b.inbox.flatMap((m) => (m.t === 'steward' ? [m.e] : []));
    expect(events.map((e) => [e.kind, e.strikes])).toEqual([['warning', 1], ['warning', 2], ['penalty', 3]]);
    expect(events[2]).toMatchObject({ reason: 'trackLimits', penaltyMs: RACE.penaltyMs });
    expect(h.b.last('standings').standings.find((s) => s.id === h.idOf(h.a))!.penaltyMs).toBe(RACE.penaltyMs);
  });

  it('a qualifying excursion deletes the lap', () => {
    const h = setup();
    const a = h.join('Ann');
    h.room.runSession({ session: { kind: 'qualifying', laps: 3, qualifying: { mode: 'timed', minutes: 5 }, endsAt: 0, round: null }, trackId: track.def.id, tyreWear: 'normal', entrants: [h.idOf(a)] }, () => {});
    h.go();
    // Out lap (clean), then a flying lap with one excursion half way round.
    h.drive(a, -5, track.length + 10, 40);
    expect(a.last('standings').standings[0]!.bestLap).not.toBeNull();
    const bestBefore = a.last('standings').standings[0]!.bestLap;
    h.drive(a, 5, track.length / 2, 40);
    excursion(h, a, track.length / 2 + 6);
    h.drive(a, track.length / 2 + 6, track.length / 2, 40);
    expect(a.last('steward').e).toMatchObject({ kind: 'lapDeleted', reason: 'trackLimits', penaltyMs: 0 });
    // The deleted lap set no time (the out lap is still the best).
    h.wait(500);
    expect(a.last('standings').standings[0]!.bestLap).toBe(bestBefore);
  });

  it('broadcasts live sector times', () => {
    const h = quickRace();
    h.go();
    h.drive(h.a, -10, 10 + track.def.sectors[1]! + 20, 40);
    const e = h.b.last('sector').e;
    expect(e).toMatchObject({ id: h.idOf(h.a), lap: 1, sector: 0, valid: true });
  });

  it('pitStop during racing changes the tyre and broadcasts the roster', () => {
    const h = quickRace();
    h.go();
    h.room.handle(h.a, { t: 'pitStop', tyre: 'hard' });
    expect(h.b.last('roster').players.find((p) => p.id === h.idOf(h.a))!.tyre).toBe('hard');
  });

  it('pitStop in the lobby, during the countdown or with a bad compound is ignored', () => {
    const h = setup();
    const a = h.join('Ann');
    h.room.handle(a, { t: 'pitStop', tyre: 'soft' });
    expect(a.last('roster').players[0]!.tyre).toBe('medium');
    h.room.handle(a, { t: 'start' });
    h.room.handle(a, { t: 'pitStop', tyre: 'soft' });
    expect(a.last('roster').players[0]!.tyre).toBe('medium');
    h.go();
    h.room.handle(a, { t: 'pitStop', tyre: 'slick' as never });
    expect(a.last('roster').players[0]!.tyre).toBe('medium');
  });
});
