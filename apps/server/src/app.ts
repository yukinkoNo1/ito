import type { Clock } from '@ito/core';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { every } from 'hono/combine';
import type { Db } from './db/client';
import type { Env } from './env';
import { ApiError, problemResponse } from './errors';
import { staticFiles } from './lib/static';
import type { Logger } from './logger';
import { csrf, protocolVersion } from './middleware/csrf';
import { hostCheck } from './middleware/host';
import { identity } from './middleware/identity';
import { securityHeaders } from './middleware/security-headers';
import { registerMeRoutes } from './routes/me';
import type { AppEnv } from './types';

export const BODY_LIMIT_BYTES = 32 * 1024;

export interface AppDeps {
  env: Env;
  db: Db;
  sqlite: Database.Database;
  clock: Clock;
  logger: Logger;
  /** PWA の静的配信の場所。null なら配信しない（開発時は Vite が配信する） */
  staticDir: string | null;
}

export type App = Hono<AppEnv>;

/** /api/feed/* は identity と CSRF を掛けず、連携キーだけで認証する（SPEC §14） */
export function isFeedPath(path: string): boolean {
  return path === '/api/feed' || path.startsWith('/api/feed/');
}

/**
 * Hono アプリの組み立て。経路ごとのミドルウェアの順は docs/plans/phase-0.md の表のとおり。
 */
export function createApp(deps: AppDeps): App {
  const { env, db, sqlite, clock, logger } = deps;
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) return problemResponse(c, err);
    logger.error({ err, method: c.req.method, path: c.req.path }, 'unhandled error');
    return problemResponse(c, new ApiError(500, 'internal'));
  });
  app.notFound((c) => problemResponse(c, new ApiError(404, 'not_found')));

  // リクエストの記録（メンバー ID・操作・所要時間・状態コードだけ。クエリ文字列は出さない）
  app.use('*', async (c, next) => {
    const started = clock.now();
    await next();
    const me = c.get('me') as AppEnv['Variables']['me'] | undefined;
    const token = c.get('feedToken') as AppEnv['Variables']['feedToken'] | undefined;
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: clock.now() - started,
        ...(me ? { memberId: me.id } : {}),
        ...(token ? { feedTokenName: token.name } : {}),
      },
      'request',
    );
  });
  app.use('*', securityHeaders());
  app.use('*', hostCheck(env.APP_HOST));
  app.use(
    '*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => problemResponse(c, new ApiError(413, 'payload_too_large')),
    }),
  );

  app.get('/healthz', (c) => {
    try {
      sqlite.prepare('SELECT 1').get();
      c.header('Cache-Control', 'no-store');
      return c.json({ ok: true });
    } catch {
      c.header('Cache-Control', 'no-store');
      return c.json({ ok: false }, 503);
    }
  });

  // すべての API 応答に Cache-Control: no-store（SPEC §13）
  app.use('/api/*', async (c, next) => {
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  });

  // 人の API: プロトコル版 → CSRF → identity。/api/feed/* には掛けない
  const userChain = every(protocolVersion(), csrf(env.APP_ORIGIN), identity({ env, db, clock }));
  app.use('/api/*', async (c, next) => {
    if (isFeedPath(c.req.path)) return next();
    return userChain(c, next);
  });

  registerMeRoutes(app, deps);

  if (deps.staticDir) app.use('*', staticFiles(deps.staticDir));

  return app;
}
