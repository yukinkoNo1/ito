import { and, count, isNotNull, isNull } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { events } from '../db/schema';
import { ApiError } from '../errors';

/**
 * 繰り返しの予定（有効なシリーズ）は家族全体で 500 件まで。展開で覚えておくもの（回の出ない期間の検査・期間ごとの
 * 回の数・使った回の数）の数を必ず下回るようにする（上回る数の行を毎回たどると、覚えたものが入れ替わり続けて
 * 展開のたびに重くなる。総点検のレビュー 4 回目 F1・F2。§24 D41）
 */
export const MAX_ACTIVE_SERIES = 500;

export function assertSeriesRoom(db: DbLike): void {
  const row = db
    .select({ n: count() })
    .from(events)
    .where(and(isNotNull(events.rrule), isNull(events.parentId), isNull(events.deletedAt)))
    .get();
  if ((row?.n ?? 0) >= MAX_ACTIVE_SERIES) {
    throw new ApiError(
      409,
      'series_limit',
      `繰り返しの予定は家族で ${MAX_ACTIVE_SERIES} 件までです。使っていない繰り返しの予定を削除してください`,
    );
  }
}
