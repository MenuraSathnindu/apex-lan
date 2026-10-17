import { describe, expect, it } from 'vitest';
import {
  APEX_PARK,
  CONNECTION_TIMEOUT_MS,
  RACE,
  buildTrack,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  REJOIN_GRACE_MS,
  type CarState,
  type S2C,
} from '@apex/shared';
import { Room, type Connection } from './room.ts';

class FakeConn implements Connection {
  inbox: S2C[] = [];
  closed = false;
  send(msg: S2C) {
    this.inbox.push(msg);
  }
  close() {
    this.closed = true;
  }
  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> {
    const m = [...this.inbox].reverse().find((x) => x.t === t);
    if (!m) throw new Error(`no ${t} message`);
    return m as Extract<S2C, { t: T }>;
  }
}

function setup() {
  let time = 1_000_000;
  const room = new Room({ now: () => time });
  const advance = (ms: number) => {
    time += ms;
  };
  const join = (name: string, color = 0, sessionId: string | null = null) => {
    const c = new FakeConn();
    room.handle(c, { t: 'hello', sessionId, name, color });
    return c;
  };
  return { room, advance, join };
}

const STATE: CarState = { p: [1, 2, 3], q: [0, 0, 0, 1], v: [0, 0, 5], wh: new Array(12).fill(0), b: 0 };

