import {
  type Clock,
  type DeviceDTO,
  type PushSubscriptionInput,
  toIsoJst,
  uuidv7,
} from '@ito/core';
import { and, count, eq } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { type MemberRow, type PushSubscriptionRow, pushSubscriptions } from '../db/schema';
import { ApiError } from '../errors';

/**
 * Push 購読（端末ごと。§13・§15）。endpoint・鍵は画面にもログにも出さない。
 * 1 つの endpoint は 1 人のもの（同じ端末を別の家族が使い始めたら、持ち主を付け替える）
 */

export function upsertSubscription(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  input: PushSubscriptionInput,
): PushSubscriptionRow {
  const now = clock.now();
  const existing = db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, input.endpoint))
    .get();
  const label = input.label ?? existing?.label ?? 'この端末';
  if (existing) {
    const next = {
      memberId: me.id,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      label,
      // 登録し直したら失敗の数を戻す（端末が生きていることが分かったため）
      failCount: 0,
    };
    db.update(pushSubscriptions).set(next).where(eq(pushSubscriptions.id, existing.id)).run();
    return { ...existing, ...next };
  }
  const row: PushSubscriptionRow = {
    id: uuidv7(now),
    memberId: me.id,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    label,
    createdAt: now,
    lastOkAt: null,
    failCount: 0,
  };
  db.insert(pushSubscriptions).values(row).run();
  return row;
}

export function listSubscriptionsOf(db: DbLike, memberId: string): PushSubscriptionRow[] {
  return db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.memberId, memberId))
    .orderBy(pushSubscriptions.createdAt)
    .all();
}

/** 自分の端末の一覧（endpoint は返さない。current はこの端末の購読の ID） */
export function listMyDevices(db: DbLike, me: MemberRow, current: string | null): DeviceDTO[] {
  return listSubscriptionsOf(db, me.id).map((s) => ({
    id: s.id,
    label: s.label,
    lastOkAt: s.lastOkAt === null ? null : toIsoJst(s.lastOkAt),
    createdAt: toIsoJst(s.createdAt),
    isThisDevice: s.id === current,
  }));
}

/** 購読の削除（本人。管理者は他人の分も。§13） */
export function deleteSubscription(db: DbLike, me: MemberRow, id: string): void {
  const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id)).get();
  if (!row) throw new ApiError(404, 'not_found');
  if (row.memberId !== me.id && me.role !== 'admin') {
    throw new ApiError(403, 'forbidden', 'ほかの家族の端末は管理者だけが止められます');
  }
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)).run();
}

/** その人の全購読を削除（管理者の端末紛失時・メンバーの無効化。§13・§18 T9） */
export function deleteSubscriptionsOf(db: DbLike, memberId: string): number {
  return db.delete(pushSubscriptions).where(eq(pushSubscriptions.memberId, memberId)).run().changes;
}

export function countSubscriptions(db: DbLike, memberId: string): number {
  return (
    db
      .select({ n: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, memberId))
      .get()?.n ?? 0
  );
}

/** 送信の結果を購読に書く */
export function markDelivered(db: DbLike, id: string, now: number): void {
  db.update(pushSubscriptions)
    .set({ lastOkAt: now, failCount: 0 })
    .where(eq(pushSubscriptions.id, id))
    .run();
}

export function markFailed(db: DbLike, id: string, failCount: number): void {
  db.update(pushSubscriptions)
    .set({ failCount: failCount + 1 })
    .where(eq(pushSubscriptions.id, id))
    .run();
}

export function removeGone(db: DbLike, id: string, memberId: string): void {
  db.delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.memberId, memberId)))
    .run();
}
