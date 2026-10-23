// A whole (short) season through the real room, runner and database, with simulated drivers.
import { describe, expect, it } from 'vitest';
import { APEX_PARK, COUNTDOWN_MS, buildTrack, computeStandings, presetLivery, type CarState, type S2C } from '@apex/shared';
import { ChampionshipDb } from '../db/championships.ts';
import { PlayerDb } from '../db/database.ts';
import { Room, type Connection } from './room.ts';

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

describe('a championship season, end to end', () => {
  it('runs two rounds (one sprint weekend), scores them and crowns the champion', () => {
    let time = 5_000_000;
    const db = new PlayerDb(':memory:');
    const champs = new ChampionshipDb(db);
    const room = new Room({
      now: () => time,
      profiles: {
        byToken: (t) => {
          const p = db.profileForToken(t);
          return p && PlayerDb.summary(p);
        },
        saveLivery: (id, l) => db.setLivery(id, l),
      },
      results: { recordRace: (r) => db.recordRace(r) },
      championships: champs,
    });
    const ann = db.createProfile('Ann', 'ANN', presetLivery(0), 'h');
    const ben = db.createProfile('Ben', 'BEN', presetLivery(1), 'h');
    const conns: FakeConn[] = [];
    const join = (token: string) => {
      const c = new FakeConn();
      room.handle(c, { t: 'hello', sessionId: null, name: 'x', color: conns.length, token });
      conns.push(c);
      return c;
    };
    const a = join(db.issueToken(ann.id));
    const b = join(db.issueToken(ben.id));
    const tick = (ms: number) => {
      time += ms;
      for (const c of conns) room.handle(c, { t: 'ping', clientTime: 0 });
      room.update();
    };
    const drive = (c: FakeConn, metres: number, speed: number) => {
      for (let d = 0; d <= metres; d += (speed * 1000) / 30 / 1000) {
        const s = (((d - 5) % track.length) + track.length) % track.length;
        const smp = track.samples[Math.floor(s / step) % track.samples.length]!;
        time += 1000 / 30;
        const state: CarState = { p: [smp.x, 0.7, smp.z], q: [0, 0, 0, 1], v: [smp.tx * speed, 0, smp.tz * speed], wh: new Array(12).fill(0), b: 0 };
        room.handle(c, { t: 'state', s: state });
        for (const o of conns) if (o !== c) room.handle(o, { t: 'ping', clientTime: 0 });
        room.update();
      }
    };
    const startNext = () => {
      room.handle(a, { t: 'champStartSession' });
      expect(a.last('race').race.phase).toBe('countdown');
      for (let t = 0; t < COUNTDOWN_MS + 100; t += 100) tick(100);
    };
    const view = () => a.last('champ').view!;

    room.handle(a, {
      t: 'champCreate',
      draft: {
        name: 'Two-round cup',
        settings: { laps: 3, qualifying: { mode: 'oneShot' }, fastestLapPoint: false, tyreWear: true },
        rounds: [
          { trackId: APEX_PARK.id, sprint: true },
          { trackId: APEX_PARK.id, sprint: false },
        ],
      },
    });
    room.handle(a, { t: 'champEnter' });
    room.handle(b, { t: 'champEnter' });
    expect(view().entries.map((e) => e.profile.name)).toEqual(['Ann', 'Ben']);

    const runWeekend = (sprint: boolean) => {
      // Qualifying (one-shot): out lap + flying lap; Ann is faster.
      startNext();
      drive(a, track.length * 2 + 20, 50);
      drive(b, track.length * 2 + 20, 40);
      expect(a.last('race').race.phase).toBe('results');
      if (sprint) {
        startNext();
        expect(a.last('race').race.laps).toBe(1);
        drive(a, track.length + 20, 50);
        drive(b, track.length + 20, 48);
      }
      // Race: Ann wins; Ben is still out there when the finish grace runs out.
      startNext();
      drive(a, track.length * 3 + 20, 50);
      drive(b, track.length * 3 + 20, 45);
      for (let t = 0; t < 35_000; t += 500) tick(500);
      expect(a.last('race').race.phase).toBe('results');
    };

    runWeekend(true);
    expect(view().next).toEqual({ round: 2, session: 'qualifying' });
    runWeekend(false);

    const final = view();
    expect(final.status).toBe('finished');
    expect(final.championId).toBe(ann.id);
    const standings = computeStandings(final);
    expect(standings.drivers.map((d) => [d.profile.name, d.points])).toEqual([
      ['Ann', 58],
      ['Ben', 7],
    ]);
    // Career: Ann has two race wins from pole and one title; the stored season agrees.
    expect(db.stats(ann.id)).toMatchObject({ races: 2, wins: 2, poles: 2, championships: 1 });
    expect(champs.view(final.id)!.status).toBe('finished');
    // A finished season can't run more sessions.
    room.handle(a, { t: 'champStartSession' });
    expect(a.last('notice').text).toMatch(/finished/);
  });
});
