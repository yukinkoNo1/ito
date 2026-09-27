import { createHash, randomBytes } from 'node:crypto';
import { type Clock, uuidv7 } from '@ito/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client';
import { type FeedTokenRow, feedTokens } from '../db/schema';

export const FEED_TOKEN_PREFIX = 'ito_feed_';
/** ito_feed_ ＋ 32 バイトの乱数の base64url（パディングなし・43 文字）（§13.1） */
export const FEED_TOKEN_RE = /^ito_feed_[A-Za-z0-9_-]{43}$/;
export const MAX_ACTIVE_FEED_TOKENS = 5;
/** last_used_at・last_user_device_at は 5 分に 1 回まで書く */
export const TOKEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateFeedToken(): string {
  return `${FEED_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export class FeedTokenLimitError extends Error {
  constructor() {
    super(
      `有効な連携キーは ${MAX_ACTIVE_FEED_TOKENS} つまでです。使っていないキーを止めてください`,
    );
  }
}

/** 連携キーを発行する。平文のキーは戻り値でだけ返し、DB には SHA-256 だけを保存する */
export function createFeedToken(
  db: Db,
  clock: Clock,
  name: string,
): { row: FeedTokenRow; token: string } {
  return db.transaction((tx) => {
    const active = tx
      .select({ n: sql<number>`count(*)` })
      .from(feedTokens)
      .where(isNull(feedTokens.revokedAt))
      .get();
    if ((active?.n ?? 0) >= MAX_ACTIVE_FEED_TOKENS) throw new FeedTokenLimitError();
    const token = generateFeedToken();
    const now = clock.now();
    const row: FeedTokenRow = {
      id: uuidv7(now),
      name,
      scope: 'display',
      tokenHash: hashFeedToken(token),
      createdAt: now,
      lastUsedAt: null,
      lastUserDeviceAt: null,
      revokedAt: null,
    };
    tx.insert(feedTokens).values(row).run();
    return { row, token };
  });
}

export function listFeedTokens(db: DbLike): FeedTokenRow[] {
  return db.select().from(feedTokens).orderBy(asc(feedTokens.createdAt), asc(feedTokens.id)).all();
}

export function revokeFeedToken(db: DbLike, clock: Clock, id: string): FeedTokenRow | null {
  const row = db.select().from(feedTokens).where(eq(feedTokens.id, id)).get();
  if (!row) return null;
  if (row.revokedAt === null) {
    db.update(feedTokens).set({ revokedAt: clock.now() }).where(eq(feedTokens.id, id)).run();
  }
  return db.select().from(feedTokens).where(eq(feedTokens.id, id)).get() ?? null;
}

/**
 * 連携キーの照合。形が違う・知らない・止めた・scope が display でない、はどれも null（区別しない）。
 * 照合はハッシュで引く。
 */
export function verifyFeedToken(db: DbLike, token: string, scope: 'display'): FeedTokenRow | null {
  if (!FEED_TOKEN_RE.test(token)) return null;
  const row = db
    .select()
    .from(feedTokens)
    .where(and(eq(feedTokens.tokenHash, hashFeedToken(token)), isNull(feedTokens.revokedAt)))
    .get();
  if (!row || row.scope !== scope) return null;
  return row;
}

/** 最終利用時刻を 5 分に 1 回まで書く（毎分の取得で書き込みを増やさない） */
export function touchFeedToken(
  db: DbLike,
  row: FeedTokenRow,
  now: number,
  fromUserDevice: boolean,
): void {
  const set: Partial<FeedTokenRow> = {};
  if (row.lastUsedAt === null || now - row.lastUsedAt >= TOKEN_TOUCH_INTERVAL_MS)
    set.lastUsedAt = now;
  if (
    fromUserDevice &&
    (row.lastUserDeviceAt === null || now - row.lastUserDeviceAt >= TOKEN_TOUCH_INTERVAL_MS)
  ) {
    set.lastUserDeviceAt = now;
  }
  if (Object.keys(set).length > 0)
    db.update(feedTokens).set(set).where(eq(feedTokens.id, row.id)).run();
}
