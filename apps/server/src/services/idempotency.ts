import type { Clock } from '@ito/core';
import { and, eq } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client';
import { idempotencyKeys } from '../db/schema';
import { ApiError, problemBody } from '../errors';

export interface StoredResponse {
  status: number;
  body: unknown;
}

/** 同じキーでも再送で結果が変わりうる応答は保存しない */
const NOT_STORED = new Set([408, 425, 426, 429]);

/**
 * Idempotency-Key（§12・§13）。同じ (キー, メンバー) の要求には、保存した応答をそのまま返す。
 * 変更と応答の保存は同じトランザクションで行う（途中で落ちても二重に作らない）。
 * 5xx は保存しない（再送でやり直せるように）。
 */
export function withIdempotency(
  db: Db,
  clock: Clock,
  memberId: string,
  key: string | null,
  run: (tx: DbLike) => StoredResponse,
): StoredResponse {
  return db.transaction((tx) => {
    if (key) {
      const hit = tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.memberId, memberId)))
        .get();
      if (hit) return JSON.parse(hit.response) as StoredResponse;
    }
    let result: StoredResponse;
    try {
      // 失敗したら途中の書き込みを戻す（セーブポイント）
      result = tx.transaction((sp) => run(sp));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500 || NOT_STORED.has(e.status) || !key) throw e;
      // 4xx も保存して、同じキーの再送に同じ応答を返す。変更は起きていない
      result = { status: e.status, body: problemBody(e.status, e.code, e.detail, e.extra) };
    }
    if (key && result.status < 500 && !NOT_STORED.has(result.status)) {
      tx.insert(idempotencyKeys)
        .values({ key, memberId, response: JSON.stringify(result), createdAt: clock.now() })
        .run();
    }
    return result;
  });
}
