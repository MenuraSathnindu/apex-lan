import { randomUUID } from 'node:crypto';
import type { RaceInput } from '../db/database.ts';
import { builtInTracks, type TrackProvider } from '../tracks/catalog.ts';
import {
  APEX_PARK,
  CAR_COLORS,
  RACE,
  RaceTracker,
  type BuiltTrack,
  type Gate,
  buildCheckpoints,
  buildTrack,
  CONNECTION_TIMEOUT_MS,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  REJOIN_GRACE_MS,
  defaultTag,
  isCompound,
  isTyreWearSetting,
  isValidCarState,
  presetLivery,
  sanitizeLivery,
  sanitizeName,
  type C2S,
  type CarSnapshot,
  type CarState,
  type Compound,
  type Livery,
  type PlayerInfo,
  type ProfileSummary,
  type RaceState,
  type S2C,
  type TrackDef,
} from '@apex/shared';

/** Standings go out every Nth update (30 Hz / 6 = 5 Hz). */
const STANDINGS_EVERY = 6;

/** What the room needs from a connection — a WebSocket in production, a stub in tests. */
export interface Connection {
  send(msg: S2C): void;
  close(): void;
}

interface Player {
  id: number;
  sessionId: string;
  name: string;
  color: number;
  livery: Livery;
  tyre: Compound;
  /** Logged-in profile (null = guest). */
  profile: ProfileSummary | null;
  slot: number;
  joinedAt: number;
  conn: Connection | null;
  /** Last time anything arrived from this player's connection. */
  lastSeen: number;
  disconnectedAt: number;
  state: CarState | null;
  stateTs: number;
  /** stateTs already included in a broadcast snapshot. */
  sentTs: number;
}

/** Player profiles, as far as the room needs them (the database in production). */
export interface ProfileDirectory {
  byToken(token: string): ProfileSummary | null;
  saveLivery(profileId: number, livery: Livery): void;
}

/** Where finished races go (the database in production). */
export interface ResultsSink {
  recordRace(race: RaceInput): void;
}

export interface RoomOptions {
  now?: () => number;
  log?: (msg: string) => void;
  /** Selectable tracks (default: the built-in ones). */
  tracks?: TrackProvider;
  profiles?: ProfileDirectory;
  results?: ResultsSink;
}

/**
 * The single game room: players, host, race phase, relaying car states.
 * Socket-agnostic so it can be unit-tested; call `update()` at SNAPSHOT_RATE.
 */
export class Room {
  private readonly players = new Map<number, Player>();
  private readonly byConn = new Map<Connection, Player>();
  private nextId = 1;
  private hostId = 0;
  private race: RaceState = { phase: 'lobby', raceId: 0, startsAt: 0, laps: RACE.defaultLaps, finishDeadline: 0, tyreWear: 'normal', trackId: APEX_PARK.id };
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly tracks: TrackProvider;
  private track!: BuiltTrack;
  private gates!: Gate[];
  private tracker: RaceTracker | null = null;
  private updates = 0;
  private readonly profiles: ProfileDirectory | null;
  private readonly results: ResultsSink | null;
  /** Who raced as which profile, frozen at the start (logging in mid-race doesn't move results). */
  private raceEntrants = new Map<number, { profileId: number | null; grid: number }>();

  constructor(opts: RoomOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.tracks = opts.tracks ?? builtInTracks();
    this.profiles = opts.profiles ?? null;
    this.results = opts.results ?? null;
    this.useTrack(APEX_PARK);
  }

