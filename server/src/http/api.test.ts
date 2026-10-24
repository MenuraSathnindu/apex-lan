import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { presetLivery, type AuthResponse, type ProfileSummary } from '@apex/shared';
import { ChampionshipDb } from '../db/championships.ts';
import { PlayerDb } from '../db/database.ts';
import { createApi } from './api.ts';
import { sniffImageType } from './photos.ts';

let server: Server;
let base = '';
let db: PlayerDb;
let photosDir = '';
let champs: ChampionshipDb;
const changed: ProfileSummary[] = [];

beforeAll(async () => {
  db = new PlayerDb(':memory:');
  photosDir = mkdtempSync(join(tmpdir(), 'apex-photos-'));
  champs = new ChampionshipDb(db);
  const api = createApi({ db, photosDir, pinRounds: 4, championships: champs, onProfileChanged: (p) => changed.push(p) });
  server = createServer(async (req, res) => {
    if (!(await api.handle(req, res))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  db.close();
  rmSync(photosDir, { recursive: true, force: true });
});

const post = (path: string, body: unknown, token?: string, method = 'POST') =>
  fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const create = async (name: string, pin = '1234') =>
  (await (await post('/api/profiles', { name, tag: 'ABC', pin, livery: presetLivery(2) })).json()) as AuthResponse;
const image = (format: 'png' | 'jpeg' | 'webp' | 'gif', w = 400, h = 300) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } })
    .toFormat(format)
    .toBuffer();
const upload = (buf: Buffer | string, token: string) =>
  fetch(`${base}/api/me/photo`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: buf,
  });

