import { describe, expect, it } from 'vitest';
import { APEX_PARK, COUNTDOWN_MS, buildTrack, type CarState, type S2C, type SessionInfo } from '@apex/shared';
import { Room, type Connection, type SessionOutcome } from './room.ts';

class FakeConn implements Connection {
  inbox: S2C[] = [];
  send(msg: S2C) {
    this.inbox.push(msg);
  }
  close() {}
  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> {
    const m = [...this.inbox].reverse().find((x) => x.t === t);
    if (!m) throw new Error(`no ${t} message`);
    return m as Extract<S2C, { t: T }>;
  }
}

const track = buildTrack(APEX_PARK);
const step = track.samples[1]!.s;
const DT = 1000 / 30;

function setup() {
  let time = 1_000_000;
  const room = new Room({ now: () => time });
  const conns: FakeConn[] = [];
  const join = (name: string, sessionId: string | null = null) => {
    const c = new FakeConn();
    room.handle(c, { t: 'hello', sessionId, name, color: conns.length });
    conns.push(c);
    return c;
  };
  const idOf = (c: FakeConn) => c.last('welcome').playerId;
  /** Advances time by ms, keeping everyone alive. */
  const wait = (ms: number) => {
    for (let t = 0; t < ms; t += 500) {
      time += Math.min(500, ms - t);
      for (const c of conns) room.handle(c, { t: 'ping', clientTime: 0 });
      room.update();
    }
  };
  /** One car drives `metres` along the centreline from distance `fromS` at `speed`, 30 states/s. */
  const drive = (c: FakeConn, fromS: number, metres: number, speed = 40) => {
    for (let d = 0; d <= metres; d += (speed * DT) / 1000) {
      const s = (((fromS + d) % track.length) + track.length) % track.length;
      const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
      time += DT;
      const state: CarState = { p: [smp.x, 0.7, smp.z], q: [0, 0, 0, 1], v: [smp.tx * speed, 0, smp.tz * speed], wh: new Array(12).fill(0), b: 0 };
      room.handle(c, { t: 'state', s: state });
      for (const o of conns) if (o !== c) room.handle(o, { t: 'ping', clientTime: 0 });
      room.update();
    }
  };
  /** Stops a car (speed 0) so it doesn't count as "on a lap". */
  const park = (c: FakeConn) => room.handle(c, { t: 'state', s: { p: [0, 0.7, 0], q: [0, 0, 0, 1], v: [0, 0, 0], wh: new Array(12).fill(0), b: 0 } });
  const go = () => wait(COUNTDOWN_MS + 50);
  /** Several cars at once: each moves along the centreline at its speed (0 = parked where it is). */
  const together = (cars: { c: FakeConn; s: number; speed: number }[], seconds: number) => {
    for (let t = 0; t < seconds * 1000; t += DT) {
      time += DT;
      for (const car of cars) {
        car.s += (car.speed * DT) / 1000;
        const s = ((car.s % track.length) + track.length) % track.length;
        const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
        room.handle(car.c, { t: 'state', s: { p: [smp.x, 0.7, smp.z], q: [0, 0, 0, 1], v: [smp.tx * car.speed, 0, smp.tz * car.speed], wh: new Array(12).fill(0), b: 0 } });
      }
      room.update();
    }
  };
  return { room, join, idOf, wait, drive, park, go, together, now: () => time };
}

const quali = (format: SessionInfo['qualifying']): SessionInfo => ({ kind: 'qualifying', laps: 3, qualifying: format, endsAt: 0, round: null });
const race = (kind: 'sprint' | 'race', laps: number): SessionInfo => ({ kind, laps, qualifying: null, endsAt: 0, round: null });

