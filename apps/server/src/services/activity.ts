import {
  type ActivityDTO,
  type Clock,
  type EventRecord,
  formatMdW,
  formatTimeShort,
  toIsoJst,
  toJstParts,
  uuidv7,
} from '@ito/core';
import { and, desc, eq, gt, lt, ne, or, sql } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { type ActivityRow, activity, type MemberRow, members } from '../db/schema';

export type ActivityAction = 'create' | 'update' | 'delete' | 'restore';

function dateLabel(r: EventRecord): string {
  if (r.allDay) {
    const s = r.startDate as string;
    const e = r.endDate as string;
    return s === e ? formatMdW(s) : `${formatMdW(s)}〜${formatMdW(e)}`;
  }
  return formatMdW(toJstParts(r.startAt as number).date);
}

function timeLabel(ms: number | null): string {
  return ms === null ? 'なし' : formatTimeShort(toJstParts(ms).time);
}

function membersLabel(r: EventRecord, names: Map<string, string>): string {
  if (r.forEveryone) return '全員';
  return r.memberIds.map((id) => names.get(id) ?? '？').join('・');
}

/**
 * 人が読める差分（例「開始 8:00 → 7:00」）をサーバー側で作る（RUNBOOK Phase 1）。
 * メモの中身は差分に入れない（長くなるため「メモを変更」とだけ書く）。
 */
export function describeDiff(
  before: EventRecord,
  after: EventRecord,
  names: Map<string, string>,
): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`件名「${before.title}」→「${after.title}」`);
  if (before.allDay !== after.allDay)
    out.push(after.allDay ? '時刻あり → 終日' : '終日 → 時刻あり');
  if (dateLabel(before) !== dateLabel(after))
    out.push(`日付 ${dateLabel(before)} → ${dateLabel(after)}`);
  if (!before.allDay && !after.allDay) {
    const bs = timeLabel(before.startAt);
    const as = timeLabel(after.startAt);
    if (bs !== as) out.push(`開始 ${bs} → ${as}`);
    const be = timeLabel(before.endAt);
    const ae = timeLabel(after.endAt);
    if (be !== ae) out.push(`終了 ${be} → ${ae}`);
  }
  const bm = membersLabel(before, names);
  const am = membersLabel(after, names);
  if (bm !== am) out.push(`担当 ${bm} → ${am}`);
  if (before.location !== after.location) {
    out.push(`場所「${before.location ?? 'なし'}」→「${after.location ?? 'なし'}」`);
  }
  if (before.note !== after.note) out.push('メモを変更');
  if (before.visibility !== after.visibility)
    out.push(after.visibility === 'private' ? '内緒にした' : '家族に公開した');
  if (before.busy !== after.busy)
    out.push(after.busy ? '空き時間で「予定あり」にした' : '空き時間で「予定なし」にした');
  if (before.rrule !== after.rrule) out.push('繰り返しを変更');
  return out;
}

export function memberNames(db: DbLike): Map<string, string> {
  return new Map(
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .all()
      .map((m) => [m.id, m.name]),
  );
}

export function recordActivity(
  db: DbLike,
  clock: Clock,
  actorId: string,
  action: ActivityAction,
  event: EventRecord,
  diff: string[] = [],
): void {
  const now = clock.now();
  db.insert(activity)
    .values({
      id: uuidv7(now),
      actorId,
      eventId: event.parentId ?? event.id,
      action,
      title: event.title,
      diff: JSON.stringify(diff),
      visibility: event.visibility,
      ownerId: event.ownerId,
      createdAt: now,
    })
    .run();
}

/** 見てよい履歴: 家族の予定、または自分の非公開（非公開の履歴は持ち主にだけ見せる。§10） */
function visibleTo(meId: string) {
  return or(eq(activity.visibility, 'family'), eq(activity.ownerId, meId));
}

function toDto(row: ActivityRow, me: MemberRow): ActivityDTO {
  let detail: string | null = null;
  try {
    const diff: unknown = JSON.parse(row.diff);
    if (Array.isArray(diff) && diff.length > 0) detail = diff.map(String).join('、');
  } catch {}
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action as ActivityDTO['action'],
    eventId: row.eventId,
    title: row.title,
    detail,
    createdAt: toIsoJst(row.createdAt),
    unread: row.createdAt > me.activityReadAt && row.actorId !== me.id,
  };
}

export function listActivity(
  db: DbLike,
  me: MemberRow,
  before: string | null,
  limit: number,
): { items: ActivityDTO[]; nextBefore: string | null } {
  const where = before ? and(visibleTo(me.id), lt(activity.id, before)) : visibleTo(me.id);
  const rows = db
    .select()
    .from(activity)
    .where(where)
    .orderBy(desc(activity.id))
    .limit(limit + 1)
    .all();
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => toDto(r, me)),
    nextBefore: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export function countUnread(db: DbLike, me: MemberRow): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(activity)
    .where(
      and(visibleTo(me.id), gt(activity.createdAt, me.activityReadAt), ne(activity.actorId, me.id)),
    )
    .get();
  return row?.n ?? 0;
}

export function markActivityRead(db: DbLike, clock: Clock, me: MemberRow): number {
  const now = clock.now();
  db.update(members).set({ activityReadAt: now }).where(eq(members.id, me.id)).run();
  return now;
}
