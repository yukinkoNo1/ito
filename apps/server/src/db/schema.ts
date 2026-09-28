import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * SQLite のスキーマ（SPEC §10）。ID は UUIDv7、時刻は epoch ミリ秒（UTC）。
 * マイグレーションは列やテーブルを足すだけにし、名前を変えない（drizzle-kit の対話を避ける）。
 */

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    login: text('login').notNull().unique(),
    /** NFC・前後の空白除去をしてから保存する。有効なメンバー間で重複不可 */
    name: text('name').notNull(),
    mark: text('mark').notNull(),
    /** 有効なメンバー間で重複不可 */
    color: text('color').notNull(),
    aliases: text('aliases').notNull().default('[]'),
    role: text('role').notNull().default('member'),
    settings: text('settings').notNull().default('{}'),
    activityReadAt: integer('activity_read_at').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    disabledAt: integer('disabled_at'),
  },
  (t) => [
    uniqueIndex('members_name_active').on(t.name).where(sql`disabled_at IS NULL`),
    uniqueIndex('members_color_active').on(t.color).where(sql`disabled_at IS NULL`),
  ],
);

export type MemberRow = typeof members.$inferSelect;

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    note: text('note'),
    location: text('location'),
    allDay: integer('all_day', { mode: 'boolean' }).notNull(),
    startAt: integer('start_at'),
    endAt: integer('end_at'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    rrule: text('rrule'),
    exdates: text('exdates').notNull().default('[]'),
    parentId: text('parent_id').references((): AnySQLiteColumn => events.id, {
      onDelete: 'cascade',
    }),
    recurrenceId: text('recurrence_id'),
    forEveryone: integer('for_everyone', { mode: 'boolean' }).notNull().default(false),
    busy: integer('busy', { mode: 'boolean' }).notNull(),
    visibility: text('visibility').notNull().default('family'),
    ownerId: text('owner_id')
      .notNull()
      .references(() => members.id),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    deletedBy: text('deleted_by'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('events_deleted_start').on(t.deletedAt, t.startAt),
    index('events_start_date').on(t.startDate),
    index('events_parent').on(t.parentId),
    // 終日なら start_date・end_date 必須で start_at・end_at は NULL、時刻ありなら start_at 必須で日付は NULL（§10）
    check(
      'events_shape',
      sql`(all_day = 1 AND start_date IS NOT NULL AND end_date IS NOT NULL AND start_at IS NULL AND end_at IS NULL) OR (all_day = 0 AND start_at IS NOT NULL AND start_date IS NULL AND end_date IS NULL)`,
    ),
    check('events_end_date', sql`end_date IS NULL OR end_date >= start_date`),
    check('events_end_at', sql`end_at IS NULL OR end_at > start_at`),
    check('events_visibility', sql`visibility IN ('family', 'private')`),
    check('events_private_not_everyone', sql`visibility = 'family' OR for_everyone = 0`),
  ],
);

export type EventRow = typeof events.$inferSelect;

/** 担当者（for_everyone=0 のとき） */
export const eventMembers = sqliteTable(
  'event_members',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId] })],
);

/** 予定ごとの本人の通知（§10）。行がなければ本人の既定値（担当者のとき）。[] は「通知なし」 */
export const reminderPrefs = sqliteTable(
  'reminder_prefs',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    offsets: text('offsets').notNull().default('[]'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId] })],
);

/** 履歴（1 年保持） */
export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    eventId: text('event_id').notNull(),
    action: text('action').notNull(),
    title: text('title').notNull(),
    diff: text('diff').notNull().default('[]'),
    visibility: text('visibility').notNull(),
    ownerId: text('owner_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('activity_created').on(t.createdAt)],
);

export type ActivityRow = typeof activity.$inferSelect;

/** 差分同期の元（90 日で削除） */
export const changes = sqliteTable(
  'changes',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('changes_created').on(t.createdAt)],
);

/** 再送の重複防止（48 時間） */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text('key').notNull(),
    memberId: text('member_id').notNull(),
    response: text('response').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.memberId] }),
    index('idempotency_created').on(t.createdAt),
  ],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** 連携キー（§13.1）。キーそのものは保存しない（SHA-256 だけ） */
export const feedTokens = sqliteTable('feed_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scope: text('scope').notNull().default('display'),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
  /** 人の端末（ID ヘッダ付き）から最後に使われた時刻（§24 D21。5 分に 1 回まで書く） */
  lastUserDeviceAt: integer('last_user_device_at'),
  revokedAt: integer('revoked_at'),
});

export type FeedTokenRow = typeof feedTokens.$inferSelect;

/** Push 購読（端末ごと。§10・§15）。endpoint は画面にもログにも出さない */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id')
      .notNull()
      .references(() => members.id),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    label: text('label').notNull(),
    createdAt: integer('created_at').notNull(),
    lastOkAt: integer('last_ok_at'),
    failCount: integer('fail_count').notNull().default(0),
  },
  (t) => [index('push_subscriptions_member').on(t.memberId)],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/** 重複送信防止（送信成功後に書く。60 日で削除） */
export const notificationLog = sqliteTable(
  'notification_log',
  {
    key: text('key').primaryKey(),
    memberId: text('member_id').notNull(),
    sentAt: integer('sent_at').notNull(),
  },
  (t) => [index('notification_log_sent').on(t.sentAt)],
);

/** 家族の変更通知のまとめ待ち（§15。2 分まとめ・静かな時間） */
export const pendingNotices = sqliteTable(
  'pending_notices',
  {
    id: text('id').primaryKey(),
    recipientId: text('recipient_id').notNull(),
    actorId: text('actor_id').notNull(),
    eventId: text('event_id').notNull(),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    createdAt: integer('created_at').notNull(),
    flushedAt: integer('flushed_at'),
  },
  (t) => [index('pending_notices_recipient').on(t.recipientId, t.flushedAt)],
);

export type PendingNoticeRow = typeof pendingNotices.$inferSelect;

/** 一言入力の AI の回数制限と費用の把握（§10・§16）。入力文は保存しない */
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    memberId: text('member_id').notNull(),
    createdAt: integer('created_at').notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    source: text('source').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
  },
  (t) => [index('ai_usage_member').on(t.memberId, t.createdAt)],
);
