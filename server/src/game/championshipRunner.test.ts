import { describe, expect, it } from 'vitest';
import { APEX_PARK, presetLivery, type ChampionshipView, type ProfileSummary, type S2C, type SeasonDraft } from '@apex/shared';
import { ChampionshipDb } from '../db/championships.ts';
import { PlayerDb } from '../db/database.ts';
import { builtInTracks } from '../tracks/catalog.ts';
import { ChampionshipRunner, type RoomControl } from './championshipRunner.ts';
import type { SessionOutcome, SessionSpec } from './room.ts';

const HOST = 1;
const draft = (over: Partial<SeasonDraft> = {}): SeasonDraft => ({
  name: 'Cup',
  settings: { laps: 3, qualifying: { mode: 'timed', minutes: 5 }, fastestLapPoint: true, tyreWear: true },
  rounds: [
    { trackId: APEX_PARK.id, sprint: true },
    { trackId: APEX_PARK.id, sprint: false },
  ],
  ...over,
});

function setup() {
  const players = new PlayerDb(':memory:');
  const store = new ChampionshipDb(players);
  const profiles: ProfileSummary[] = ['Ann', 'Ben', 'Cat'].map((n, i) => PlayerDb.summary(players.createProfile(n, n.toUpperCase(), presetLivery(i), 'h')));
  // Player ids 1..3 are logged in as Ann, Ben, Cat; player 4 is a guest.
  const online = new Map<number, ProfileSummary | null>([
    [1, profiles[0]!],
    [2, profiles[1]!],
    [3, profiles[2]!],
    [4, null],
  ]);
  const sent: { to: number | 'all'; msg: S2C }[] = [];
  const runs: { spec: SessionSpec; onDone: (o: SessionOutcome) => void }[] = [];
  let refuse: string | null = null;
  const room: RoomControl = {
    runSession: (spec, onDone) => {
      if (refuse) return refuse;
      runs.push({ spec, onDone });
      return null;
    },
    broadcast: (msg) => sent.push({ to: 'all', msg }),
    sendTo: (to, msg) => sent.push({ to, msg }),
    notifyHost: (text) => sent.push({ to: HOST, msg: { t: 'notice', text } }),
    isHost: (id) => id === HOST,
    connectedProfiles: () => [...online].flatMap(([playerId, profile]) => (profile ? [{ playerId, profile }] : [])),
    profileOf: (id) => online.get(id) ?? null,
    now: () => 1000,
  };
  const runner = new ChampionshipRunner(room, store, builtInTracks(), () => {});
  const notices = (to: number) => sent.filter((s) => s.to === to && s.msg.t === 'notice').map((s) => (s.msg as { text: string }).text);
  const view = () => runner.current as ChampionshipView;
  /** Finishes the last started session with the given finishing order (player ids). */
  const finish = (order: number[], fastest: number | null = null, dnf: number[] = []) => {
    const run = runs.at(-1)!;
    run.onDone({
      kind: run.spec.session.kind,
      classification: order.map((playerId, i) => ({ playerId, position: i + 1, dnf: dnf.includes(playerId), bestLapMs: 60_000 + i, laps: 3, totalMs: 1000 + i })),
      fastestLapId: fastest,
      lapsOf: (id) => [{ lap: 1, time: 60_000 + id, sectors: null, valid: true }],
    });
  };
  return { players, store, profiles, runner, room, runs, sent, notices, view, finish, online, refuse: (r: string | null) => (refuse = r) };
}

