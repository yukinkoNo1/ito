import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../errors';

/**
 * Host 検査（SPEC §14 CSRF 3）。/healthz 以外のすべての要求で、Host が APP_ORIGIN のホストと
 * 一致しなければ 421。/healthz はコンテナ内のヘルスチェックが 127.0.0.1 宛てに呼ぶので除外する
 * （除外はこのパスちょうどだけ。/healthz/ や /healthz/x は除外しない）。
 */
export function hostCheck(expectedHost: string): MiddlewareHandler {
  const expected = expectedHost.toLowerCase();
  return async (c, next) => {
    if (c.req.path === '/healthz') return next();
    const host = (c.req.header('host') ?? '').trim().toLowerCase();
    if (host !== expected) throw new ApiError(421, 'misdirected');
    return next();
  };
}
