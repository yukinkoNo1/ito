import { canSeeContent, type EventRecord, readMemberSettings, uuidv7 } from '@ito/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { type MemberRow, members, type PendingNoticeRow, pendingNotices } from '../db/schema';
import { listActiveMembers } from './members';
import { loadActiveExceptions } from './records';

export type NoticeAction = 'create' | 'update' | 'delete' | 'restore';

const VERBS: Record<NoticeAction, string> = {
  create: '追加しました',
  update: '変更しました',
  delete: '削除しました',
  restore: '元に戻しました',
};

const HIDDEN_TITLE = '予定あり';

function isNoticeAction(v: string): v is NoticeAction {
  return v in VERBS;
}

/** まとめ待ちの 1 行の文（「お母さんが「歯医者」を追加しました」） */
export function noticeSummary(actorName: string, title: string, action: string): string {
  return `${actorName}が「${title}」を${isNoticeAction(action) ? VERBS[action] : VERBS.update}`;
}

/** その人に見せる件名（他人の非公開は「予定あり」。§10） */
export function noticeTitle(
  event: Pick<EventRecord, 'title' | 'visibility' | 'ownerId'>,
  viewerId: string,
): string {
  return canSeeContent(event, viewerId) ? event.title : HIDDEN_TITLE;
}

/** その人がこの予定の変更を受け取るか（設定が off なら受け取らない、mine は担当＝全員の予定を含む だけ。§15） */
export function wantsFamilyNotice(
  member: MemberRow,
  event: Pick<EventRecord, 'forEveryone' | 'memberIds'>,
): boolean {
  const mode = readMemberSettings(member.settings).notifications.familyChanges;
  if (mode === 'off') return false;
  return mode === 'all' || event.forEveryone || event.memberIds.includes(member.id);
}

function unflushedRows(db: DbLike, recipientId: string, eventId: string): PendingNoticeRow[] {
  return db
    .select()
    .from(pendingNotices)
    .where(
      and(
        eq(pendingNotices.recipientId, recipientId),
        eq(pendingNotices.eventId, eventId),
        isNull(pendingNotices.flushedAt),
      ),
    )
    .all();
}

/**
 * 家族の変更を、受け取る人ごとのまとめ待ちに積む（§15。履歴を書くところから呼ぶ）。
 * - 書いた人には送らない。設定が off の人、mine で担当でない人（全員の予定は担当に含む）には積まない
 * - 他人の非公開は「予定あり」と書く（§10）
 * - まとめ待ちに同じ人の同じ予定の変更があれば 1 つにする（追加してすぐ直したら「追加しました」のまま、文は新しいものに）
 * - 受け取らなくなった人（予定・シリーズそのものの変更で担当から外れた mine の人。「この回だけ」の担当にもいない人）の、
 *   その予定のまとめ待ちは消す
 * - 見えなくなった人（2 分以内に非公開にされた）の、ほかの人の変更の行も件名を伏せる（前の件名を送らないため）。
 *   見える人の行は、その変更のときの件名（「この回だけ」の件名など）のまま
 */
export function enqueueFamilyNotices(
  db: DbLike,
  now: number,
  actorId: string,
  action: NoticeAction,
  event: EventRecord,
): void {
  const active = listActiveMembers(db);
  const actor = active.find((m) => m.id === actorId);
  if (!actor) return;
  const eventId = event.parentId ?? event.id;
  const names = new Map(
    db
      .select()
      .from(members)
      .all()
      .map((m) => [m.id, m.name]),
  );
  // 「この回だけ」の担当（例外行）。シリーズの変更で、その回の担当の人のまとめ待ちを消さないために見る
  let exceptions: EventRecord[] | null = null;
  const assignedToAnOccurrence = (memberId: string) => {
    exceptions ??= loadActiveExceptions(db, eventId);
    return exceptions.some((e) => e.forEveryone || e.memberIds.includes(memberId));
  };
  for (const m of active) {
    if (m.id === actorId) continue;
    const rows = unflushedRows(db, m.id, eventId);
    if (!canSeeContent(event, m.id)) {
      for (const r of rows) {
        if (r.actorId === actorId) continue;
        db.update(pendingNotices)
          .set({ summary: noticeSummary(names.get(r.actorId) ?? '家族', HIDDEN_TITLE, r.action) })
          .where(eq(pendingNotices.id, r.id))
          .run();
      }
    }
    if (!wantsFamilyNotice(m, event)) {
      // 例外行（1 回だけの変更）の担当はシリーズの担当と違うことがあるので、消すのは予定・シリーズそのものの変更で、
      // どの回の担当にもいないときだけ
      if (event.parentId === null && !assignedToAnOccurrence(m.id)) {
        for (const r of rows) db.delete(pendingNotices).where(eq(pendingNotices.id, r.id)).run();
      }
      continue;
    }
    const title = noticeTitle(event, m.id);
    const existing = rows.find((r) => r.actorId === actorId);
    const nextAction: NoticeAction =
      existing?.action === 'create' && action === 'update' ? 'create' : action;
    const summary = noticeSummary(actor.name, title, nextAction);
    if (existing) {
      db.update(pendingNotices)
        .set({ action: nextAction, summary, createdAt: now })
        .where(eq(pendingNotices.id, existing.id))
        .run();
      continue;
    }
    db.insert(pendingNotices)
      .values({
        id: uuidv7(now),
        recipientId: m.id,
        actorId,
        eventId,
        action: nextAction,
        summary,
        createdAt: now,
        flushedAt: null,
      })
      .run();
  }
}

/**
 * その予定のまとめ待ちの件名を、持ち主以外には伏せる（家族の繰り返しを「これ以降」で非公開にしたとき）。
 * 回ごとの行を分けられないので、シリーズの行をまとめて伏せる（履歴を持ち主だけにするのと同じ。安全側。
 * §24 D39 (4)。総点検のレビュー C4）
 */
export function hidePendingNoticesOf(db: DbLike, eventId: string, ownerId: string): void {
  const names = new Map(
    db
      .select()
      .from(members)
      .all()
      .map((m) => [m.id, m.name]),
  );
  const rows = db
    .select()
    .from(pendingNotices)
    .where(and(eq(pendingNotices.eventId, eventId), isNull(pendingNotices.flushedAt)))
    .all();
  for (const r of rows) {
    if (r.recipientId === ownerId) continue;
    db.update(pendingNotices)
      .set({ summary: noticeSummary(names.get(r.actorId) ?? '家族', HIDDEN_TITLE, r.action) })
      .where(eq(pendingNotices.id, r.id))
      .run();
  }
}
