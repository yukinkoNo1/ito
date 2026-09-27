import type { MiddlewareHandler } from 'hono';
import type { App, AppDeps } from '../app';
import { ApiError } from '../errors';
import { RateLimiter } from '../lib/rate-limit';
import { isFromUserDevice } from '../middleware/identity';
import { buildDisplayFeed, etagMatches, serializeFeed } from '../services/feed';
import { touchFeedToken, verifyFeedToken } from '../services/feed-tokens';
import type { AppEnv } from '../types';

const FEED_RATE_PER_MIN = 120;
const AUTH_FAIL_LOG_INTERVAL_MS = 60 * 1000;
const USER_DEVICE_WARN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 表示用フィード（§13.1）。identity と CSRF は掛けず、連携キーだけで認証する（ID ヘッダは人の端末の判定にだけ使う）。
 * 検査の順: Host（全体）→ メソッド（405）→ 連携キー（401）→ 人の端末（403）→ パラメータ（400）→ 回数制限（429）→ If-None-Match（304）。
 * キーが通るまでは 304 も ETag も本文も返さず、回数制限も数えない。
 */
export function registerFeedRoutes(app: App, deps: AppDeps): void {
  const { env, db, clock, logger } = deps;
  const limiter = new RateLimiter(FEED_RATE_PER_MIN, 60 * 1000, clock);
  let authFailures = 0;
  let lastAuthFailLog = Number.NEGATIVE_INFINITY;
  const lastUserDeviceWarn = new Map<string, number>();

  const guard: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      throw new ApiError(405, 'method_not_allowed', undefined, undefined, { Allow: 'GET, HEAD' });
    }
    const auth = c.req.header('authorization') ?? '';
    const m = /^Bearer\s+(\S+)$/.exec(auth.trim());
    const row = m ? verifyFeedToken(db, m[1] as string, 'display') : null;
    if (!row) {
      // 失敗のログは 1 分に 1 回までにまとめる（件数だけ。キーは出さない）
      authFailures++;
      const now = clock.now();
      if (now - lastAuthFailLog >= AUTH_FAIL_LOG_INTERVAL_MS) {
        logger.warn({ failures: authFailures }, 'feed auth failed');
        authFailures = 0;
        lastAuthFailLog = now;
      }
      throw new ApiError(401, 'feed_unauthorized', undefined, undefined, {
        'WWW-Authenticate': 'Bearer',
      });
    }
    const fromUserDevice = isFromUserDevice(c, env);
    if (fromUserDevice) {
      if (!env.FEED_ALLOW_USER_DEVICES) throw new ApiError(403, 'feed_user_device');
      const now = clock.now();
      const last = lastUserDeviceWarn.get(row.id) ?? Number.NEGATIVE_INFINITY;
      if (now - last >= USER_DEVICE_WARN_INTERVAL_MS) {
        logger.warn(
          { feedTokenName: row.name },
          'feed used from a user device (FEED_ALLOW_USER_DEVICES=true)',
        );
        lastUserDeviceWarn.set(row.id, now);
      }
    }
    c.set('feedToken', { id: row.id, name: row.name });
    await next();
    // 最終利用時刻（5 分に 1 回まで）。人の端末からなら、その時刻も
    if (c.res.status < 400) touchFeedToken(db, row, clock.now(), fromUserDevice);
  };

  app.use('/api/feed/*', guard);

  app.get('/api/feed/display', (c) => {
    const params = new URL(c.req.url).searchParams;
    for (const key of params.keys()) {
      if (key !== 'days')
        throw new ApiError(
          400,
          'invalid_query',
          `知らないパラメータがあります: ${key.slice(0, 20)}`,
        );
    }
    const daysValues = params.getAll('days');
    if (daysValues.length > 1)
      throw new ApiError(400, 'invalid_query', 'days は 1 つだけ指定してください');
    const rawDays = daysValues[0];
    if (rawDays !== undefined && !/^[1-3]$/.test(rawDays)) {
      throw new ApiError(400, 'invalid_query', 'days は 1〜3 の整数にしてください');
    }
    const days = rawDays === undefined ? 3 : Number(rawDays);

    const token = c.get('feedToken');
    const limited = limiter.hit(token.id);
    if (!limited.ok) {
      throw new ApiError(429, 'rate_limited', undefined, undefined, {
        'Retry-After': String(limited.retryAfterSec),
      });
    }

    const { body, etag } = serializeFeed(buildDisplayFeed(db, clock.now(), days));
    c.header('ETag', etag);
    if (etagMatches(c.req.header('if-none-match'), etag)) return c.body(null, 304);
    c.header('Content-Type', 'application/json; charset=utf-8');
    return c.body(body, 200);
  });
}
