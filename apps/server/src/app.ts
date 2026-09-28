import type { Clock } from '@ito/core';
import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { every } from 'hono/combine';
import { compress } from 'hono/compress';
import type { Db } from './db/client';
import type { Env } from './env';
import { ApiError, problemResponse } from './errors';
import { staticFiles } from './lib/static';
import type { Logger } from './logger';
import { csrf, protocolVersion } from './middleware/csrf';
import { hostCheck } from './middleware/host';
import { identity } from './middleware/identity';
import { securityHeaders } from './middleware/security-headers';
import { registerEventRoutes } from './routes/events';
import { registerExportRoutes } from './routes/export';
import { registerFeedRoutes } from './routes/feed';
import { registerMeRoutes } from './routes/me';
import { registerMemberRoutes } from './routes/members';
import { registerParseRoutes } from './routes/parse';
import { registerPushRoutes } from './routes/push';
import type { AiClient } from './services/ai-client';
import { countSubscriptions } from './services/push';
import type { PushSender } from './services/push-sender';
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
  /** Web Push（VAPID の鍵がなければ publicKey・sender とも null。§15） */
  push?: PushDeps;
  /** 一言入力の AI（ANTHROPIC_API_KEY がなければ null。§16） */
  ai?: AiClient | null;
}

export interface PushDeps {
  publicKey: string | null;
  sender: PushSender | null;
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
  // すべての API 応答に Cache-Control: no-store（§13）。Host 検査（421）や本文の上限（413）の応答にも付くよう、その前に置く
  app.use('*', async (c, next) => {
    await next();
    if (c.req.path === '/api' || c.req.path.startsWith('/api/'))
      c.res.headers.set('Cache-Control', 'no-store');
  });
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

  // 人の API: プロトコル版 → CSRF → identity。/api/feed/* には掛けない
  const userChain = every(protocolVersion(), csrf(env.APP_ORIGIN), identity({ env, db, clock }));
  app.use('/api/*', async (c, next) => {
    if (isFeedPath(c.req.path)) return next();
    return userChain(c, next);
  });

  // 全件同期は大きくなる（1 年分で約 1.4MB）ので gzip で送る（§19 の 1MB は転送量。§24 D38）。
  // 応答には送り手が入れた秘密（CSRF のトークンなど）を返さないので、圧縮による推測（BREACH）の対象にならない
  app.use('/api/sync', compress({ encoding: 'gzip' }));

  registerFeedRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerMemberRoutes(app, deps, (memberId) => countSubscriptions(db, memberId));
  registerPushRoutes(app, { ...deps, push: deps.push ?? { publicKey: null, sender: null } });
  registerParseRoutes(app, { ...deps, ai: deps.ai ?? null });
  registerExportRoutes(app, deps);

  if (deps.staticDir) {
    // JS・CSS・HTML・manifest は gzip で送る（§19 の初回の JS は gzip の大きさで決めている。§24 D38）
    const gzip = compress({ encoding: 'gzip' });
    app.use('*', (c, next) =>
      c.req.path === '/api' || c.req.path.startsWith('/api/') || c.req.path === '/healthz'
        ? next()
        : gzip(c, next),
    );
    app.use('*', staticFiles(deps.staticDir));
  }

  return app;
}
