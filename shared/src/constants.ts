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
/** Remote-car interpolation delay (ms). */
export const INTERP_DELAY_MS = 100;
/** Client ping interval (ms). */
export const PING_INTERVAL_MS = 1000;

export const MAX_PLAYERS = 8;

/** Fixed physics timestep (s). */
export const FIXED_DT = 1 / TICK_RATE;