  /** Feed every decoded message from a connection here (including before `hello`). */
  handle(conn: Connection, msg: C2S): void {
    const player = this.byConn.get(conn);
    if (player) player.lastSeen = this.now();

    if (msg.t === 'ping') {
      conn.send({ t: 'pong', clientTime: msg.clientTime, serverTime: this.now() });
      return;
    }
    if (msg.t === 'hello') {
      if (!player) this.hello(conn, msg);
      return;
    }
    if (!player) return; // must say hello first

    switch (msg.t) {
      case 'profile':
        this.setProfile(player, msg.name, msg.color, msg.livery);
        // Tyres are fitted on the grid: no changing compound mid-race.
        if (isCompound(msg.tyre) && this.race.phase === 'lobby') player.tyre = msg.tyre;
        this.broadcastRoster();
        break;
      case 'state':
        if (!isValidCarState(msg.s)) return;
        player.state = msg.s;
        player.stateTs = this.now();
        if (this.tracker && (this.race.phase === 'countdown' || this.race.phase === 'racing')) {
          for (const e of this.tracker.onState(player.id, msg.s.p[0], msg.s.p[2], player.stateTs)) this.onLap(e);
          for (const e of this.tracker.takeDetections()) this.broadcast({ t: 'detect', e });
        }
        break;
      case 'setLaps': {
        if (player.id !== this.hostId || this.race.phase !== 'lobby') return;
        const laps = Math.round(Number(msg.laps));
        if (!Number.isFinite(laps)) return;
        this.race = { ...this.race, laps: Math.max(RACE.minLaps, Math.min(RACE.maxLaps, laps)) };
        this.broadcast({ t: 'race', race: this.race });
        break;
      }
      case 'auth':
        this.authenticate(player, msg.token);
        this.broadcastRoster();
        break;
      case 'setTrack': {
        if (player.id !== this.hostId || this.race.phase !== 'lobby' || typeof msg.trackId !== 'string') return;
        const def = this.tracks.get(msg.trackId);
        if (!def || def.id === this.race.trackId) return;
        this.useTrack(def);
        this.log(`track: ${def.name}, ${def.country}`);
        this.broadcast({ t: 'race', race: this.race });
        break;
      }
      case 'setTyreWear': {
        if (player.id !== this.hostId || this.race.phase !== 'lobby' || !isTyreWearSetting(msg.wear)) return;
        this.race = { ...this.race, tyreWear: msg.wear };
        this.broadcast({ t: 'race', race: this.race });
        break;
      }
      case 'start': {
        if (player.id !== this.hostId || this.race.phase !== 'lobby') return;
        const startsAt = this.now() + COUNTDOWN_MS;
        const starters = this.connectedPlayers();
        const racers = starters.map((p) => p.id);
        this.tracker = new RaceTracker(this.track, this.gates, racers, startsAt, this.race.laps);
        this.raceEntrants = new Map(starters.map((p) => [p.id, { profileId: p.profile?.id ?? null, grid: p.slot + 1 }]));
        this.race = { ...this.race, phase: 'countdown', raceId: this.race.raceId + 1, startsAt, finishDeadline: 0 };
        this.log(`race ${this.race.raceId} starting: ${racers.length} players, ${this.race.laps} laps`);
        this.broadcast({ t: 'race', race: this.race });
        this.broadcast({ t: 'standings', standings: this.tracker.standings() });
        break;
      }
      case 'endRace':
        if (player.id !== this.hostId || this.race.phase === 'lobby') return;
        this.toLobby();
        break;
    }
  }

  /**
   * Proof of life that doesn't need the page's JavaScript (WebSocket pong frames are
   * answered by the browser itself), so background tabs with throttled timers stay connected.
   */
  touch(conn: Connection): void {
    const player = this.byConn.get(conn);
    if (player) player.lastSeen = this.now();
  }

  /** Call when a connection closes (or is found dead). */
  disconnect(conn: Connection): void {
    const player = this.byConn.get(conn);
    this.byConn.delete(conn);
    if (!player || player.conn !== conn) return;
    player.conn = null;
    player.disconnectedAt = this.now();
    this.log(`${player.name} (#${player.id}) disconnected — slot held for ${REJOIN_GRACE_MS / 1000}s`);
    if (player.id === this.hostId) this.pickHost();
    this.broadcastRoster();
  }

  /** Advance timers and broadcast fresh car states. Call at SNAPSHOT_RATE. */
  update(): void {
    const now = this.now();

    // Dead connections (no messages, no close event — e.g. Wi-Fi dropped).
    for (const p of this.players.values()) {
      if (p.conn && now - p.lastSeen > CONNECTION_TIMEOUT_MS) {
        const conn = p.conn;
        this.disconnect(conn);
        conn.close();
      }
    }

    // Grace period over: free the slot.
    let removed = false;
    for (const p of [...this.players.values()]) {
      if (!p.conn && now - p.disconnectedAt > REJOIN_GRACE_MS) {
        this.players.delete(p.id);
        this.log(`${p.name} (#${p.id}) removed`);
        removed = true;
      }
    }
    if (removed) {
      if (this.players.size === 0) {
        this.race = { ...this.race, phase: 'lobby', startsAt: 0, finishDeadline: 0 };
        this.tracker = null;
      }
      this.broadcastRoster();
    }
    if (this.connectedPlayers().length === 0 && this.race.phase !== 'lobby') this.toLobby();

    if (this.race.phase === 'countdown' && now >= this.race.startsAt) {
      this.race = { ...this.race, phase: 'racing' };
      this.broadcast({ t: 'race', race: this.race });
    }

    if (this.race.phase === 'racing' && this.tracker) {
      const connected = new Set(this.connectedPlayers().map((p) => p.id));
      if (this.tracker.isOver(now, connected)) {
        this.tracker.finalize();
        this.race = { ...this.race, phase: 'results' };
        const standings = this.tracker.standings();
        this.log(`race ${this.race.raceId} over — winner #${standings[0]?.id}`);
        this.recordResults();
        this.broadcast({ t: 'race', race: this.race });
        this.broadcast({ t: 'standings', standings });
      } else if (++this.updates % STANDINGS_EVERY === 0) {
        this.broadcast({ t: 'standings', standings: this.tracker.standings() });
      }
    }

    // Relay states that changed since the last snapshot.
    const cars: CarSnapshot[] = [];
    for (const p of this.players.values()) {
      if (!p.conn || !p.state || p.stateTs === p.sentTs) continue;
      cars.push({ id: p.id, ts: p.stateTs, ...p.state });
      p.sentTs = p.stateTs;
    }
    if (cars.length) this.broadcast({ t: 'snapshot', cars });
  }

