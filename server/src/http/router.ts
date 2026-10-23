import type { IncomingMessage, ServerResponse } from 'node:http';

/** Thrown by handlers (and body readers) to answer with an HTTP error. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  /** Regex groups from the route pattern. */
  params: string[];
  url: URL;
}

type Handler = (ctx: RequestContext) => Promise<void> | void;

/**
 * A tiny method + path router for the JSON API. `handle()` returns false when no route
 * matches, so the caller can fall through to static files.
 */
export class Router {
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

  on(method: string, pattern: RegExp, handler: Handler): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://local');
    } catch {
      return false;
    }
    const matching = this.routes.filter((r) => r.pattern.test(url.pathname));
    if (!matching.length) return false;
    const route = matching.find((r) => r.method === req.method);
    try {
      if (!route) throw new HttpError(405, 'method not allowed');
      await route.handler({ req, res, url, params: url.pathname.match(route.pattern)!.slice(1) });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[api]', err);
      if (!res.headersSent) sendJson(res, status, { error: err instanceof HttpError ? err.message : 'server error' });
      else res.end();
    }
    return true;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

/** Reads the whole body, refusing anything larger than `limit` bytes (413). */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) {
    req.resume();
    return Promise.reject(new HttpError(413, 'too large'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<Record<string, unknown>> {
  const body = await readBody(req, limit);
  try {
    const v = JSON.parse(body.toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'expected a JSON object');
  }
}
