import {
  CHAMPIONSHIP,
  computeStandings,
  fastestLapBonus,
  nextAfter,
  sanitizeSeasonDraft,
  sessionPoints,
  sprintLaps,
  type C2S,
  type ChampionshipView,
  type ProfileSummary,
  type S2C,
  type SeasonResult,
} from '@apex/shared';
import type { ChampionshipStore } from '../db/championships.ts';
import type { RaceInput } from '../db/database.ts';
import type { TrackProvider } from '../tracks/catalog.ts';
import type { SessionOutcome, SessionSpec } from './room.ts';

/** The part of the room the runner drives. */
export interface RoomControl {
  runSession(spec: SessionSpec, onDone: (outcome: SessionOutcome) => void): string | null;
  broadcast(msg: S2C): void;
  sendTo(playerId: number, msg: S2C): void;
  /** A notice to whoever is host right now. */
  notifyHost(text: string): void;
  isHost(playerId: number): boolean;
  /** Connected players who are logged in to a profile. */
  connectedProfiles(): { playerId: number; profile: ProfileSummary }[];
  profileOf(playerId: number): ProfileSummary | null;
  now(): number;
}

export type ChampMessage = Extract<C2S, { t: `champ${string}` }>;

const isColor = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff;

/**
 * Runs championship seasons in the room: season setup (entries, teams), each weekend's sessions
 * in order with the right grids, points and career records, and the finale. The season itself
 * lives in the store, so it survives restarts and can be resumed later.
 */
export class ChampionshipRunner {
  /** The season loaded in the room, or null. */
  current: ChampionshipView | null = null;

  constructor(
    private readonly room: RoomControl,
    private readonly store: ChampionshipStore,
    private readonly tracks: TrackProvider,
    private readonly log: (msg: string) => void,
  ) {}

