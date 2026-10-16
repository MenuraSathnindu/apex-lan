import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEV_CLIENT_PORT,
  MAX_PLAYERS,
  SERVER_PORT,
  WS_PATH,
  decodeC2S,
  encode,
  type S2C,
} from '@apex/shared';
import { createStaticHandler } from './net/staticFiles.ts';
import { lanAddresses } from './util/lanAddress.ts';

const isDev = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? SERVER_PORT);

// Works for both `src/main.ts` (dev) and `dist/main.js` (prod): both sit one level below server/.
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

const http = createServer(createStaticHandler(clientDist));
const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: 64 * 1024 });

const players = new Map<WebSocket, number>();
let nextPlayerId = 1;

function send(ws: WebSocket, msg: S2C) {
  if (ws.readyState === ws.OPEN) ws.send(encode(msg));
}

function broadcastPlayerCount() {
  for (const ws of players.keys()) send(ws, { t: 'playerCount', count: players.size });
}

wss.on('connection', (ws, req) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'full' });
    ws.close();
    return;
  }

  const playerId = nextPlayerId++;
  players.set(ws, playerId);
  console.log(`[ws] player ${playerId} connected from ${req.socket.remoteAddress} (${players.size} online)`);
  send(ws, { t: 'welcome', playerId, playerCount: players.size });
  broadcastPlayerCount();

  ws.on('message', (data) => {
    let msg;
    try {
      msg = decodeC2S(data.toString());
    } catch {
      return;
    }
    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        break;
    }
  });

  ws.on('close', () => {
    players.delete(ws);
    console.log(`[ws] player ${playerId} disconnected (${players.size} online)`);
    broadcastPlayerCount();
  });
});

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
  for (const ip of ips) console.log(`  Join at: http://${ip}:${joinPort}`);
  if (ips.length === 0) console.log('  (no LAN IPv4 address found — are you on Wi-Fi?)');
  console.log('');
});
