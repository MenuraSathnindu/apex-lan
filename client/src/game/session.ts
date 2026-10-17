import { CAR_COLORS, NAME_MAX_LENGTH, type C2S, type PlayerInfo, type RaceState, type S2C } from '@apex/shared';

const PROFILE_KEY = 'apex.profile';
const SESSION_KEY = 'apex.session';

interface Profile {
  name: string;
  color: number;
}

function read<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: unknown) {
  try {
    storage().setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: identity just won't survive a reload.
  }
}

/**
 * Who we are and what the room looks like, as told by the server.
 * Profile (name/colour) persists in localStorage; the session id (for rejoining as the
 * same player after a reload or Wi-Fi blip) lives in sessionStorage, so each tab is its
 * own player.
 */
export class Session {
  myId = 0;
  hostId = 0;
  players: PlayerInfo[] = [];
  race: RaceState = { phase: 'lobby', raceId: 0, startsAt: 0 };
  connected = false;
  full = false;
  profile: Profile = read<Profile>(() => localStorage, PROFILE_KEY) ?? { name: '', color: 0 };
  private sessionId: string | null = read<string>(() => sessionStorage, SESSION_KEY);

  get me(): PlayerInfo | undefined {
    return this.players.find((p) => p.id === this.myId);
  }

  get isHost(): boolean {
    return this.myId !== 0 && this.myId === this.hostId;
  }

  get joined(): boolean {
    return this.connected && this.myId !== 0;
  }

  hello(): C2S {
    return { t: 'hello', sessionId: this.sessionId, name: this.profile.name, color: this.profile.color };
  }

  setProfile(name: string, color: number): C2S {
    this.profile = { name: name.slice(0, NAME_MAX_LENGTH), color: Math.max(0, Math.min(CAR_COLORS.length - 1, color)) };
    write(() => localStorage, PROFILE_KEY, this.profile);
    return { t: 'profile', ...this.profile };
  }

  /** Applies room messages; returns true if the roster or race changed. */
  handle(msg: S2C): boolean {
    switch (msg.t) {
      case 'welcome':
        this.myId = msg.playerId;
        this.hostId = msg.hostId;
        this.players = msg.players;
        this.race = msg.race;
        this.sessionId = msg.sessionId;
        write(() => sessionStorage, SESSION_KEY, msg.sessionId);
        // The server may have given us a different colour (ours was taken).
        if (this.me) this.profile = { ...this.profile, color: this.me.color };
        return true;
      case 'roster':
        this.hostId = msg.hostId;
        this.players = msg.players;
        return true;
      case 'race':
        this.race = msg.race;
        return true;
      case 'full':
        this.full = true;
        return true;
      default:
        return false;
    }
  }

  onDisconnect(): void {
    this.connected = false;
    this.myId = 0;
  }
}
