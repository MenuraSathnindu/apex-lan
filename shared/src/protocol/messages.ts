/** Client -> Server messages. */
export type C2S = { t: 'ping'; clientTime: number };

/** Server -> Client messages. */
export type S2C =
  | { t: 'welcome'; playerId: number; playerCount: number }
  | { t: 'playerCount'; count: number }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'full' };
