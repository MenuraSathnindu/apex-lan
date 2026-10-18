import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from './staticFiles.ts';

let root: string;
let server: Server;
let base: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'apex-static-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html>app');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  mkdirSync(join(root, 'sounds'));
  writeFileSync(join(root, 'sounds', 'engine.ogg'), 'OggS');
  server = createServer(createStaticHandler(root));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

describe('static file handler', () => {
  it('serves index.html for / and for app routes', async () => {
    for (const path of ['/', '/lobby']) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    }
  });

  it('caches hashed assets forever, other files never', async () => {
    const js = await fetch(`${base}/assets/index-abc123.js`);
    expect(js.headers.get('cache-control')).toContain('immutable');
    const ogg = await fetch(`${base}/sounds/engine.ogg`);
    expect(ogg.headers.get('content-type')).toBe('audio/ogg');
    expect(ogg.headers.get('cache-control')).toBe('no-cache');
  });

  it('404s a missing file instead of answering with the app', async () => {
    expect((await fetch(`${base}/sounds/skid.ogg`)).status).toBe(404);
  });

  it('survives malformed URLs and blocks traversal', async () => {
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${base}/..%2f..%2fsecret.txt`)).status).not.toBe(200);
    expect((await fetch(base + '/')).status).toBe(200); // still alive
  });
});
