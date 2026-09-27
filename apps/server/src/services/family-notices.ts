import { canSeeContent, type EventRecord, readMemberSettings, uuidv7 } from '@ito/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { pendingNotices } from '../db/schema';
import { listActiveMembers } from './members';

export type NoticeAction = 'create' | 'update' | 'delete' | 'restore';

const VERBS: Record<NoticeAction, string> = {
  create: '追加しました',
  update: '変更しました',
  delete: '削除しました',
  restore: '元に戻しました',
};

/**
 * 家族の変更を、受け取る人ごとのまとめ待ちに積む（§15。履歴を書くところから呼ぶ）。
 * - 書いた人には送らない。設定が off の人、mine で担当でない人（全員の予定は担当に含む）には積まない
 * - 他人の非公開は「予定あり」と書く（§10）
 * - まとめ待ちに同じ予定があれば 1 つにする（追加してすぐ直したら「追加しました」のまま、文は新しいものに）
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
  for (const m of active) {
    if (m.id === actorId) continue;
    const mode = readMemberSettings(m.settings).notifications.familyChanges;
    if (mode === 'off') continue;
    const mine = event.forEveryone || event.memberIds.includes(m.id);
    if (mode === 'mine' && !mine) continue;
    const title = canSeeContent(event, m.id) ? event.title : '予定あり';
    const existing = db
      .select()
      .from(pendingNotices)
      .where(
        and(
          eq(pendingNotices.recipientId, m.id),
          eq(pendingNotices.eventId, eventId),
          isNull(pendingNotices.flushedAt),
        ),
      )
      .get();
    const nextAction: NoticeAction =
      existing?.action === 'create' && action === 'update' ? 'create' : action;
    const summary = `${actor.name}が「${title}」を${VERBS[nextAction]}`;
    if (existing) {
      db.update(pendingNotices)
        .set({ action: nextAction, summary, actorId, createdAt: now })
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
