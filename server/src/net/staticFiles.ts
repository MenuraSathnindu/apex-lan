import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.md': 'text/plain; charset=utf-8',
};

/**
 * Serves files from `root`. Unknown paths without an extension get index.html (the app);
 * missing files with an extension get a 404, so optional assets fail fast instead of
 * coming back as HTML. Only Vite's hashed `/assets/` files are cached forever.
 */
export function createStaticHandler(root: string) {
  const indexPath = join(root, 'index.html');

  return (req: IncomingMessage, res: ServerResponse) => {
    if (!existsSync(indexPath)) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('Client not built. Run `npm run host` (or `npm run build`), or use `npm run dev` and open the Vite URL.');
      return;
    }

    let urlPath: string;
    try {
      urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      res.writeHead(400).end(); // malformed %-escape; must not crash the server
      return;
    }
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      if (extname(urlPath)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      filePath = indexPath;
    }

    const hashed = urlPath.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(filePath)
      .on('error', () => res.destroy())
      .pipe(res);
  };
}
