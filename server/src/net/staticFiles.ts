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
};

/** Serves files from `root`, falling back to index.html. */
export function createStaticHandler(root: string) {
  const indexPath = join(root, 'index.html');

  return (req: IncomingMessage, res: ServerResponse) => {
    if (!existsSync(indexPath)) {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('Client not built. Run `npm run build`, or use `npm run dev` and open the Vite URL.');
      return;
    }

    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root + sep) && filePath !== root) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = indexPath;

    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': filePath === indexPath ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(filePath).pipe(res);
  };
}