describe('profile API', () => {
  it('creates a profile and returns a login token', async () => {
    const res = await post('/api/profiles', { name: '  Ann  ', tag: 'ann', pin: '1234', livery: { ...presetLivery(1), number: 7 } });
    expect(res.status).toBe(201);
    const auth = (await res.json()) as AuthResponse;
    expect(auth.profile).toMatchObject({ name: 'Ann', tag: 'ANN', livery: { number: 7 }, photo: null });
    expect(auth.token.length).toBeGreaterThan(20);
    const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${auth.token}` } });
    expect(((await me.json()) as ProfileSummary).id).toBe(auth.profile.id);
  });

  it('validates new profiles and refuses duplicate names', async () => {
    for (const bad of [
      { name: 'A', tag: 'ABC', pin: '1234' },
      { name: 'Zed', tag: 'AB1', pin: '1234' },
      { name: 'Zed', tag: 'ABC', pin: '12a4' },
      { name: 'Zed', tag: 'ABC', pin: '12345' },
    ]) {
      expect((await post('/api/profiles', bad)).status).toBe(400);
    }
    expect((await post('/api/profiles', { name: 'ANN', tag: 'ABC', pin: '1234' })).status).toBe(409);
  });

  it('never stores the PIN in clear', () => {
    const row = db.db.prepare('SELECT pin_hash FROM profile WHERE name_key = ?').get('ann') as { pin_hash: string };
    expect(row.pin_hash).toMatch(/^\$2[aby]\$/);
    expect(row.pin_hash).not.toContain('1234');
  });

  it('logs in with name + PIN (any case), rejects wrong PINs, then throttles', async () => {
    const ok = await post('/api/login', { name: 'ann', pin: '1234' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as AuthResponse).profile.name).toBe('Ann');
    expect((await post('/api/login', { name: 'Ann', pin: '0000' })).status).toBe(401);
    expect((await post('/api/login', { name: 'Nobody', pin: '1234' })).status).toBe(401);
    for (let i = 0; i < 3; i++) await post('/api/login', { name: 'Ann', pin: '9999' });
    expect((await post('/api/login', { name: 'Ann', pin: '1234' })).status).toBe(429);
  });

  it('edits tag and livery for the logged-in profile only', async () => {
    const { token, profile } = await create('Ben');
    const res = await post('/api/me', { tag: 'bnn', livery: { ...profile.livery, number: 99 } }, token, 'PATCH');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tag: 'BNN', livery: { number: 99 } });
    expect(changed.at(-1)).toMatchObject({ id: profile.id, tag: 'BNN' });
    expect((await post('/api/me', { tag: 'X' }, token, 'PATCH')).status).toBe(400);
    expect((await post('/api/me', { tag: 'ABC' }, 'nonsense-token-nonsense', 'PATCH')).status).toBe(401);
  });

  it('logs out by revoking the token', async () => {
    const { token } = await create('Cat');
    expect((await post('/api/logout', {}, token)).status).toBe(200);
    expect((await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });
});

describe('photo upload', () => {
  let token = '';
  beforeAll(async () => {
    token = (await create('Dee')).token;
  });

  it('accepts JPEG / PNG / WebP and stores a 256×256 WebP under a random name', async () => {
    for (const format of ['png', 'jpeg', 'webp'] as const) {
      const res = await upload(await image(format), token);
      expect(res.status).toBe(200);
      const p = (await res.json()) as ProfileSummary;
      expect(p.photo).toMatch(/^\/photos\/[a-f0-9]{32}\.webp$/);
      const served = await fetch(base + p.photo!);
      expect(served.headers.get('content-type')).toBe('image/webp');
      const buf = Buffer.from(await served.arrayBuffer());
      expect(sniffImageType(buf)).toBe('webp');
      expect(await sharp(buf).metadata()).toMatchObject({ width: 256, height: 256, format: 'webp' });
    }
    // Replacing a photo deletes the old file.
    expect(readdirSync(photosDir)).toHaveLength(1);
  });

  it('strips metadata', async () => {
    const withExif = await sharp(await image('jpeg'))
      .withMetadata({ exif: { IFD0: { Copyright: 'secret place' } } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const p = (await (await upload(withExif, token)).json()) as ProfileSummary;
    const stored = Buffer.from(await (await fetch(base + p.photo!)).arrayBuffer());
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
  });

  it('rejects other types, fakes, broken images and big files', async () => {
    expect((await upload(await image('gif'), token)).status).toBe(400);
    expect((await upload('<svg xmlns="http://www.w3.org/2000/svg"/>', token)).status).toBe(400);
    expect((await upload('just text pretending to be a png', token)).status).toBe(400);
    const png = await image('png');
    expect((await upload(png.subarray(0, 40), token)).status).toBe(400); // truncated
    expect((await upload(Buffer.alloc(5 * 1024 * 1024 + 1, 1), token)).status).toBe(413);
    expect((await upload(png, 'not-a-real-token-at-all')).status).toBe(401);
  });

  it('serves only stored photo names', async () => {
    expect((await fetch(`${base}/photos/..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/photos/${'a'.repeat(32)}.webp`)).status).toBe(404);
  });
});

describe('stats endpoints', () => {
  it('serves profile pages and the hall of fame', async () => {
    const { profile } = await create('Eve');
    db.recordRace({
      trackId: 'monza',
      kind: 'race',
      laps: 1,
      finishedAt: 1,
      results: [
        { profileId: profile.id, position: 1, grid: 1, dnf: false, laps: 1, totalMs: 90_000, bestLapMs: 90_000, fastestLap: true, pole: false, points: 25 },
      ],
      lapTimes: [{ profileId: profile.id, lap: 1, timeMs: 90_000, sectors: [30_000, 30_000, 30_000] }],
    });
    const page = await (await fetch(`${base}/api/profiles/${profile.id}`)).json();
    expect(page).toMatchObject({ profile: { name: 'Eve' }, stats: { practice: 1, laps: 1 }, tracks: [{ trackId: 'monza', bestLapMs: 90_000 }] });
    expect((await fetch(`${base}/api/profiles/424242`)).status).toBe(404);
    expect(await (await fetch(`${base}/api/hall-of-fame`)).json()).toEqual({ tracks: ['monza'] });
    const hof = (await (await fetch(`${base}/api/hall-of-fame/monza`)).json()) as { profile: ProfileSummary; lapMs: number }[];
    expect(hof[0]).toMatchObject({ profile: { name: 'Eve' }, lapMs: 90_000 });
    expect((await fetch(`${base}/api/profiles`, { method: 'DELETE' })).status).toBe(405);
  });
});

describe('championship history', () => {
  it('lists seasons and serves one season, 404 for unknown', async () => {
    expect(await (await fetch(`${base}/api/championships`)).json()).toEqual([]);
    const v = champs.create({ name: 'Old cup', settings: { laps: 3, qualifying: { mode: 'oneShot' }, fastestLapPoint: false, tyreWear: true }, rounds: [{ trackId: 'monza', sprint: false }] }, 1);
    const list = (await (await fetch(`${base}/api/championships`)).json()) as { id: number; name: string }[];
    expect(list).toEqual([expect.objectContaining({ id: v.id, name: 'Old cup', status: 'setup', rounds: 1 })]);
    expect(await (await fetch(`${base}/api/championships/${v.id}`)).json()).toMatchObject({ id: v.id, rounds: [{ trackId: 'monza' }] });
    expect((await fetch(`${base}/api/championships/9999`)).status).toBe(404);
  });
});

describe('API robustness', () => {
  it('two profiles created with the same name at once: one 201, one 409', async () => {
    const body = { name: 'Twin', tag: 'TWN', pin: '1234' };
    const statuses = (await Promise.all([post('/api/profiles', body), post('/api/profiles', body)])).map((r) => r.status);
    expect(statuses.sort()).toEqual([201, 409]);
  });

  it('a photo that cannot be read does not take the server down', async () => {
    // A directory with a photo's name: exists, but opening it as a file fails (like a photo deleted mid-request).
    mkdirSync(join(photosDir, 'ab'.repeat(16) + '.webp'));
    await fetch(`${base}/photos/${'ab'.repeat(16)}.webp`).then((r) => r.arrayBuffer()).catch(() => null);
    expect((await fetch(`${base}/api/profiles`)).status).toBe(200);
  });

  it('PIN guesses sent in parallel are throttled too', async () => {
    const own = new PlayerDb(':memory:');
    const api = createApi({ db: own, photosDir, pinRounds: 4, now: () => 5_000_000 });
    const srv = createServer(async (req, res) => {
      if (!(await api.handle(req, res))) res.writeHead(404).end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/login`;
    const guess = (pin: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Eve', pin }) });
    try {
      await fetch(url.replace('/login', '/profiles'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Eve', tag: 'EVE', pin: '4321' }) });
      const statuses = (await Promise.all(Array.from({ length: 20 }, (_, i) => guess(String(1000 + i))))).map((r) => r.status);
      expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
      expect((await guess('4321')).status).toBe(429);
    } finally {
      srv.close();
      own.close();
    }
  });
});
