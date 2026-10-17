import { randomUUID } from 'node:crypto';
import {
  CAR_COLORS,
  CONNECTION_TIMEOUT_MS,
  COUNTDOWN_MS,
  MAX_PLAYERS,
  REJOIN_GRACE_MS,
  isValidCarState,
  sanitizeName,
  type C2S,
  type CarSnapshot,
  type CarState,
  type PlayerInfo,
  type RaceState,
  type S2C,
} from '@apex/shared';

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
  private race: RaceState = { phase: 'lobby', raceId: 0, startsAt: 0 };
  private readonly now: () => number;
  private readonly log: (msg: string) => void;

  constructor(opts: RoomOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
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
        this.setProfile(player, msg.name, msg.color);
        this.broadcastRoster();
        break;
      case 'state':
        if (!isValidCarState(msg.s)) return;
        player.state = msg.s;
        player.stateTs = this.now();
        break;
      case 'start':
        if (player.id !== this.hostId || this.race.phase !== 'lobby') return;
        this.race = { phase: 'countdown', raceId: this.race.raceId + 1, startsAt: this.now() + COUNTDOWN_MS };
        this.log(`race ${this.race.raceId} starting (${this.connectedPlayers().length} players)`);
        this.broadcast({ t: 'race', race: this.race });
        break;
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
      if (this.players.size === 0) this.race = { phase: 'lobby', raceId: this.race.raceId, startsAt: 0 };
      this.broadcastRoster();
    }
    if (this.connectedPlayers().length === 0 && this.race.phase !== 'lobby') this.toLobby();

    if (this.race.phase === 'countdown' && now >= this.race.startsAt) {
      this.race = { ...this.race, phase: 'racing' };
      this.broadcast({ t: 'race', race: this.race });
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
      this.setProfile(player, msg.name, msg.color);
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
    this.broadcastRoster();
  }

  private setProfile(player: Player, name: unknown, color: unknown) {
    player.name = sanitizeName(name) ?? player.name;
    const wanted = typeof color === 'number' && Number.isInteger(color) && color >= 0 && color < CAR_COLORS.length ? color : player.color;
    const taken = new Set([...this.players.values()].filter((p) => p !== player).map((p) => p.color));
    if (!taken.has(wanted)) player.color = wanted;
    else if (taken.has(player.color)) {
      // Our current colour is taken too (e.g. we just joined): pick the first free one.
      player.color = CAR_COLORS.findIndex((_, i) => !taken.has(i));
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
    this.race = { phase: 'lobby', raceId: this.race.raceId, startsAt: 0 };
    this.broadcast({ t: 'race', race: this.race });
  }

  private connectedPlayers(): Player[] {
    return [...this.players.values()].filter((p) => p.conn);
  }

  private roster(): PlayerInfo[] {
    return [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => ({ id: p.id, name: p.name, color: p.color, slot: p.slot, connected: !!p.conn }));
  }

  private broadcastRoster() {
    this.broadcast({ t: 'roster', hostId: this.hostId, players: this.roster() });
  }

  private broadcast(msg: S2C) {
    for (const p of this.players.values()) p.conn?.send(msg);
  }
}