describe('ChampionshipRunner', () => {
  it('only the host creates, loads and starts; players enter themselves; guests cannot', () => {
    const t = setup();
    t.runner.handle(2, { t: 'champCreate', draft: draft() });
    expect(t.notices(2)).toHaveLength(1);
    t.runner.handle(HOST, { t: 'champCreate', draft: draft() });
    expect(t.view()).toMatchObject({ name: 'Cup', status: 'setup' });
    expect(t.sent.some((s) => s.to === 'all' && s.msg.t === 'champ')).toBe(true);
    t.runner.handle(4, { t: 'champEnter' });
    expect(t.notices(4)[0]).toMatch(/log in/i);
    t.runner.handle(2, { t: 'champEnter' });
    t.runner.handle(HOST, { t: 'champEnter' });
    expect(t.view().entries.map((e) => e.profile.name)).toEqual(['Ben', 'Ann']);
    t.runner.handle(2, { t: 'champStartSession' });
    expect(t.runs).toHaveLength(0);
  });

  it('rejects a bad season draft with a reason', () => {
    const t = setup();
    t.runner.handle(HOST, { t: 'champCreate', draft: draft({ rounds: [{ trackId: 'nowhere', sprint: false }] }) });
    expect(t.notices(HOST)[0]).toMatch(/track/);
    expect(t.runner.current).toBeNull();
  });

  it('teams: create, join up to two, unique names, locked once the season starts', () => {
    const t = setup();
    t.runner.handle(HOST, { t: 'champCreate', draft: draft() });
    for (const id of [1, 2, 3]) t.runner.handle(id, { t: 'champEnter' });
    t.runner.handle(1, { t: 'champTeamCreate', name: 'Red', primary: 0xff0000, secondary: 0xffffff });
    const red = t.view().teams[0]!;
    t.runner.handle(2, { t: 'champTeamCreate', name: 'red', primary: 0, secondary: 0 });
    expect(t.notices(2)[0]).toMatch(/name/);
    t.runner.handle(2, { t: 'champTeamJoin', teamId: red.id });
    t.runner.handle(3, { t: 'champTeamJoin', teamId: red.id });
    expect(t.notices(3)[0]).toMatch(/full/);
    expect(t.view().entries.filter((e) => e.teamId === red.id)).toHaveLength(2);

    t.runner.handle(HOST, { t: 'champStartSession' });
    expect(t.view().status).toBe('active');
    t.runner.handle(2, { t: 'champTeamLeave' });
    expect(t.notices(2).at(-1)).toMatch(/locked/);
    // A teamless driver may still start a team after the start.
    t.runner.handle(3, { t: 'champTeamCreate', name: 'Blue', primary: 0x0000ff, secondary: 0xffffff });
    expect(t.view().entries.find((e) => e.profile.name === 'Cat')!.teamId).not.toBeNull();
    // The host can still move drivers.
    t.runner.handle(HOST, { t: 'champMoveDriver', profileId: t.profiles[1]!.id, teamId: null });
    expect(t.view().entries.find((e) => e.profile.name === 'Ben')!.teamId).toBeNull();
  });

  it('runs a weekend: qualifying grid → sprint → race with points; late entrant joins at the next round', () => {
    const t = setup();
    t.runner.handle(HOST, { t: 'champCreate', draft: draft() });
    t.runner.handle(1, { t: 'champEnter' });
    t.runner.handle(2, { t: 'champEnter' });

    t.runner.handle(HOST, { t: 'champStartSession' });
    expect(t.runs[0]!.spec).toMatchObject({ trackId: APEX_PARK.id, tyreWear: 'normal', entrants: [1, 2], session: { kind: 'qualifying', qualifying: { mode: 'timed', minutes: 5 }, round: { round: 1, rounds: 2 } } });
    t.finish([2, 1]);
    expect(t.view().next).toEqual({ round: 1, session: 'sprint' });

    t.runner.handle(HOST, { t: 'champStartSession' });
    expect(t.runs[1]!.spec.entrants).toEqual([2, 1]); // qualifying order
    expect(t.runs[1]!.spec.session).toMatchObject({ kind: 'sprint', laps: 3 });
    t.finish([1, 2]);

    t.runner.handle(3, { t: 'champEnter' }); // late entrant
    expect(t.view().entries.find((e) => e.profile.name === 'Cat')!.joinedRound).toBe(1);
    t.runner.handle(HOST, { t: 'champStartSession' });
    expect(t.runs[2]!.spec.entrants).toEqual([2, 1, 3]); // no qualifying time: at the back
    t.finish([1, 2, 3], 3); // Cat sets the fastest lap in P3 → +1

    const results = t.view().results.filter((r) => r.round === 1 && r.session !== 'qualifying');
    const pts = (session: string, name: string) => results.find((r) => r.session === session && r.profileId === t.profiles.find((p) => p.name === name)!.id)!.points;
    expect([pts('sprint', 'Ann'), pts('sprint', 'Ben'), pts('race', 'Ann'), pts('race', 'Ben'), pts('race', 'Cat')]).toEqual([8, 7, 25, 18, 16]);
    expect(t.view().next).toEqual({ round: 2, session: 'qualifying' });
    // Career: Ben was on pole for the race.
    expect(t.players.stats(t.profiles[1]!.id)).toMatchObject({ races: 1, poles: 1, points: 25 });
  });

  it('crowns the champion after the last race', () => {
    const t = setup();
    t.runner.handle(HOST, { t: 'champCreate', draft: draft({ rounds: [{ trackId: APEX_PARK.id, sprint: false }] }) });
    t.runner.handle(1, { t: 'champEnter' });
    t.runner.handle(2, { t: 'champEnter' });
    t.runner.handle(HOST, { t: 'champStartSession' });
    t.finish([1, 2]);
    t.runner.handle(HOST, { t: 'champStartSession' });
    t.finish([2, 1]);
    expect(t.view()).toMatchObject({ status: 'finished', championId: t.profiles[1]!.id, next: null });
    expect(t.players.stats(t.profiles[1]!.id).championships).toBe(1);
    t.runner.handle(HOST, { t: 'champStartSession' });
    expect(t.notices(HOST).at(-1)).toMatch(/finished/);
  });

  it('an abandoned session changes nothing; a refused start or a failed save tells the host', () => {
    const t = setup();
    t.runner.handle(HOST, { t: 'champCreate', draft: draft() });
    t.runner.handle(1, { t: 'champEnter' });
    t.runner.handle(HOST, { t: 'champStartSession' });
    // Abandoned: onDone never called.
    expect(t.view().next).toEqual({ round: 1, session: 'qualifying' });

    t.refuse('unknown track gone');
    t.runner.handle(HOST, { t: 'champStartSession' });
    expect(t.notices(HOST).at(-1)).toMatch(/unknown track/);
    t.refuse(null);

    t.runner.handle(HOST, { t: 'champStartSession' });
    t.store.writeSession = () => {
      throw new Error('disk full');
    };
    t.finish([1]);
    expect(t.notices(HOST).at(-1)).toMatch(/not saved/);
    expect(t.runner.current!.next).toEqual({ round: 1, session: 'qualifying' });
  });

  it('a host can resume a stored season', () => {
    const t = setup();
    t.runner.handle(HOST, { t: 'champCreate', draft: draft() });
    const id = t.view().id;
    t.runner.handle(HOST, { t: 'champClose' });
    expect(t.runner.current).toBeNull();
    t.runner.handle(HOST, { t: 'champList' });
    expect(t.sent.some((s) => s.to === HOST && s.msg.t === 'champList' && s.msg.seasons.length === 1)).toBe(true);
    t.runner.handle(HOST, { t: 'champLoad', id });
    expect(t.view().id).toBe(id);
  });
});
