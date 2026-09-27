import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
