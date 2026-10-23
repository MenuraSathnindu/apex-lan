import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEV_CLIENT_PORT, SERVER_PORT, SNAPSHOT_RATE, WS_PATH, decodeC2S, encode } from '@apex/shared';
import { PlayerDb } from './db/database.ts';
import { Room, type Connection } from './game/room.ts';
import { createApi } from './http/api.ts';
import { trackCatalog } from './tracks/catalog.ts';
import { createStaticHandler } from './net/staticFiles.ts';
import { lanAddresses } from './util/lanAddress.ts';
import { renderQr } from './util/qr.ts';

const isDev = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? SERVER_PORT);

// Works for both `src/main.ts` (dev) and `dist/main.js` (prod): both sit one level below server/.
const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, '../../client/dist');
// Generated tracks (committed, so always present in the repo).
const tracksDir = resolve(here, '../../client/public/tracks');
// Player profiles, stats and photos (git-ignored). APEX_DATA_DIR moves them elsewhere.
const dataDir = process.env.APEX_DATA_DIR ? resolve(process.env.APEX_DATA_DIR) : resolve(here, '../data');
mkdirSync(join(dataDir, 'photos'), { recursive: true });
const db = new PlayerDb(join(dataDir, 'apex.sqlite'));

const serveStatic = createStaticHandler(clientDist);
const http = createServer((req, res) => {
  void api.handle(req, res).then((handled) => handled || serveStatic(req, res));
});
const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: 64 * 1024 });
const room = new Room({
  log: (m) => console.log(`[room] ${m}`),
  tracks: trackCatalog(tracksDir, (m) => console.log(`[tracks] ${m}`)),
  profiles: {
    byToken: (token) => {
      const p = db.profileForToken(token);
      return p && PlayerDb.summary(p);
    },
    saveLivery: (id, livery) => db.setLivery(id, livery),
  },
  results: { recordRace: (race) => db.recordRace(race) },
});
const api = createApi({ db, photosDir: join(dataDir, 'photos'), onProfileChanged: (p) => room.profileUpdated(p) });

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
  const main = ips.find((a) => !a.virtual);
  const log = console.log;
  log(`\napex-lan server listening on :${port}${isDev ? ' (dev — join via Vite)' : ''}`);
  log(`  Local:   http://localhost:${joinPort}`);
  for (const { address, iface, virtual } of ips) {
    const url = `http://${address}:${joinPort}`;
    log(`  ${virtual ? 'Other:  ' : 'Join at:'} ${url.padEnd(28)} (${iface}${virtual ? ', probably VPN/VM' : ''})`);
  }
  if (!main) {
    log('  (no LAN IPv4 address found — are you on Wi-Fi?)\n');
    return;
  }
  // QR for the most likely join URL (Wi-Fi first). APEX_QR=0 turns it off.
  if (process.env.APEX_QR !== '0') {
    log(`\n  Scan to open http://${main.address}:${joinPort} (${main.iface}):\n`);
    log(renderQr(`http://${main.address}:${joinPort}`, { color: !process.env.NO_COLOR }).replace(/^/gm, '  '));
  }
  log(`\n  Friends can't connect? See HOSTING.md (firewall, network profile, VPN).\n`);
});