describe('Room', () => {
  it('welcomes players with unique ids, slots and colours; first is host', () => {
    const { join } = setup();
    const a = join('Ann', 2);
    const b = join('Ben', 2); // wants the same colour
    const wa = a.last('welcome');
    const wb = b.last('welcome');
    expect(wa.hostId).toBe(wa.playerId);
    expect(wb.hostId).toBe(wa.playerId);
    const roster = b.last('roster').players;
    expect(roster.map((p) => p.name)).toEqual(['Ann', 'Ben']);
    expect(new Set(roster.map((p) => p.slot)).size).toBe(2);
    expect(roster[0]!.color).toBe(2);
    expect(roster[1]!.color).not.toBe(2);
  });

  it(`accepts ${MAX_PLAYERS} players and turns away the next`, () => {
    const { join } = setup();
    for (let i = 0; i < MAX_PLAYERS; i++) expect(join(`P${i}`).last('welcome')).toBeTruthy();
    const extra = join('Late');
    expect(extra.inbox.some((m) => m.t === 'full')).toBe(true);
    expect(extra.closed).toBe(true);
  });

  it('sanitises names', () => {
    const { join } = setup();
    const a = join('  \u0007Zed the very long name indeed  ');
    expect(a.last('roster').players[0]!.name).toBe('Zed the very lon');
  });

  it('lets a player rejoin within the grace period with the same id and slot', () => {
    const { room, advance, join } = setup();
    const a = join('Ann');
    join('Ben');
    const { playerId, sessionId } = a.last('welcome');
    const slot = a.last('roster').players.find((p) => p.id === playerId)!.slot;

    room.disconnect(a);
    advance(REJOIN_GRACE_MS - 1000);
    room.update();
    const a2 = join('Ann', 0, sessionId);
    const w = a2.last('welcome');
    expect(w.playerId).toBe(playerId);
    expect(w.players.find((p) => p.id === playerId)).toMatchObject({ slot, connected: true });
  });

  it('frees the slot after the grace period', () => {
    const { room, advance, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    const { sessionId } = a.last('welcome');
    room.disconnect(a);
    for (let t = 0; t < REJOIN_GRACE_MS + 1000; t += 500) {
      advance(500);
      room.handle(b, { t: 'ping', clientTime: 0 }); // keep Ben alive
      room.update();
    }
    expect(b.last('roster').players.map((p) => p.name)).toEqual(['Ben']);
    const a2 = join('Ann', 0, sessionId);
    expect(a2.last('welcome').playerId).not.toBe(a.last('welcome').playerId);
  });

  it('treats a duplicated tab (same session, original still live) as a new player', () => {
    const { join } = setup();
    const a = join('Ann');
    const dup = join('Ann', 0, a.last('welcome').sessionId);
    expect(dup.last('welcome').playerId).not.toBe(a.last('welcome').playerId);
    expect(a.closed).toBe(false);
  });

  it('hands host to the next player when the host leaves', () => {
    const { room, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    room.disconnect(a);
    expect(b.last('roster').hostId).toBe(b.last('welcome').playerId);
  });

  it('gives host back to the original host when they rejoin', () => {
    const { room, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    room.disconnect(a);
    const a2 = join('Ann', 0, a.last('welcome').sessionId);
    expect(b.last('roster').hostId).toBe(a2.last('welcome').playerId);
  });

  it('only the host can start; countdown then racing; host can end', () => {
    const { room, advance, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    room.handle(b, { t: 'start' });
    expect(b.inbox.some((m) => m.t === 'race')).toBe(false);

    room.handle(a, { t: 'start' });
    expect(b.last('race').race).toMatchObject({ phase: 'countdown', raceId: 1 });
    advance(COUNTDOWN_MS + 10);
    room.handle(a, { t: 'ping', clientTime: 0 });
    room.handle(b, { t: 'ping', clientTime: 0 });
    room.update();
    expect(b.last('race').race.phase).toBe('racing');

    room.handle(a, { t: 'endRace' });
    expect(b.last('race').race.phase).toBe('lobby');
  });

  it('relays fresh car states to everyone, once', () => {
    const { room, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    room.handle(a, { t: 'state', s: STATE });
    room.update();
    const snap = b.last('snapshot');
    expect(snap.cars).toHaveLength(1);
    expect(snap.cars[0]).toMatchObject({ id: a.last('welcome').playerId, p: [1, 2, 3] });

    const count = b.inbox.filter((m) => m.t === 'snapshot').length;
    room.update(); // nothing new
    expect(b.inbox.filter((m) => m.t === 'snapshot').length).toBe(count);
  });

  it('ignores malformed states', () => {
    const { room, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    room.handle(a, { t: 'state', s: { ...STATE, p: [NaN, 0, 0] } });
    room.handle(a, { t: 'state', s: { ...STATE, wh: [1, 2] } });
    room.update();
    expect(b.inbox.some((m) => m.t === 'snapshot')).toBe(false);
  });

  it('drops connections that go silent', () => {
    const { room, advance, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    advance(CONNECTION_TIMEOUT_MS + 100);
    room.handle(b, { t: 'ping', clientTime: 0 });
    room.update();
    expect(a.closed).toBe(true);
    expect(b.last('roster').players.find((p) => p.name === 'Ann')!.connected).toBe(false);
  });

  it('keeps a connection alive on heartbeat pongs alone (background tab)', () => {
    const { room, advance, join } = setup();
    const a = join('Ann');
    for (let t = 0; t < CONNECTION_TIMEOUT_MS * 3; t += 2000) {
      advance(2000);
      room.touch(a);
      room.update();
    }
    expect(a.closed).toBe(false);
  });

  it('resumes a mid-race rejoiner at their last state', () => {
    const { room, join } = setup();
    const a = join('Ann');
    room.handle(a, { t: 'start' });
    room.handle(a, { t: 'state', s: STATE });
    room.disconnect(a);
    const a2 = join('Ann', 0, a.last('welcome').sessionId);
    expect(a2.last('welcome').resume).toMatchObject({ p: [1, 2, 3] });
  });

  it('lets only the host set laps, in the lobby, clamped', () => {
    const { room, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    room.handle(b, { t: 'setLaps', laps: 5 });
    expect(b.inbox.some((m) => m.t === 'race')).toBe(false);
    room.handle(a, { t: 'setLaps', laps: 99 });
    expect(b.last('race').race.laps).toBe(RACE.maxLaps);
    room.handle(a, { t: 'setLaps', laps: 0 });
    expect(b.last('race').race.laps).toBe(RACE.minLaps);
  });

  it('runs a full race: laps counted from states, results when everyone finishes, back to lobby', () => {
    const { room, advance, join } = setup();
    const a = join('Ann');
    const b = join('Ben');
    room.handle(a, { t: 'setLaps', laps: 1 });
    room.handle(a, { t: 'start' });
    advance(COUNTDOWN_MS + 10);
    room.update();
    expect(b.last('race').race.phase).toBe('racing');

    // Ann drives one full lap along the centreline at 40 m/s, 30 states per second.
    const track = buildTrack(APEX_PARK);
    const step = track.samples[1]!.s;
    const startS = track.samples[track.startIndex]!.s - 15;
    for (let d = 0; d < track.length + 30; d += 40 / 30) {
      const s = (startS + d) % track.length;
      const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
      advance(1000 / 30);
      room.handle(a, { t: 'state', s: { ...STATE, p: [smp.x, 0.7, smp.z] } });
      room.handle(b, { t: 'ping', clientTime: 0 });
      room.update();
    }
    const lap = b.last('lap').e;
    expect(lap).toMatchObject({ lap: 1, finished: true });
    expect(b.last('race').race.finishDeadline).toBeGreaterThan(0);
    expect(b.last('race').race.phase).toBe('racing'); // Ben hasn't finished yet

    // Ben leaves → everyone still connected has finished → results.
    room.disconnect(b);
    room.handle(a, { t: 'ping', clientTime: 0 });
    room.update();
    expect(a.last('race').race.phase).toBe('results');
    const final = a.last('standings').standings;
    expect(final[0]).toMatchObject({ id: a.last('welcome').playerId, pos: 1, laps: 1, dnf: false });
    expect(final[1]!.dnf).toBe(true);

    room.handle(a, { t: 'endRace' });
    expect(a.last('race').race.phase).toBe('lobby');
  });

  it('cannot fake a lap by reporting positions that skip the track', () => {
    const { room, advance, join } = setup();
    const a = join('Ann');
    room.handle(a, { t: 'setLaps', laps: 1 });
    room.handle(a, { t: 'start' });
    advance(COUNTDOWN_MS + 10);
    room.update();
    const track = buildTrack(APEX_PARK);
    const st = track.samples[track.startIndex]!;
    // Hop back and forth across the finish line only.
    for (let i = 0; i < 20; i++) {
      advance(1000 / 30);
      const k = i % 2 === 0 ? -2 : 2;
      room.handle(a, { t: 'state', s: { ...STATE, p: [st.x + st.tx * k, 0.7, st.z + st.tz * k] } });
      room.update();
    }
    expect(a.inbox.some((m) => m.t === 'lap')).toBe(false);
  });
});
