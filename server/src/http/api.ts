import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcrypt';
import {
  NAME_MAX_LENGTH,
  PROFILE_RULES,
  isPin,
  presetLivery,
  sanitizeLivery,
  sanitizeName,
  sanitizeTag,
  type AuthResponse,
  type ProfileSummary,
} from '@apex/shared';
import type { ChampionshipStore } from '../db/championships.ts';
import { PlayerDb, type Profile } from '../db/database.ts';
import { deletePhoto, PHOTO_FILE, processPhoto, savePhoto } from './photos.ts';
import { HttpError, readBody, readJson, Router, sendJson, type RequestContext } from './router.ts';

export interface ApiOptions {
  db: PlayerDb;
  photosDir: string;
  /** Championship seasons (read-only history endpoints). */
  championships?: ChampionshipStore;
  /** bcrypt cost (tests use a low one). */
  pinRounds?: number;
  /** Called after a profile's public details changed (tag, livery, photo), so the room can update. */
  onProfileChanged?: (profile: ProfileSummary) => void;
  now?: () => number;
}

/** Failed PIN attempts allowed per address per window, before answering 429. */
const LOGIN_LIMIT = { attempts: 5, windowMs: 60_000 };

/**
 * The profile API. PINs are bcrypt-hashed, which keeps casual snooping out on a LAN among
 * friends — it is not real security (4 digits, plain http). See docs/PROFILES.md.
 */
export function createApi(opts: ApiOptions): Router {
  const { db, photosDir } = opts;
  const rounds = opts.pinRounds ?? 10;
  const now = opts.now ?? Date.now;
  const failures = new Map<string, number[]>();
  // Compared against when the name is unknown, so the response time doesn't reveal which names exist.
  const dummyHash = bcrypt.hashSync('0000', rounds);

  const authed = (ctx: RequestContext): { profile: Profile; token: string } => {
    const header = ctx.req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const profile = token ? db.profileForToken(token, now()) : null;
    if (!profile) throw new HttpError(401, 'not logged in');
    return { profile, token };
  };
  const changed = (id: number) => {
    const p = db.profile(id);
    if (p) opts.onProfileChanged?.(PlayerDb.summary(p));
    return p!;
  };
  const throttle = (ctx: RequestContext) => {
    const ip = ctx.req.socket.remoteAddress ?? '?';
    const recent = (failures.get(ip) ?? []).filter((t) => now() - t < LOGIN_LIMIT.windowMs);
    failures.set(ip, recent);
    if (recent.length >= LOGIN_LIMIT.attempts) throw new HttpError(429, 'too many attempts — wait a minute');
    return () => recent.push(now());
  };

  const router = new Router();

  router.on('POST', /^\/api\/profiles$/, async (ctx) => {
    const body = await readJson(ctx.req);
    const name = sanitizeName(body.name);
    if (!name || name.length < PROFILE_RULES.nameMin) throw new HttpError(400, `name must be ${PROFILE_RULES.nameMin}–${NAME_MAX_LENGTH} characters`);
    const tag = sanitizeTag(body.tag);
    if (!tag) throw new HttpError(400, 'tag must be 3 letters');
    if (!isPin(body.pin)) throw new HttpError(400, 'PIN must be 4 digits');
    const livery = sanitizeLivery(body.livery, presetLivery(0));
    if (db.profileByName(name)) throw new HttpError(409, 'that name is taken');
    const profile = db.createProfile(name, tag, livery, await bcrypt.hash(body.pin, rounds), now());
    const res: AuthResponse = { profile: PlayerDb.summary(profile), token: db.issueToken(profile.id, now()) };
    sendJson(ctx.res, 201, res);
  });

  router.on('POST', /^\/api\/login$/, async (ctx) => {
    const fail = throttle(ctx);
    const body = await readJson(ctx.req);
    const profile = typeof body.name === 'string' ? db.profileByName(body.name) : null;
    const ok = isPin(body.pin) && (await bcrypt.compare(body.pin, profile?.pinHash ?? dummyHash));
    if (!profile || !ok) {
      fail();
      throw new HttpError(401, 'wrong name or PIN');
    }
    const res: AuthResponse = { profile: PlayerDb.summary(profile), token: db.issueToken(profile.id, now()) };
    sendJson(ctx.res, 200, res);
  });

  router.on('POST', /^\/api\/logout$/, (ctx) => {
    const { token } = authed(ctx);
    db.revokeToken(token);
    sendJson(ctx.res, 200, { ok: true });
  });

  router.on('GET', /^\/api\/me$/, (ctx) => {
    sendJson(ctx.res, 200, PlayerDb.summary(authed(ctx).profile));
  });

  router.on('PATCH', /^\/api\/me$/, async (ctx) => {
    const { profile } = authed(ctx);
    const body = await readJson(ctx.req);
    if (body.tag !== undefined) {
      const tag = sanitizeTag(body.tag);
      if (!tag) throw new HttpError(400, 'tag must be 3 letters');
      db.setTag(profile.id, tag, now());
    }
    if (body.livery !== undefined) db.setLivery(profile.id, sanitizeLivery(body.livery, profile.livery), now());
    sendJson(ctx.res, 200, PlayerDb.summary(changed(profile.id)));
  });

  router.on('PUT', /^\/api\/me\/photo$/, async (ctx) => {
    const { profile } = authed(ctx);
    const webp = await processPhoto(await readBody(ctx.req, PROFILE_RULES.photoMaxBytes));
    const file = savePhoto(photosDir, webp);
    deletePhoto(photosDir, db.setPhoto(profile.id, file, now()));
    sendJson(ctx.res, 200, PlayerDb.summary(changed(profile.id)));
  });

  router.on('DELETE', /^\/api\/me\/photo$/, (ctx) => {
    const { profile } = authed(ctx);
    deletePhoto(photosDir, db.setPhoto(profile.id, null, now()));
    sendJson(ctx.res, 200, PlayerDb.summary(changed(profile.id)));
  });

  router.on('GET', /^\/api\/profiles$/, (ctx) => sendJson(ctx.res, 200, db.profiles()));

  router.on('GET', /^\/api\/profiles\/(\d{1,9})$/, (ctx) => {
    const page = db.profilePage(Number(ctx.params[0]));
    if (!page) throw new HttpError(404, 'no such profile');
    sendJson(ctx.res, 200, page);
  });

  router.on('GET', /^\/api\/hall-of-fame$/, (ctx) => sendJson(ctx.res, 200, { tracks: db.tracksWithLaps() }));

  router.on('GET', /^\/api\/hall-of-fame\/([a-z0-9-]{1,64})$/, (ctx) => sendJson(ctx.res, 200, db.hallOfFame(ctx.params[0]!)));

  router.on('GET', /^\/api\/championships$/, (ctx) => sendJson(ctx.res, 200, opts.championships?.list() ?? []));

  router.on('GET', /^\/api\/championships\/(\d{1,9})$/, (ctx) => {
    const view = opts.championships?.view(Number(ctx.params[0]));
    if (!view) throw new HttpError(404, 'no such season');
    sendJson(ctx.res, 200, view);
  });

  // Photos: random names, never rewritten, so they can be cached forever.
  router.on('GET', /^\/photos\/([^/]+)$/, (ctx) => {
    const file = ctx.params[0]!;
    const path = join(photosDir, file);
    if (!PHOTO_FILE.test(file) || !existsSync(path)) throw new HttpError(404, 'not found');
    ctx.res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    });
    createReadStream(path).pipe(ctx.res);
  });

  return router;
}
