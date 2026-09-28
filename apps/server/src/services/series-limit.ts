import { type Clock, parseRrule, seriesEnded, todayJst, toJstParts } from '@ito/core';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { events } from '../db/schema';
import { ApiError } from '../errors';

/**
 * 繰り返しの予定（終わっていないシリーズ）は持ち主ごとに 100 件まで。家族全体で数えると、1 人がほかの人に消せない
 * 非公開の繰り返しで上限を埋めて、みんなを締め出せるので、持ち主ごとに数える（総点検のレビュー 5 回目 G1。§24 D41）。
 * 終わった繰り返し（UNTIL が過ぎた・COUNT を使い切った。「これ以降」で分けた前の部分もこれになる）は数えない
 * （数えると、ふつうに何年か使うと作れなくなる。6 回目 H2）。
 * 終わったものを含めても 1 人 400 件まで。家族は最大 8 人（§24 D17）なので合計 3,200 件で、展開で覚えておくもの
 * （回の出ない期間の検査・期間ごとの回の数。使った順に 4,000）の数を必ず下回る（上回る数の行を毎回たどると、
 * 覚えたものが入れ替わり続けて展開のたびに重くなる。4 回目 F1・F2）。範囲より前に終わった規則は展開で何も覚えない
 */
export const MAX_SERIES_PER_OWNER = 100;
export const MAX_SERIES_WITH_ENDED_PER_OWNER = 400;

/** 数えるのに使う行の中身 */
export interface SeriesShape {
  rrule: string | null;
  allDay: boolean;
  startAt: number | null;
  startDate: string | null;
}

/**
 * その持ち主のシリーズとして next（作る・繰り返しにする・分けた後ろ・戻す・終わりを変える行）を置けるか（置けなければ
 * 409 series_limit）。selfId の行（変える前の自分）は数えずに next を 1 件として数え、終わっていないものの数は
 * next が終わっていないときだけ確かめる（終わったものを作る・戻すのは、終わっていないものを増やさない）
 */
export function assertSeriesRoom(
  db: DbLike,
  clock: Clock,
  ownerId: string,
  next: SeriesShape,
  selfId: string | null = null,
): void {
  const rows = db
    .select({
      rrule: events.rrule,
      allDay: events.allDay,
      startAt: events.startAt,
      startDate: events.startDate,
    })
    .from(events)
    .where(
      and(
        eq(events.ownerId, ownerId),
        isNotNull(events.rrule),
        isNull(events.parentId),
        isNull(events.deletedAt),
        selfId === null ? undefined : ne(events.id, selfId),
      ),
    )
    .all();
  if (rows.length + 1 > MAX_SERIES_WITH_ENDED_PER_OWNER) {
    throw new ApiError(
      409,
      'series_limit',
      `繰り返しの予定は、終わったものを含めて 1 人 ${MAX_SERIES_WITH_ENDED_PER_OWNER} 件までです。終わった繰り返しの予定を削除してください`,
    );
  }
  const today = todayJst(clock.now());
  if (ended(next, today)) return;
  let active = 0;
  for (const r of rows) if (!ended(r, today)) active++;
  if (active + 1 > MAX_SERIES_PER_OWNER) {
    throw new ApiError(
      409,
      'series_limit',
      `繰り返しの予定（終わっていないもの）は 1 人 ${MAX_SERIES_PER_OWNER} 件までです。使っていない繰り返しの予定を削除してください`,
    );
  }
}

/** 今の時計で終わったシリーズか（繰り返しでない行は数えないので true） */
export function seriesRowEnded(r: SeriesShape, clock: Clock): boolean {
  return ended(r, todayJst(clock.now()));
}

/** 今日以降に始まる回がもうないシリーズか（規則が読めない・開始がない行は展開されないので、終わりとみなす） */
function ended(r: SeriesShape, today: string): boolean {
  const parsed = r.rrule ? parseRrule(r.rrule) : null;
  if (!parsed?.ok) return true;
  let dtstart: { date: string; time: string };
  if (r.allDay) {
    if (!r.startDate) return true;
    dtstart = { date: r.startDate, time: '00:00' };
  } else {
    if (r.startAt === null) return true;
    const p = toJstParts(r.startAt);
    dtstart = { date: p.date, time: p.time };
  }
  return seriesEnded(parsed.rule, dtstart, today);
}
