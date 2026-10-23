import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { DEV_CLIENT_PORT, SERVER_PORT, WS_PATH } from '@apex/shared';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Copies three's Draco decoder into public/draco/ so GLB models decode without
 * internet access (friends on the LAN may be offline). Runs on dev start and build.
 */
function dracoDecoder(): Plugin {
  return {
    name: 'apex-draco-decoder',
    // `config` runs before the dev server indexes public/ (buildStart was too late:
    // the copied files were then answered with index.html).
    config() {
      // three's "exports" don't include package.json, so resolve a decoder file directly.
      const src = dirname(createRequire(import.meta.url).resolve('three/examples/jsm/libs/draco/gltf/draco_decoder.js'));
      const dest = resolve(here, 'public/draco');
      if (existsSync(join(dest, 'draco_decoder.wasm'))) return;
      mkdirSync(dest, { recursive: true });
      cpSync(src, dest, { recursive: true });
    },
  };
}

/**
 * Node closes connections that send no request headers within 60 s with "408 Request
 * Timeout". Browsers open spare connections ahead of time; while a tab spends a long time
 * loading (many dev modules, big assets, a slow laptop) one can expire just as it's used,
 * and a module fails to load. Give idle sockets 10 minutes instead.
 */
function relaxedTimeouts(): Plugin {
  return {
    name: 'apex-relaxed-timeouts',
    configureServer(server) {
      const http = server.httpServer as import('node:http').Server | null;
      if (!http) return;
      http.requestTimeout = 0;
      http.headersTimeout = 10 * 60_000;
    },
  };
}

export default defineConfig({
  plugins: [dracoDecoder(), relaxedTimeouts()],
  server: {
    host: '0.0.0.0',
    port: DEV_CLIENT_PORT,
    strictPort: true,
    proxy: {
      [WS_PATH]: { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      // Profiles API and photos live on the game server.
      '/api': { target: `http://localhost:${SERVER_PORT}` },
      '/photos': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
  build: {
    target: 'es2022',
    // three + rapier-compat (WASM inlined as base64, ~3.5 MB) are big single deps;
    // splitting buys nothing over LAN. ~1.9 MB gzipped.
    chunkSizeWarningLimit: 6000,
  },
});
