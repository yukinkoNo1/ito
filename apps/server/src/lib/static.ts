import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Context, MiddlewareHandler } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** ハッシュ付きの資産（/assets/）は長期キャッシュ、それ以外（index.html・sw.js・manifest・アイコン）は no-cache（SPEC §20） */
function cacheControlFor(urlPath: string): string {
  return urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

async function sendFile(c: Context, filePath: string, cacheControl: string): Promise<Response> {
  const body = await readFile(filePath);
  const type = TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Content-Length': String(body.byteLength),
    'Cache-Control': cacheControl,
  };
  if (c.req.method === 'HEAD') return c.body(null, 200, headers);
  return c.body(new Uint8Array(body), 200, headers);
}

/**
 * PWA の静的配信と SPA フォールバック。/api/ と /healthz には触れない
 * （/api/export へのページ遷移が index.html にすり替わらないように。SPEC §21 セキュリティ回帰）。
 */
export function staticFiles(root: string): MiddlewareHandler {
  const rootAbs = path.resolve(root);
  const indexPath = path.join(rootAbs, 'index.html');
  return async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next();
    const urlPath = c.req.path;
    if (urlPath === '/api' || urlPath.startsWith('/api/') || urlPath === '/healthz') return next();
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return next();
    }
    if (decoded.includes('\0') || decoded.includes('\\')) return next();
    const filePath = path.resolve(rootAbs, `.${decoded}`);
    if (filePath !== rootAbs && !filePath.startsWith(rootAbs + path.sep)) return next();
    const info = await stat(filePath).catch(() => null);
    if (info?.isFile()) return sendFile(c, filePath, cacheControlFor(decoded));
    // 拡張子のないパスは画面のルート → index.html（ハッシュなしなので no-cache）
    if (!path.extname(decoded)) {
      const index = await stat(indexPath).catch(() => null);
      if (index?.isFile()) return sendFile(c, indexPath, 'no-cache');
    }
    return next();
  };
}