describe('Room sessions', () => {
  it('timed qualifying: best lap orders the grid; a lap under way at the flag may finish', () => {
    const { room, join, idOf, wait, drive, park, go, now } = setup();
    const a = join('Ann');
    const b = join('Ben');
    const outcomes: SessionOutcome[] = [];
    expect(room.runSession({ session: quali({ mode: 'timed', minutes: 5 }), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a), idOf(b)] }, (o) => outcomes.push(o))).toBeNull();
    go();
    const endsAt = a.last('race').race.session.endsAt;
    expect(endsAt).toBeGreaterThan(0);
    // Ann: out lap + one flying lap, then parks.
    drive(a, -5, track.length * 2 + 10, 45);
    park(a);
    // Ben: idle, then starts a lap shortly before the flag and finishes it after.
    wait(endsAt - now() - 15_000);
    drive(b, -5, track.length + 10, 40);
    expect(outcomes).toHaveLength(1);
    const o = outcomes[0]!;
    expect(o.kind).toBe('qualifying');
    expect(o.classification.map((r) => r.playerId)).toEqual([idOf(a), idOf(b)]);
    expect(o.classification[0]!.bestLapMs).toBeLessThan(o.classification[1]!.bestLapMs!);
    expect(a.last('race').race.phase).toBe('results');
  });

  it('qualifying results are not DNFs', () => {
    const { room, join, idOf, drive, wait, go } = setup();
    const a = join('Ann');
    room.runSession({ session: quali({ mode: 'timed', minutes: 5 }), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a)] }, () => {});
    go();
    drive(a, -5, track.length * 2 + 10, 45);
    wait(5 * 60_000);
    expect(a.last('race').race.phase).toBe('results');
    expect(a.last('standings').standings.map((s) => s.dnf)).toEqual([false]);
  });

  it('after the flag only laps under way at the flag count, and only cars moving at the flag can extend the session', () => {
    const { room, join, idOf, go, together, wait, now } = setup();
    const a = join('Ann');
    const b = join('Ben');
    const done: SessionOutcome[] = [];
    room.runSession({ session: quali({ mode: 'timed', minutes: 5 }), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a), idOf(b)] }, (o) => done.push(o));
    go();
    const endsAt = a.last('race').race.session.endsAt;
    // Both sit on the grid until 5 s before the flag; then Ben sets off on a slow lap, Ann stays parked.
    const ann = { c: a, s: -5, speed: 0 };
    const ben = { c: b, s: -5, speed: 0 };
    together([ann, ben], (endsAt - now() - 5000) / 1000);
    ben.speed = 22;
    together([ann, ben], 6); // Ben is moving when the flag falls, Ann isn't
    // After the flag Ann drives a fast lap (started after the flag) and keeps going; Ben finishes his.
    ann.speed = 60;
    for (let t = 0; t < 120 && !done.length; t++) together([ann, ben], 1);
    expect(done).toHaveLength(1);
    const ids = done[0]!.classification;
    expect(ids.find((r) => r.playerId === idOf(b))!.bestLapMs).not.toBeNull();
    expect(ids.find((r) => r.playerId === idOf(a))!.bestLapMs).toBeNull();
    void wait;
  });

  it('timed qualifying ends at the flag when nobody is on a lap', () => {
    const { room, join, idOf, wait, go } = setup();
    const a = join('Ann');
    const done: SessionOutcome[] = [];
    room.runSession({ session: quali({ mode: 'timed', minutes: 5 }), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a)] }, (o) => done.push(o));
    go();
    wait(5 * 60_000 + 1000);
    expect(done).toHaveLength(1);
    expect(done[0]!.classification).toEqual([expect.objectContaining({ playerId: idOf(a), bestLapMs: null, position: 1 })]);
  });

  it('one-shot qualifying: only the second lap counts, ends when everyone has done it', () => {
    const { room, join, idOf, drive, go } = setup();
    const a = join('Ann');
    const b = join('Ben');
    const done: SessionOutcome[] = [];
    room.runSession({ session: quali({ mode: 'oneShot' }), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a), idOf(b)] }, (o) => done.push(o));
    go();
    drive(a, -5, track.length * 2 + 10, 50); // fast out lap, fast flying lap
    expect(done).toHaveLength(0);
    drive(b, -5, track.length * 2 + 10, 40);
    expect(done).toHaveLength(1);
    expect(done[0]!.classification.map((r) => r.playerId)).toEqual([idOf(a), idOf(b)]);
  });

  it('sprint runs a third of the laps; the grid follows the entrant order; non-entrants spectate', () => {
    const { room, join, idOf, drive, go } = setup();
    const a = join('Ann');
    const b = join('Ben');
    const watcher = join('Guest');
    const done: SessionOutcome[] = [];
    room.runSession({ session: race('sprint', 3), trackId: APEX_PARK.id, tyreWear: 'off', entrants: [idOf(b), idOf(a)] }, (o) => done.push(o));
    const roster = watcher.last('roster').players;
    expect(roster.find((p) => p.id === idOf(b))).toMatchObject({ gridSlot: 0, entrant: true });
    expect(roster.find((p) => p.id === idOf(a))).toMatchObject({ gridSlot: 1, entrant: true });
    expect(roster.find((p) => p.id === idOf(watcher))).toMatchObject({ gridSlot: null, entrant: false });
    expect(watcher.last('race').race).toMatchObject({ laps: 1, tyreWear: 'off', session: { kind: 'sprint', laps: 1 } });
    go();
    // The spectator's states are neither counted nor relayed.
    drive(watcher, -5, 200);
    expect(a.inbox.some((m) => m.t === 'snapshot' && m.cars.some((c) => c.id === idOf(watcher)))).toBe(false);
    drive(a, -5, track.length + 20, 48);
    drive(b, -5, track.length + 20, 45); // within the finish grace after Ann
    expect(done).toHaveLength(1);
    expect(done[0]!.classification.map((r) => [r.playerId, r.position, r.dnf])).toEqual([
      [idOf(a), 1, false],
      [idOf(b), 2, false],
    ]);
  });

  it('a driver who leaves and rejoins during qualifying keeps their lap', () => {
    const { room, join, idOf, drive, go, wait } = setup();
    const a = join('Ann');
    const done: SessionOutcome[] = [];
    room.runSession({ session: quali({ mode: 'timed', minutes: 5 }), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a)] }, (o) => done.push(o));
    go();
    drive(a, -5, track.length * 2 + 10, 45);
    const id = idOf(a);
    const session = a.last('welcome').sessionId;
    room.disconnect(a);
    const back = join('Ann', session);
    expect(idOf(back)).toBe(id);
    wait(5 * 60_000);
    expect(done[0]!.classification[0]!.bestLapMs).not.toBeNull();
  });

  it('a session the host abandons reports nothing', () => {
    const { room, join, idOf, go } = setup();
    const a = join('Ann');
    const done: SessionOutcome[] = [];
    room.runSession({ session: race('race', 3), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a)] }, (o) => done.push(o));
    go();
    room.handle(a, { t: 'endRace' });
    expect(a.last('race').race.phase).toBe('lobby');
    expect(done).toHaveLength(0);
  });

  it('when the host leaves mid-session the next player becomes host and can end it; nothing is reported', () => {
    const { room, join, idOf, go } = setup();
    const a = join('Ann');
    const b = join('Ben');
    const done: SessionOutcome[] = [];
    room.runSession({ session: race('race', 3), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a), idOf(b)] }, (o) => done.push(o));
    go();
    room.disconnect(a);
    expect(b.last('roster').hostId).toBe(idOf(b));
    room.handle(b, { t: 'endRace' });
    expect(b.last('race').race.phase).toBe('lobby');
    expect(done).toHaveLength(0);
  });

  it('refuses unknown tracks and a session while one is running', () => {
    const { room, join, idOf } = setup();
    const a = join('Ann');
    expect(room.runSession({ session: race('race', 3), trackId: 'nowhere', tyreWear: 'normal', entrants: [idOf(a)] }, () => {})).toMatch(/track/);
    expect(room.runSession({ session: race('race', 3), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a)] }, () => {})).toBeNull();
    expect(room.runSession({ session: race('race', 3), trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [idOf(a)] }, () => {})).toMatch(/running/);
  });

  it('pit boxes give qualifying start places along the pit lane', () => {
    expect(track.pitBoxes.length).toBeGreaterThanOrEqual(8);
  });
});
