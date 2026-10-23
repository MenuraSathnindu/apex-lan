import { APEX_PARK, CAR_COLORS, freeSession, NAME_MAX_LENGTH, RACE, isCompound, presetLivery, sanitizeLivery, type Compound, type ChampionshipView, type Livery, type ProfileSummary, type SeasonListItem, type C2S, type DetectionEvent, type LapEvent, type PlayerInfo, type RaceState, type S2C, type SectorEvent, type Standing, type StewardEvent } from '@apex/shared';

const PROFILE_KEY = 'apex.profile';
const SESSION_KEY = 'apex.session';

interface Profile {
  name: string;
  color: number;
  /** Missing in profiles saved before liveries existed. */
  livery?: Livery;
  tyre?: Compound;
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
  race: RaceState = { phase: 'lobby', raceId: 0, startsAt: 0, laps: RACE.defaultLaps, finishDeadline: 0, tyreWear: 'normal', trackId: APEX_PARK.id, session: freeSession(RACE.defaultLaps) };
  connected = false;
  full = false;
  /** Latest ranking from the server (empty in the lobby). */
  standings: Standing[] = [];
  /** Lap events not yet shown by the HUD. */
  readonly lapEvents: LapEvent[] = [];
  /** Sector completions not yet shown by the HUD. */
  readonly sectorEvents: SectorEvent[] = [];
  /** Race-control decisions not yet shown by the HUD. */
  readonly stewardEvents: StewardEvent[] = [];
  /** Overtake detection-point crossings not yet applied to the car. */
  readonly detections: DetectionEvent[] = [];
  /** The profile this connection is logged in as (confirmed by the server), or null for a guest. */
  account: ProfileSummary | null = null;
  /** The championship season loaded in the room (null = none), and the seasons list. */
  champ: ChampionshipView | null = null;
  champList: SeasonListItem[] = [];
  /** Refusals from the server waiting to be shown. */
  readonly notices: string[] = [];
  /** Why the last login on the socket failed (shown in the lobby), or null. */
  authError: string | null = null;
  /** Login token to present in `hello` (set by the account client). */
  loginToken: () => string | null = () => null;
  /** Overtake mode per car, from their last detection-point crossing (timing tower ⚡). */
  readonly overtakes = new Map<number, boolean>();
  /** Result of our own last detection-point crossing (gap to the car ahead, overtake on/off). */
  lastDetection: DetectionEvent | null = null;
  profile: Profile = read<Profile>(() => localStorage, PROFILE_KEY) ?? { name: '', color: 0 };
  private sessionId: string | null = read<string>(() => sessionStorage, SESSION_KEY);

  get me(): PlayerInfo | undefined {
    return this.players.find((p) => p.id === this.myId);
  }

  get myStanding(): Standing | undefined {
    return this.standings.find((s) => s.id === this.myId);
  }

  playerName(id: number): string {
    return this.players.find((p) => p.id === id)?.name ?? `#${id}`;
  }

  get isHost(): boolean {
    return this.myId !== 0 && this.myId === this.hostId;
  }

  get joined(): boolean {
    return this.connected && this.myId !== 0;
  }

  hello(): C2S {
    return { t: 'hello', sessionId: this.sessionId, name: this.profile.name, color: this.profile.color, livery: this.livery, tyre: this.tyre, token: this.loginToken() };
  }

  /** Our paint scheme: the server's copy once joined, else what we last chose (validated). */
  get livery(): Livery {
    return this.me?.livery ?? sanitizeLivery(this.profile.livery, presetLivery(this.profile.color));
  }

  /** Our tyre compound: the server's copy once joined, else what we last chose. */
  get tyre(): Compound {
    return this.me?.tyre ?? (isCompound(this.profile.tyre) ? this.profile.tyre : 'medium');
  }

  setProfile(name: string, color: number, livery: Livery = this.livery, tyre: Compound = this.tyre): C2S {
    this.profile = { name: name.slice(0, NAME_MAX_LENGTH), color: Math.max(0, Math.min(CAR_COLORS.length - 1, color)), livery, tyre };
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
        if (this.me) this.profile = { ...this.profile, color: this.me.color, livery: this.me.livery, tyre: this.me.tyre };
        return true;
      case 'roster':
        this.hostId = msg.hostId;
        this.players = msg.players;
        return true;
      case 'race':
        if (msg.race.phase === 'lobby' || msg.race.raceId !== this.race.raceId) {
          this.standings = [];
          this.overtakes.clear();
        }
        this.race = msg.race;
        return true;
      case 'standings':
        this.standings = msg.standings;
        return true;
      case 'lap':
        this.lapEvents.push(msg.e);
        return true;
      case 'auth':
        this.account = msg.ok ? msg.profile : null;
        this.authError = msg.ok ? null : (msg.reason ?? 'login failed');
        return true;
      case 'champ':
        this.champ = msg.view;
        return true;
      case 'champList':
        this.champList = msg.seasons;
        return true;
      case 'notice':
        this.notices.push(msg.text);
        return true;
      case 'detect':
        this.overtakes.set(msg.e.id, msg.e.overtake);
        this.detections.push(msg.e);
        if (this.detections.length > 32) this.detections.shift();
        return false;
      case 'sector':
        this.sectorEvents.push(msg.e);
        if (this.sectorEvents.length > 64) this.sectorEvents.shift();
        return false;
      case 'steward':
        this.stewardEvents.push(msg.e);
        if (this.stewardEvents.length > 32) this.stewardEvents.shift();
        return false;
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
    this.account = null;
  }
}
