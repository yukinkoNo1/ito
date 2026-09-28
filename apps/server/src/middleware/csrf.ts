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
 * CSRF の検査（SPEC §14）。人の API（/api/*。/api/feed/* を除く）に掛ける。
 * 1. X-Ito-Client と Content-Type: application/json が必須（クロスサイトではプリフライトが要り、CORS を許可しないので失敗する）
 * 2. Origin が APP_ORIGIN と一致しなければ 403。Sec-Fetch-Site があれば same-origin 以外は 403
 * （3. Host の検査は host.ts で全要求に掛けている）
 * GET・HEAD も、アプリからの要求（X-Ito-Client あり・Sec-Fetch-Site があれば same-origin）だけにする。
 * クロスサイトのページから重い全件同期を何度も作らせない・圧縮した応答の長さを測らせないため（総点検 A3・A4。§24 D39）。
 * ページの遷移（/api の外）には掛からない
 */
export function csrf(appOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    if (!isStateChanging(c.req.method)) {
      if (!c.req.header('x-ito-client'))
        throw new ApiError(403, 'csrf', 'X-Ito-Client がありません');
      const site = c.req.header('sec-fetch-site');
      if (site !== undefined && site !== 'same-origin') {
        throw new ApiError(403, 'csrf', 'Sec-Fetch-Site が same-origin ではありません');
      }
      return next();
    }
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

/**
 * 状態を変える要求の本文を、本人と権限を確かめる前に読み切る（総点検 A1・A2。§24 D39）。
 * 本文をあとから送って要求を開いたままにし、そのあいだに無効化・降格されても、前の権限で書き込ませないため。
 * 本文の上限（32KB）は全体の bodyLimit が効く
 */
export function readBodyFirst(): MiddlewareHandler {
  return async (c, next) => {
    if (isStateChanging(c.req.method)) {
      try {
        await c.req.arrayBuffer();
      } catch {
        // 送る途中で切れた（通信が途切れたスマホなど）。500 と ERROR のログにしない（総点検のレビュー C7）
        throw new ApiError(400, 'body_incomplete');
      }
    }
    return next();
  };
}
