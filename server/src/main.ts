import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEV_CLIENT_PORT, SERVER_PORT, SNAPSHOT_RATE, WS_PATH, decodeC2S, encode } from '@apex/shared';
import { Room, type Connection } from './game/room.ts';
import { createStaticHandler } from './net/staticFiles.ts';
import { lanAddresses } from './util/lanAddress.ts';

const isDev = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? SERVER_PORT);

// Works for both `src/main.ts` (dev) and `dist/main.js` (prod): both sit one level below server/.
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

const http = createServer(createStaticHandler(clientDist));
const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: 64 * 1024 });
const room = new Room({ log: (m) => console.log(`[room] ${m}`) });

function toConnection(ws: WebSocket): Connection {
  return {
    send: (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(encode(msg));
    },
    close: () => ws.close(),
  };
}

wss.on('connection', (ws, req) => {
  const conn = toConnection(ws);
  console.log(`[ws] connection from ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    try {
      room.handle(conn, decodeC2S(data.toString()));
    } catch {
      // Malformed message: ignore.
    }
  });
  // Browser-level heartbeat: pongs arrive even when a background tab's timers are throttled.
  ws.on('pong', () => room.touch(conn));
  ws.on('close', () => room.disconnect(conn));
  ws.on('error', () => room.disconnect(conn));
});

setInterval(() => room.update(), 1000 / SNAPSHOT_RATE);
setInterval(() => {
  for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.ping();
}, 2000);

http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process or set PORT=<n>.`);
    process.exit(1);
  }
  throw err;
});

http.listen(port, '0.0.0.0', () => {
  const joinPort = isDev ? DEV_CLIENT_PORT : port;
  const ips = lanAddresses();
  console.log(`\napex-lan server listening on :${port}${isDev ? ' (dev — join via Vite)' : ''}`);
  console.log(`  Local:   http://localhost:${joinPort}`);
  for (const { address, iface, virtual } of ips) {
    const url = `http://${address}:${joinPort}`;
    console.log(`  ${virtual ? 'Other:  ' : 'Join at:'} ${url.padEnd(28)} (${iface}${virtual ? ', probably VPN/VM' : ''})`);
  }
  if (ips.length === 0) console.log('  (no LAN IPv4 address found — are you on Wi-Fi?)');
  console.log('');
});
