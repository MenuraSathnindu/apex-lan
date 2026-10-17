/** Port the server listens on (HTTP + WebSocket). */
export const SERVER_PORT = 3000;
/** Port the Vite dev server listens on. */
export const DEV_CLIENT_PORT = 5173;
/** WebSocket path, shared by server and Vite proxy. */
export const WS_PATH = '/ws';

/** Fixed physics tick rate (Hz) on both client and server. */
export const TICK_RATE = 60;
/** Server -> client snapshot rate (Hz). */
export const SNAPSHOT_RATE = 30;
/** How often each client reports its own car state (Hz). */
export const STATE_SEND_RATE = 30;
/** Remote-car interpolation delay (ms). */
export const INTERP_DELAY_MS = 100;
/** Client ping interval (ms). */
export const PING_INTERVAL_MS = 1000;

export const MAX_PLAYERS = 8;

/** A disconnected player keeps their slot, colour and name this long (ms). */
export const REJOIN_GRACE_MS = 30_000;
/** A connection is considered dead if nothing arrives for this long (ms). */
export const CONNECTION_TIMEOUT_MS = 5_000;
export const COUNTDOWN_MS = 3_000;
/** Remote cars with no update for this long (ms) are hidden. */
export const REMOTE_STALE_MS = 1_500;
export const NAME_MAX_LENGTH = 16;

/** Selectable car paint colours (index is what goes over the wire). One per grid slot. */
export const CAR_COLORS = [0xc8102e, 0x1e5bd8, 0xf2c200, 0x1d9a4a, 0xff6a13, 0x7a2fd0, 0xf0f0f0, 0x202226] as const;
export const CAR_COLOR_NAMES = ['Rosso', 'Blue', 'Yellow', 'Green', 'Orange', 'Purple', 'White', 'Black'] as const;

/** Fixed physics timestep (s). */
export const FIXED_DT = 1 / TICK_RATE;
