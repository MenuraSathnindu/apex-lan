import { PING_INTERVAL_MS, WS_PATH, decodeS2C, encode, type C2S, type S2C } from '@apex/shared';

const RECONNECT_DELAY_MS = 1000;

export interface SocketHandlers {
  onOpen(): void;
  onClose(): void;
  onMessage(msg: S2C): void;
}

/** WebSocket to the game server on the same host, with auto-reconnect and ping. */
export function connect(handlers: SocketHandlers) {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${WS_PATH}`;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const send = (msg: C2S) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(encode(msg));
  };

  const open = () => {
    ws = new WebSocket(url);

    ws.onopen = () => {
      handlers.onOpen();
      // A quick burst so the server clock estimate is good within ~0.3 s, then steady pings
      // (which also tell the server we're alive).
      const ping = () => send({ t: 'ping', clientTime: performance.now() });
      for (let i = 0; i < 5; i++) setTimeout(ping, i * 60);
      pingTimer = setInterval(ping, PING_INTERVAL_MS);
    };
    ws.onmessage = (ev) => {
      try {
        handlers.onMessage(decodeS2C(ev.data as string));
      } catch (err) {
        console.warn('bad message from server', err);
      }
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      handlers.onClose();
      setTimeout(open, RECONNECT_DELAY_MS);
    };
  };

  open();
  return { send };
}
