import { randomUUID } from 'node:crypto';
import {
  APEX_PARK,
  CAR_COLORS,
  RACE,
  RaceTracker,
  buildCheckpoints,
  buildTrack,
  CONNECTION_TIMEOUT_MS,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  REJOIN_GRACE_MS,
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

export interface RoomOptions {
  now?: () => number;
  log?: (msg: string) => void;
  track?: TrackDef;
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
  private race: RaceState = { phase: 'lobby', raceId: 0, startsAt: 0, laps: RACE.defaultLaps, finishDeadline: 0, tyreWear: 'normal' };
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private readonly track;
  private readonly gates;
  private tracker: RaceTracker | null = null;
  private updates = 0;

  constructor(opts: RoomOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.track = buildTrack(opts.track ?? APEX_PARK);
    this.gates = buildCheckpoints(this.track);
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
      case 'setTyreWear': {
        if (player.id !== this.hostId || this.race.phase !== 'lobby' || !isTyreWearSetting(msg.wear)) return;
        this.race = { ...this.race, tyreWear: msg.wear };
        this.broadcast({ t: 'race', race: this.race });
        break;
      }
      case 'start': {
        if (player.id !== this.hostId || this.race.phase !== 'lobby') return;
        const startsAt = this.now() + COUNTDOWN_MS;
        const racers = this.connectedPlayers().map((p) => p.id);
        this.tracker = new RaceTracker(this.track, this.gates, racers, startsAt, this.race.laps);
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

  private setProfile(player: Player, name: unknown, color: unknown, livery: unknown) {
    player.name = sanitizeName(name) ?? player.name;
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

  private connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.conn);
  }

  private roster(): PlayerInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, slot: p.slot, connected: !!p.conn, livery: p.livery, tyre: p.tyre }));
  }

  private broadcastRoster() {
    this.broadcast({ t: 'roster', hostId: this.hostId, players: this.roster() });
  }

  private broadcast(msg: S2C) {
    for (const p of this.players.values()) p.conn?.send(msg);
  }
}