  // --- internals -----------------------------------------------------------

  private hello(conn: Connection, msg: Extract<C2S, { t: 'hello' }>) {
    const now = this.now();
    let player = msg.sessionId ? [...this.players.values()].find((p) => p.sessionId === msg.sessionId) : undefined;

    // Same session still live and recently heard from → a duplicated browser tab, not a rejoin.
    if (player?.conn && now - player.lastSeen < CONNECTION_TIMEOUT_MS / 2) player = undefined;

    if (player) {
      if (player.conn) {
        // Stale connection we hadn't noticed yet: replace it.
        const old = player.conn;
        this.byConn.delete(old);
        old.close();
      }
      player.conn = conn;
      player.lastSeen = now;
      this.byConn.set(conn, player);
      this.log(`${player.name} (#${player.id}) rejoined`);
    } else {
      const slot = this.freeSlot();
      if (slot < 0) {
        conn.send({ t: 'full' });
        conn.close();
        return;
      }
      player = {
        id: this.nextId++,
        sessionId: randomUUID(),
        name: `Player ${this.nextId - 1}`,
        color: 0,
        livery: presetLivery(0),
        profile: null,
        tyre: isCompound(msg.tyre) ? msg.tyre : 'medium',
        slot,
        joinedAt: now,
        conn,
        lastSeen: now,
        disconnectedAt: 0,
        state: null,
        stateTs: 0,
        sentTs: 0,
      };
      this.players.set(player.id, player);
      this.byConn.set(conn, player);
      this.setProfile(player, msg.name, msg.color, msg.livery);
      // A newcomer without a saved livery gets their colour's preset (including its number).
      if (msg.livery === undefined) player.livery = presetLivery(player.color);
      if (msg.token) this.authenticate(player, msg.token, conn);
      this.log(`${player.name} (#${player.id}) joined in slot ${slot + 1}`);
    }

    this.pickHost();
    conn.send({
      t: 'welcome',
      playerId: player.id,
      sessionId: player.sessionId,
      hostId: this.hostId,
      players: this.roster(),
      race: this.race,
      resume: this.race.phase === 'lobby' ? null : player.state,
    });
    if (this.tracker) conn.send({ t: 'standings', standings: this.tracker.standings() });
    this.broadcastRoster();
  }

  /**
   * Logs a player in to a profile (their name, tag, photo and livery come from it) or back out
   * to a guest. A profile can only drive one car at a time.
   */
  private authenticate(player: Player, token: string | null, conn = player.conn) {
    const reply = (ok: boolean, reason?: string) => conn?.send({ t: 'auth', ok, profile: player.profile, ...(reason ? { reason } : {}) });
    if (token === null) {
      player.profile = null;
      return reply(true);
    }
    const profile = typeof token === 'string' && this.profiles ? this.profiles.byToken(token) : null;
    if (!profile) return reply(false, 'unknown login — log in again');
    if ([...this.players.values()].some((p) => p !== player && p.conn && p.profile?.id === profile.id)) {
      return reply(false, `${profile.name} is already driving in this room`);
    }
    player.profile = profile;
    player.name = profile.name;
    player.livery = { ...profile.livery };
    this.log(`#${player.id} is ${profile.name}`);
    reply(true);
  }

  /** A profile changed elsewhere (photo, tag, livery): update whoever is using it. */
  profileUpdated(profile: ProfileSummary): void {
    let any = false;
    for (const p of this.players.values()) {
      if (p.profile?.id !== profile.id) continue;
      p.profile = profile;
      p.name = profile.name;
      p.livery = { ...profile.livery };
      any = true;
    }
    if (any) this.broadcastRoster();
  }

