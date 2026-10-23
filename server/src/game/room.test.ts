import { describe, expect, it } from 'vitest';
import {
  APEX_PARK,
  CONNECTION_TIMEOUT_MS,
  RACE,
  buildTrack,
  presetLivery,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  REJOIN_GRACE_MS,
  type CarState,
  type ProfileSummary,
  type S2C,
} from '@apex/shared';
import type { RaceInput } from '../db/database.ts';
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

  it('gives new players the preset livery of their colour and keeps a custom one', () => {
    const { room, join } = setup();
    const a = join('Ann', 3);
    expect(a.last('roster').players[0]!.livery).toEqual(presetLivery(3));
    const custom = { primary: 0x102030, secondary: 0xffffff, accent: 0x00ff00, number: 77 };
    room.handle(a, { t: 'profile', name: 'Ann', color: 3, livery: custom });
    expect(a.last('roster').players[0]!.livery).toEqual(custom);
    // A bad field is replaced; the rest stays.
    room.handle(a, { t: 'profile', name: 'Ann', color: 3, livery: { ...custom, number: 1000, accent: -5 } });
    expect(a.last('roster').players[0]!.livery).toEqual(custom);
    // Changing colour without sending a livery takes that colour's preset, keeping the number.
    room.handle(a, { t: 'profile', name: 'Ann', color: 5 });
    expect(a.last('roster').players[0]!.livery).toEqual({ ...presetLivery(5), number: 77 });
  });

  it('lets players pick a tyre compound in the lobby only, and the host set tyre wear', () => {
    const { room, join, advance } = setup();
    const host = join('Ann');
    const guest = join('Ben');
    expect(host.last('roster').players.map((p) => p.tyre)).toEqual(['medium', 'medium']);
    room.handle(guest, { t: 'profile', name: 'Ben', color: 1, tyre: 'soft' });
    expect(guest.last('roster').players[1]!.tyre).toBe('soft');
    room.handle(guest, { t: 'profile', name: 'Ben', color: 1, tyre: 'slick' as never });
    expect(guest.last('roster').players[1]!.tyre).toBe('soft');

    room.handle(guest, { t: 'setTyreWear', wear: 'high' });
    expect(guest.inbox.some((m) => m.t === 'race' && m.race.tyreWear === 'high')).toBe(false);
    room.handle(host, { t: 'setTyreWear', wear: 'off' });
    expect(guest.last('race').race.tyreWear).toBe('off');

    room.handle(host, { t: 'start' });
    advance(COUNTDOWN_MS + 10);
    room.update();
    room.handle(guest, { t: 'profile', name: 'Ben', color: 1, tyre: 'hard' });
    expect(guest.last('roster').players[1]!.tyre).toBe('soft');
  });

  it('lets the host pick a track in the lobby, which also sets its default laps', () => {
    const second = { ...APEX_PARK, id: 'second', name: 'Second', laps: 7 };
    const room = new Room({
      now: () => 0,
      tracks: { list: () => [], get: (id) => (id === APEX_PARK.id ? APEX_PARK : id === 'second' ? second : null) },
    });
    const host = new FakeConn();
    const guest = new FakeConn();
    room.handle(host, { t: 'hello', sessionId: null, name: 'Ann', color: 0 });
    room.handle(guest, { t: 'hello', sessionId: null, name: 'Ben', color: 1 });
    expect(guest.last('welcome').race.trackId).toBe(APEX_PARK.id);
    room.handle(guest, { t: 'setTrack', trackId: 'second' });
    expect(guest.inbox.some((m) => m.t === 'race' && m.race.trackId === 'second')).toBe(false);
    room.handle(host, { t: 'setTrack', trackId: 'nowhere' });
    expect(guest.inbox.some((m) => m.t === 'race')).toBe(false);
    room.handle(host, { t: 'setTrack', trackId: 'second' });
    expect(guest.last('race').race).toMatchObject({ trackId: 'second', laps: 7 });
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
      const s = (((startS + d) % track.length) + track.length) % track.length;
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

describe('Room with profiles', () => {
  const ann = { id: 1, name: 'Ann', tag: 'ANN', livery: { ...presetLivery(4), number: 11 }, photo: '/photos/a.webp' };
  const ben = { id: 2, name: 'Ben', tag: 'BEN', livery: presetLivery(5), photo: null };
  const tokens: Record<string, ProfileSummary> = { 'token-ann-0123456789': ann, 'token-ben-0123456789': ben };

  function setupProfiles() {
    let time = 1_000_000;
    const saved: [number, unknown][] = [];
    const races: RaceInput[] = [];
    const room = new Room({
      now: () => time,
      profiles: { byToken: (t) => tokens[t] ?? null, saveLivery: (id, l) => saved.push([id, l]) },
      results: { recordRace: (r) => races.push(r) },
    });
    const join = (name: string, token: string | null = null) => {
      const c = new FakeConn();
      room.handle(c, { t: 'hello', sessionId: null, name, color: 0, token });
      return c;
    };
    return { room, join, saved, races, advance: (ms: number) => (time += ms) };
  }

  it('logs players in with a token: name, tag, photo and livery come from the profile', () => {
    const { join } = setupProfiles();
    const a = join('whatever', 'token-ann-0123456789');
    expect(a.last('auth')).toMatchObject({ ok: true, profile: { id: 1 } });
    const guest = join('Guest Person');
    const roster = guest.last('roster').players;
    expect(roster[0]).toMatchObject({ name: 'Ann', tag: 'ANN', photo: '/photos/a.webp', profileId: 1, livery: { number: 11 } });
    expect(roster[1]).toMatchObject({ name: 'Guest Person', tag: 'GUE', photo: null, profileId: null });
  });

  it('refuses unknown tokens and a profile that is already driving', () => {
    const { join, room } = setupProfiles();
    expect(join('X', 'token-nobody-0123456789').last('auth')).toMatchObject({ ok: false, profile: null });
    join('A', 'token-ann-0123456789');
    const twin = join('A2');
    room.handle(twin, { t: 'auth', token: 'token-ann-0123456789' });
    expect(twin.last('auth')).toMatchObject({ ok: false });
    room.handle(twin, { t: 'auth', token: 'token-ben-0123456789' });
    expect(twin.last('auth')).toMatchObject({ ok: true, profile: { name: 'Ben' } });
    room.handle(twin, { t: 'auth', token: null });
    const me = twin.last('welcome').playerId;
    expect(twin.last('roster').players.find((p) => p.id === me)).toMatchObject({ profileId: null });
  });

  it('keeps the profile name, saves livery edits to the profile, and follows profile updates', () => {
    const { join, room, saved } = setupProfiles();
    const a = join('A', 'token-ann-0123456789');
    room.handle(a, { t: 'profile', name: 'Renamed', color: 0, livery: { ...ann.livery, number: 22 } });
    expect(a.last('roster').players[0]).toMatchObject({ name: 'Ann', livery: { number: 22 } });
    expect(saved).toEqual([[1, expect.objectContaining({ number: 22 })]]);
    room.profileUpdated({ ...ann, tag: 'AAA', photo: '/photos/b.webp' });
    expect(a.last('roster').players[0]).toMatchObject({ tag: 'AAA', photo: '/photos/b.webp' });
  });

  it('records the finished race: places, points, fastest lap, and every lap of profiled drivers', () => {
    const { join, room, races, advance } = setupProfiles();
    const a = join('A', 'token-ann-0123456789');
    const g = join('Guest');
    room.handle(a, { t: 'setLaps', laps: 1 });
    room.handle(a, { t: 'start' });
    advance(COUNTDOWN_MS + 10);
    room.update();
    // Ann laps the track at 40 m/s; the guest stays put and becomes a DNF when results come.
    const track = buildTrack(APEX_PARK);
    const step = track.samples[1]!.s;
    for (let d = 0; d < track.length + 30; d += 40 / 30) {
      const s = (((d - 15) % track.length) + track.length) % track.length;
      const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
      advance(1000 / 30);
      room.handle(a, { t: 'state', s: { ...STATE, p: [smp.x, 0.7, smp.z] } });
      room.handle(g, { t: 'ping', clientTime: 0 });
      room.update();
    }
    advance(RACE.finishGraceMs + 10);
    room.handle(g, { t: 'ping', clientTime: 0 });
    room.update();
    expect(races).toHaveLength(1);
    const race = races[0]!;
    expect(race).toMatchObject({ trackId: APEX_PARK.id, laps: 1 });
    expect(race.results).toEqual([
      expect.objectContaining({ profileId: 1, position: 1, dnf: false, points: RACE.points[0], fastestLap: true, laps: 1, grid: 1 }),
      expect.objectContaining({ profileId: null, position: 2, dnf: true, points: 0 }),
    ]);
    expect(race.lapTimes).toHaveLength(1);
    expect(race.lapTimes[0]).toMatchObject({ profileId: 1, lap: 1 });
    expect(race.lapTimes[0]!.sectors).toHaveLength(3);
  });

  it('stores a lap with a respawn jump as invalid', () => {
    const { join, room, races, advance } = setupProfiles();
    const a = join('A', 'token-ann-0123456789');
    room.handle(a, { t: 'setLaps', laps: 1 });
    room.handle(a, { t: 'start' });
    advance(COUNTDOWN_MS + 10);
    room.update();
    const track = buildTrack(APEX_PARK);
    const step = track.samples[1]!.s;
    const at = (s: number) => track.samples[Math.floor((((s % track.length) + track.length) % track.length) / step) % track.samples.length]!;
    const feed = (from: number, metres: number) => {
      for (let d = 0; d < metres; d += 40 / 30) {
        const smp = at(from + d);
        advance(1000 / 30);
        room.handle(a, { t: 'state', s: { ...STATE, p: [smp.x, 0.7, smp.z] } });
        room.update();
      }
    };
    feed(-15, track.length / 2); // half a lap…
    feed(track.length / 2 - 15 - 80, track.length / 2 + 110); // …respawn 80 m back, then to the line
    advance(RACE.finishGraceMs + 10);
    room.update();
    expect(races).toHaveLength(1);
    expect(races[0]!.lapTimes).toEqual([expect.objectContaining({ lap: 1, valid: false })]);
  });
});

