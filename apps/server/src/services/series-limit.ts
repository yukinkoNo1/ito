import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { events } from '../db/schema';
import { ApiError } from '../errors';

/**
 * 繰り返しの予定（有効なシリーズ）は持ち主ごとに 100 件まで。家族は最大 8 人（§24 D17）なので合計 800 件で、
 * 展開で覚えておくもの（回の出ない期間の検査・期間ごとの回の数・使った回の数。使った順に 4,000〜20,000）の数を
 * 必ず下回る（上回る数の行を毎回たどると、覚えたものが入れ替わり続けて展開のたびに重くなる。総点検のレビュー
 * 4 回目 F1・F2）。家族全体で数えると、1 人がほかの人に消せない非公開の繰り返しで上限を埋めて、みんなを締め出せる
 * ので、持ち主ごとに数える（5 回目 G1。§24 D41）
 */
export const MAX_SERIES_PER_OWNER = 100;

/** その持ち主のシリーズを 1 つ増やせるか（増やせなければ 409 series_limit） */
export function assertSeriesRoom(db: DbLike, ownerId: string): void {
  const row = db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.ownerId, ownerId),
        isNotNull(events.rrule),
        isNull(events.parentId),
        isNull(events.deletedAt),
      ),
    )
    .get();
  if ((row?.n ?? 0) >= MAX_SERIES_PER_OWNER) {
    throw new ApiError(
      409,
      'series_limit',
      `繰り返しの予定は 1 人 ${MAX_SERIES_PER_OWNER} 件までです。使っていない繰り返しの予定を削除してください`,
    );
  }
}
