import { canSeeContent, type ReminderPrefDTO } from '@ito/core';
import { eq } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { type MemberRow, reminderPrefs } from '../db/schema';
import { ApiError } from '../errors';
import { loadEvent } from './records';

function parseOffsets(json: string): number[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

/** 自分の通知（予定ごと。§10 reminder_prefs）。行のない予定は本人の既定値（Phase 4） */
export function listMyReminderPrefs(db: DbLike, memberId: string): ReminderPrefDTO[] {
  return db
    .select()
    .from(reminderPrefs)
    .where(eq(reminderPrefs.memberId, memberId))
    .all()
    .map((r) => ({ eventId: r.eventId, offsets: parseOffsets(r.offsets) }));
}

/**
 * PUT /api/events/:id/reminders（本人の通知。最大 3、-10080〜1440。重なりは 1 つに、早い順に）。
 * 見られない予定（他人の非公開）には付けられない
 */
export function setMyReminders(
  db: DbLike,
  me: MemberRow,
  eventId: string,
  offsets: number[],
): ReminderPrefDTO {
  const event = loadEvent(db, eventId);
  if (!event || event.deletedAt !== null || event.parentId !== null) {
    throw new ApiError(404, 'not_found');
  }
  if (!canSeeContent(event, me.id)) {
    throw new ApiError(403, 'forbidden', 'ほかの家族の内緒の予定には通知を付けられません');
  }
  const sorted = [...new Set(offsets)].sort((a, b) => a - b);
  db.insert(reminderPrefs)
    .values({ eventId, memberId: me.id, offsets: JSON.stringify(sorted) })
    .onConflictDoUpdate({
      target: [reminderPrefs.eventId, reminderPrefs.memberId],
      set: { offsets: JSON.stringify(sorted) },
    })
    .run();
  return { eventId, offsets: sorted };
}

/** 「これ以降」の分割で、各メンバーの通知を新シリーズに複製する（§11） */
export function copyReminderPrefs(db: DbLike, fromEventId: string, toEventId: string): void {
  const rows = db.select().from(reminderPrefs).where(eq(reminderPrefs.eventId, fromEventId)).all();
  for (const r of rows) {
    db.insert(reminderPrefs)
      .values({ eventId: toEventId, memberId: r.memberId, offsets: r.offsets })
      .onConflictDoNothing()
      .run();
  }
}
