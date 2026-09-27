import type { Clock } from '@ito/core';
import { normalizeLogin } from '@ito/core';
import type { Context, MiddlewareHandler } from 'hono';
import type { Db } from '../db/client';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { decodeRfc2047 } from '../lib/rfc2047';
import { autoRegisterAdmin, findMemberByLogin } from '../services/members';
import type { AppEnv } from '../types';

/**
 * 要求のログインを取り出す。
 * - AUTH_MODE=tailscale: Serve が付ける Tailscale-User-Login（クライアントが送った同名ヘッダは Serve が消す）
 * - AUTH_MODE=dev（NODE_ENV=development のときだけ起動できる）: X-Dev-Login、なければ DEV_LOGIN
 * X-Dev-Login は dev モードでだけ見る（本番では無視する）。
 */
export function resolveLogin(c: Context, env: Env): string | null {
  if (env.AUTH_MODE === 'dev') {
    const dev = c.req.header('x-dev-login');
    if (dev?.trim()) return normalizeLogin(dev);
    return env.DEV_LOGIN ? normalizeLogin(env.DEV_LOGIN) : null;
  }
  const login = c.req.header('tailscale-user-login');
  return login?.trim() ? normalizeLogin(login) : null;
}

/**
 * 人の端末からの要求か（表示用フィードの FEED_ALLOW_USER_DEVICES の判定。SPEC §13.1）。
 * 本番は Tailscale-User-Login の有無。開発モードでは X-Dev-Login が付いた要求を人の端末とみなす
 * （DEV_LOGIN の既定の本人は数えない。RUNBOOK 3.）。
 */
export function isFromUserDevice(c: Context, env: Env): boolean {
  if (env.AUTH_MODE === 'dev') return Boolean(c.req.header('x-dev-login')?.trim());
  return Boolean(c.req.header('tailscale-user-login')?.trim());
}

export interface IdentityDeps {
  env: Env;
  db: Db;
  clock: Clock;
}

/** 本人確認（SPEC §14）。/api/feed/* には掛けない（app.ts で分けている） */
export function identity(deps: IdentityDeps): MiddlewareHandler<AppEnv> {
  const { env, db, clock } = deps;
  const admins = new Set(env.ADMIN_LOGINS);
  return async (c, next) => {
    const login = resolveLogin(c, env);
    if (!login) throw new ApiError(401, 'no_identity');
    let member = findMemberByLogin(db, login);
    if (!member && admins.has(login)) {
      const rawName =
        env.AUTH_MODE === 'tailscale' ? c.req.header('tailscale-user-name') : undefined;
      member =
        autoRegisterAdmin(
          db,
          clock,
          env.MAX_MEMBERS,
          login,
          rawName ? decodeRfc2047(rawName) : undefined,
        ) ?? undefined;
    }
    if (!member || member.disabledAt !== null) {
      // 画面に「このアカウント（xxx）は家族として登録されていません」と出すため、本人のログインだけを返す（ログには出さない）
      throw new ApiError(403, 'not_member', undefined, { login });
    }
    c.set('me', member);
    return next();
  };
}
