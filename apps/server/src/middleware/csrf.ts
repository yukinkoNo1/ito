import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../errors';

/** 対応するプロトコル版（X-Ito-Client の値。SPEC §12） */
export const SUPPORTED_PROTOCOLS: ReadonlySet<string> = new Set(['1']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * プロトコル版の検査。X-Ito-Client があって対応しない版なら 426 client_outdated
 * （サーバーを更新した直後に古い PWA が送ってくる送信待ちを捨てさせないため）。
 */
export function protocolVersion(): MiddlewareHandler {
  return async (c, next) => {
    const v = c.req.header('x-ito-client');
    if (v !== undefined && !SUPPORTED_PROTOCOLS.has(v.trim())) {
      throw new ApiError(426, 'client_outdated');
    }
    return next();
  };
}

/**
 * CSRF の検査（SPEC §14）。状態を変える要求（GET・HEAD・OPTIONS 以外）だけに掛ける。
 * 1. X-Ito-Client と Content-Type: application/json が必須（クロスサイトではプリフライトが要り、CORS を許可しないので失敗する）
 * 2. Origin が APP_ORIGIN と一致しなければ 403。Sec-Fetch-Site があれば same-origin 以外は 403
 * （3. Host の検査は host.ts で全要求に掛けている）
 */
export function csrf(appOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    if (!isStateChanging(c.req.method)) return next();
    if (!c.req.header('x-ito-client')) throw new ApiError(403, 'csrf', 'X-Ito-Client がありません');
    const contentType = c.req.header('content-type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      throw new ApiError(403, 'csrf', 'Content-Type は application/json にしてください');
    }
    if (c.req.header('origin') !== appOrigin) {
      throw new ApiError(403, 'csrf', 'Origin が一致しません');
    }
    const site = c.req.header('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin') {
      throw new ApiError(403, 'csrf', 'Sec-Fetch-Site が same-origin ではありません');
    }
    return next();
  };
}
