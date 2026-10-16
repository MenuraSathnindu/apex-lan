import { defineConfig } from 'vite';
import { DEV_CLIENT_PORT, SERVER_PORT, WS_PATH } from '@apex/shared';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: DEV_CLIENT_PORT,
    strictPort: true,
    proxy: {
      [WS_PATH]: { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  build: {
    target: 'es2022',
    // three + rapier-compat (WASM inlined as base64, ~3.5 MB) are big single deps;
    // splitting buys nothing over LAN. ~1.8 MB gzipped.
    chunkSizeWarningLimit: 6000,
  },
});