  handle(playerId: number, msg: ChampMessage): void {
    const refuse = (text: string) => this.room.sendTo(playerId, { t: 'notice', text });
    const host = this.room.isHost(playerId);
    const hostOnly = () => (host ? true : (refuse('Only the host can do that.'), false));
    const season = this.current;

    switch (msg.t) {
      case 'champList':
        this.room.sendTo(playerId, { t: 'champList', seasons: this.store.list() });
        return;
      case 'champCreate': {
        if (!hostOnly()) return;
        const draft = sanitizeSeasonDraft(msg.draft, (id) => this.tracks.get(id) !== null);
        if (typeof draft === 'string') return refuse(`Season not created: ${draft}.`);
        this.current = this.store.create(draft, this.room.now());
        this.log(`season "${draft.name}" created (${draft.rounds.length} rounds)`);
        return this.publish();
      }
      case 'champLoad': {
        if (!hostOnly()) return;
        const view = typeof msg.id === 'number' ? this.store.view(msg.id) : null;
        if (!view) return refuse('No such season.');
        this.current = view;
        return this.publish();
      }
      case 'champClose':
        if (!hostOnly()) return;
        this.current = null;
        return this.publish();
    }

    if (!season) return refuse('No season is loaded.');
    if (season.status === 'finished' && msg.t !== 'champStartSession') return refuse('This season is finished.');
    const locked = season.status !== 'setup';
    const entryOf = (profileId: number) => season.entries.find((e) => e.profile.id === profileId);
    const joinRound = () => (season.status === 'setup' ? 1 : (season.next?.round ?? 1));

    switch (msg.t) {
      case 'champEnter': {
        const profile = this.room.profileOf(playerId);
        if (!profile) return refuse('Log in to a profile to enter the championship.');
        if (entryOf(profile.id)) return refuse('You are already entered.');
        this.store.addEntry(season.id, profile.id, joinRound());
        return this.reload();
      }
      case 'champAddEntrant': {
        if (!hostOnly()) return;
        const online = this.room.connectedProfiles().find((p) => p.profile.id === msg.profileId);
        if (!online) return refuse('That driver is not here and logged in.');
        if (entryOf(online.profile.id)) return refuse(`${online.profile.name} is already entered.`);
        this.store.addEntry(season.id, online.profile.id, joinRound());
        return this.reload();
      }
      case 'champTeamCreate': {
        const entry = this.myEntry(playerId);
        if (!entry) return refuse('Enter the championship first.');
        if (locked && entry.teamId !== null) return refuse('Teams are locked: the season has started.');
        const name = typeof msg.name === 'string' ? msg.name.trim() : '';
        if (!name || name.length > CHAMPIONSHIP.teamNameMax) return refuse(`Team names are 1–${CHAMPIONSHIP.teamNameMax} characters.`);
        if (season.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return refuse('A team with that name exists.');
        if (!isColor(msg.primary) || !isColor(msg.secondary)) return refuse('Pick two team colours.');
        const team = this.store.createTeam(season.id, name, msg.primary, msg.secondary);
        this.store.setTeam(season.id, entry.profile.id, team.id);
        return this.reload();
      }
      case 'champTeamJoin': {
        const entry = this.myEntry(playerId);
        if (!entry) return refuse('Enter the championship first.');
        if (locked && entry.teamId !== null) return refuse('Teams are locked: the season has started.');
        const team = season.teams.find((t) => t.id === msg.teamId);
        if (!team) return refuse('No such team.');
        if (season.entries.filter((e) => e.teamId === team.id).length >= CHAMPIONSHIP.teamSize) return refuse(`${team.name} is full.`);
        this.store.setTeam(season.id, entry.profile.id, team.id);
        return this.reload();
      }
      case 'champTeamLeave': {
        const entry = this.myEntry(playerId);
        if (!entry) return refuse('Enter the championship first.');
        if (locked) return refuse('Teams are locked: the season has started.');
        this.store.setTeam(season.id, entry.profile.id, null);
        return this.reload();
      }
      case 'champMoveDriver': {
        if (!hostOnly()) return;
        const entry = entryOf(msg.profileId);
        if (!entry) return refuse('That driver is not entered.');
        if (msg.teamId !== null) {
          const team = season.teams.find((t) => t.id === msg.teamId);
          if (!team) return refuse('No such team.');
          if (season.entries.filter((e) => e.teamId === team.id && e.profile.id !== entry.profile.id).length >= CHAMPIONSHIP.teamSize) {
            return refuse(`${team.name} is full.`);
          }
        }
        this.store.setTeam(season.id, entry.profile.id, msg.teamId);
        return this.reload();
      }
      case 'champStartSession':
        if (!hostOnly()) return;
        return this.startSession(refuse);
    }
  }

  private myEntry(playerId: number) {
    const profile = this.room.profileOf(playerId);
    return profile ? this.current?.entries.find((e) => e.profile.id === profile.id) : undefined;
  }

  private startSession(refuse: (text: string) => void) {
    let season = this.current!;
    if (season.status === 'finished') return refuse('This season is finished.');
    if (!season.entries.length) return refuse('Nobody has entered yet.');
    if (season.status === 'setup') {
      this.store.start(season.id);
      season = this.reloadQuiet()!;
    }
    const next = season.next!;
    const round = season.rounds.find((r) => r.round === next.round)!;

    // Entrants here now, in start order: entry order for qualifying; qualifying order for the
    // sprint and race (drivers without a qualifying result at the back, in entry order).
    const online = new Map(this.room.connectedProfiles().map((p) => [p.profile.id, p.playerId]));
    let order = season.entries.map((e) => e.profile.id);
    if (next.session !== 'qualifying') {
      const quali = season.results.filter((r) => r.round === next.round && r.session === 'qualifying').sort((a, b) => a.position - b.position);
      order = [...quali.map((r) => r.profileId), ...order.filter((id) => !quali.some((q) => q.profileId === id))];
    }
    const starters = order.filter((id) => online.has(id));
    if (!starters.length) return refuse('No entered driver is here.');
    const playerToProfile = new Map(starters.map((id) => [online.get(id)!, id]));

    const reason = this.room.runSession(
      {
        session: {
          kind: next.session,
          laps: season.settings.laps,
          qualifying: next.session === 'qualifying' ? season.settings.qualifying : null,
          endsAt: 0,
          round: { championshipId: season.id, round: next.round, rounds: season.rounds.length, trackId: round.trackId },
        },
        trackId: round.trackId,
        tyreWear: season.settings.tyreWear ? 'normal' : 'off',
        entrants: starters.map((id) => online.get(id)!),
      },
      (outcome) => this.sessionDone(season.id, next, round.trackId, playerToProfile, starters, outcome),
    );
    if (reason) return refuse(`Session not started: ${reason}.`);
    this.log(`season "${season.name}": round ${next.round} ${next.session}`);
    this.publish();
  }

  /** Turns a finished session into championship rows + a career record, and moves the season on. */
  private sessionDone(
    seasonId: number,
    done: { round: number; session: SeasonResult['session'] },
    trackId: string,
    playerToProfile: Map<number, number>,
    startOrder: number[],
    outcome: SessionOutcome,
  ) {
    const season = this.store.view(seasonId);
    if (!season) return;
    const fastestLapOn = season.settings.fastestLapPoint;
    const rows: SeasonResult[] = outcome.classification.flatMap((c) => {
      const profileId = playerToProfile.get(c.playerId);
      if (profileId === undefined) return [];
      const fastest = outcome.fastestLapId === c.playerId && done.session !== 'qualifying';
      return [
        {
          round: done.round,
          session: done.session,
          profileId,
          teamId: season.entries.find((e) => e.profile.id === profileId)?.teamId ?? null,
          position: c.position,
          dnf: c.dnf,
          bestLapMs: c.bestLapMs,
          points: sessionPoints(done.session, c.position, c.dnf) + fastestLapBonus(done.session, c.position, c.dnf, fastest, fastestLapOn),
          fastestLap: fastest,
        },
      ];
    });

    const poleProfile = season.results.find((r) => r.round === done.round && r.session === 'qualifying' && r.position === 1)?.profileId;
    const career: RaceInput = {
      trackId,
      kind: done.session,
      laps: done.session === 'sprint' ? sprintLaps(season.settings.laps) : season.settings.laps,
      finishedAt: this.room.now(),
      championshipId: seasonId,
      results:
        done.session === 'qualifying'
          ? []
          : rows.map((r) => ({
              profileId: r.profileId,
              position: r.position,
              grid: startOrder.indexOf(r.profileId) + 1 || null,
              dnf: r.dnf,
              laps: outcome.classification.find((c) => playerToProfile.get(c.playerId) === r.profileId)?.laps ?? 0,
              totalMs: outcome.classification.find((c) => playerToProfile.get(c.playerId) === r.profileId)?.totalMs ?? null,
              bestLapMs: r.bestLapMs,
              fastestLap: r.fastestLap,
              pole: done.session === 'race' && r.profileId === poleProfile,
              points: r.points,
            })),
      lapTimes: [...playerToProfile].flatMap(([playerId, profileId]) =>
        outcome.lapsOf(playerId).map((l) => ({ profileId, lap: l.lap, timeMs: l.time, sectors: l.sectors, valid: l.valid })),
      ),
    };

    const next = nextAfter(season, done);
    const champion = next ? null : (computeStandings({ ...season, results: [...season.results, ...rows] }).drivers[0]?.profile.id ?? null);
    try {
      this.store.writeSession(seasonId, done.round, done.session, rows, career, next, champion, this.room.now());
    } catch (err) {
      this.log(`season ${seasonId}: results not saved: ${(err as Error).message}`);
      this.room.notifyHost('Session results were not saved — run the session again.');
      return;
    }
    if (this.current?.id === seasonId) this.reload();
  }

  private reloadQuiet() {
    if (this.current) this.current = this.store.view(this.current.id);
    return this.current;
  }

  private reload() {
    this.reloadQuiet();
    this.publish();
  }

  private publish() {
    this.room.broadcast({ t: 'champ', view: this.current });
  }
}