  /** Hands the finished race to the results sink: every starter's place, every profiled lap. */
  private recordResults() {
    if (!this.results || !this.tracker) return;
    const standings = this.tracker.standings();
    const fastest = this.tracker.fastestLap();
    const starters = standings.length;
    const competitive = starters >= 2;
    const race: RaceInput = {
      trackId: this.race.trackId,
      kind: 'race',
      laps: this.race.laps,
      finishedAt: this.now(),
      results: standings.map((s) => {
        const entrant = this.raceEntrants.get(s.id);
        return {
          profileId: entrant?.profileId ?? null,
          position: s.pos,
          grid: entrant?.grid ?? null,
          dnf: s.dnf,
          laps: s.laps,
          totalMs: s.finishTime,
          bestLapMs: s.bestLap,
          fastestLap: fastest?.id === s.id,
          // No qualifying yet: poles are awarded once grids come from qualifying (championship mode).
          pole: false,
          points: competitive && !s.dnf ? (RACE.points[s.pos - 1] ?? 0) : 0,
        };
      }),
      lapTimes: standings.flatMap((s) => {
        const profileId = this.raceEntrants.get(s.id)?.profileId;
        if (!profileId) return [];
        return this.tracker!.lapsOf(s.id).map((l) => ({ profileId, lap: l.lap, timeMs: l.time, sectors: l.sectors }));
      }),
    };
    try {
      this.results.recordRace(race);
    } catch (err) {
      this.log(`could not record race results: ${(err as Error).message}`);
    }
  }

  private setProfile(player: Player, name: unknown, color: unknown, livery: unknown) {
    // A profile's name is fixed (it's the login); guests can rename themselves.
    if (!player.profile) player.name = sanitizeName(name) ?? player.name;
    const prevColor = player.color;
    const wanted = typeof color === 'number' && Number.isInteger(color) && color >= 0 && color < CAR_COLORS.length ? color : player.color;
    const taken = new Set([...this.players.values()].filter((p) => p !== player).map((p) => p.color));
    if (!taken.has(wanted)) player.color = wanted;
    else if (taken.has(player.color)) {
      // Our current colour is taken too (e.g. we just joined): pick the first free one.
      player.color = CAR_COLORS.findIndex((_, i) => !taken.has(i));
    }
    // No (valid) livery sent: keep ours, or take the preset of a newly assigned colour.
    const fallback = player.color !== prevColor ? { ...presetLivery(player.color), number: player.livery.number } : player.livery;
    player.livery = livery === undefined ? fallback : sanitizeLivery(livery, fallback);
    if (player.profile && JSON.stringify(player.livery) !== JSON.stringify(player.profile.livery)) {
      player.profile = { ...player.profile, livery: { ...player.livery } };
      this.profiles?.saveLivery(player.profile.id, player.livery);
    }
  }

  private freeSlot(): number {
    if (this.players.size >= MAX_PLAYERS) return -1;
    const used = new Set([...this.players.values()].map((p) => p.slot));
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }

  /**
   * Host = the earliest-joined player who's connected. So the host passes on while they're
   * away, and comes back to them if they rejoin within the grace period.
   */
  private pickHost() {
    const next = this.connectedPlayers().sort((a, b) => a.joinedAt - b.joinedAt)[0];
    const id = next?.id ?? 0;
    if (id !== this.hostId && next) this.log(`${next.name} (#${next.id}) is now host`);
    this.hostId = id;
  }

  private toLobby() {
    this.race = { ...this.race, phase: 'lobby', startsAt: 0, finishDeadline: 0 };
    this.tracker = null;
    this.broadcast({ t: 'race', race: this.race });
  }

  private onLap(e: import('@apex/shared').LapEvent) {
    const p = this.players.get(e.id);
    this.log(`${p?.name ?? e.id} lap ${e.lap}: ${(e.time / 1000).toFixed(3)}s${e.finished ? ' — FINISHED' : ''}`);
    this.broadcast({ t: 'lap', e });
    if (e.finished && this.race.finishDeadline === 0) {
      this.race = { ...this.race, finishDeadline: this.now() + RACE.finishGraceMs };
      this.broadcast({ t: 'race', race: this.race });
    }
  }

  /** Switches the room to a track (lobby only): laps reset to the track's default. */
  private useTrack(def: TrackDef) {
    this.track = buildTrack(def);
    this.gates = buildCheckpoints(this.track);
    this.race = { ...this.race, trackId: def.id, laps: Math.max(RACE.minLaps, Math.min(RACE.maxLaps, def.laps)) };
  }

  private connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.conn);
  }

  private roster(): PlayerInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, slot: p.slot, connected: !!p.conn, livery: p.livery, tyre: p.tyre, profileId: p.profile?.id ?? null, tag: p.profile?.tag ?? defaultTag(p.name), photo: p.profile?.photo ?? null }));
  }

  private broadcastRoster() {
    this.broadcast({ t: 'roster', hostId: this.hostId, players: this.roster() });
  }

  private broadcast(msg: S2C) {
    for (const p of this.players.values()) p.conn?.send(msg);
  }
}
