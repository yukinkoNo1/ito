import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DAY_MS, type DateISO, HOUR_MS, todayJst, toJstParts } from '@ito/core';
import { and, isNotNull, lt, sql } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import {
  activity,
  aiUsage,
  changes,
  events,
  idempotencyKeys,
  notificationLog,
  pendingNotices,
} from '../db/schema';

/**
 * 掃除とバックアップ（§15 のスケジューラの 4・5。§18 T11）。
 * - 掃除（毎日 4:00）: ゴミ箱 30 日、changes 90 日、notification_log 60 日、idempotency 48 時間、ai_usage 90 日、
 *   activity 1 年。送り終えた家族の変更のまとめ待ち（pending_notices）も 7 日で消す（§24 D38）
 * - バックアップ（毎日 3:30）: `VACUUM INTO '<dir>/ito-YYYYMMDD.db.tmp'` → 終わったら `.db` に名前を変える
 *   （書きかけのファイルを残さない）。BACKUP_KEEP 世代（既定 14）を残して古いものを消す
 * 時刻は注入した Clock で扱う（テストは偽の時計）。ログには件数・ファイル名だけを出す
 */

export const RETENTION = {
  trashMs: 30 * DAY_MS,
  changesMs: 90 * DAY_MS,
  notificationLogMs: 60 * DAY_MS,
  idempotencyMs: 48 * HOUR_MS,
  aiUsageMs: 90 * DAY_MS,
  activityMs: 365 * DAY_MS,
  flushedNoticesMs: 7 * DAY_MS,
} as const;

export interface CleanupResult {
  trash: number;
  changes: number;
  notificationLog: number;
  idempotency: number;
  aiUsage: number;
  activity: number;
  pendingNotices: number;
}

/** 古いものを消す（1 つのトランザクション） */
export function cleanup(db: DbLike, nowMs: number): CleanupResult {
  return db.transaction((tx) => ({
    // ゴミ箱の予定（例外行・担当・通知の設定は外部キーの cascade で一緒に消える）
    trash: tx
      .delete(events)
      .where(and(isNotNull(events.deletedAt), lt(events.deletedAt, nowMs - RETENTION.trashMs)))
      .run().changes,
    changes: tx
      .delete(changes)
      .where(lt(changes.createdAt, nowMs - RETENTION.changesMs))
      .run().changes,
    notificationLog: tx
      .delete(notificationLog)
      .where(lt(notificationLog.sentAt, nowMs - RETENTION.notificationLogMs))
      .run().changes,
    idempotency: tx
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, nowMs - RETENTION.idempotencyMs))
      .run().changes,
    aiUsage: tx
      .delete(aiUsage)
      .where(lt(aiUsage.createdAt, nowMs - RETENTION.aiUsageMs))
      .run().changes,
    activity: tx
      .delete(activity)
      .where(lt(activity.createdAt, nowMs - RETENTION.activityMs))
      .run().changes,
    pendingNotices: tx
      .delete(pendingNotices)
      .where(
        and(
          isNotNull(pendingNotices.flushedAt),
          lt(pendingNotices.flushedAt, nowMs - RETENTION.flushedNoticesMs),
        ),
      )
      .run().changes,
  }));
}

const BACKUP_RE = /^ito-(\d{8})\.db$/;
const BACKUP_TMP_RE = /^ito-\d{8}\.db\.tmp$/;

export function backupFileName(date: DateISO): string {
  return `ito-${date.replace(/-/g, '')}.db`;
}

/** その日のバックアップがもうあるか */
export function hasBackup(dir: string, date: DateISO): boolean {
  return existsSync(path.join(dir, backupFileName(date)));
}

export interface BackupResult {
  file: string;
  removed: string[];
}

/**
 * バックアップを 1 つ作り、keep 世代を残して古いものを消す。書きかけ（.db.tmp）が残っていたら先に消す。
 * VACUUM INTO はトランザクションの外で行う（読み取りの一貫したスナップショットになる）
 */
export function runBackup(db: DbLike, dir: string, keep: number, nowMs: number): BackupResult {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (BACKUP_TMP_RE.test(name)) rmSync(path.join(dir, name), { force: true });
  }
  const file = backupFileName(todayJst(nowMs));
  const target = path.join(dir, file);
  const tmp = `${target}.tmp`;
  // 同じ日にもう一度作るとき（手で呼んだときなど）は置き換える
  db.run(sql`VACUUM INTO ${tmp}`);
  rmSync(target, { force: true });
  renameSync(tmp, target);
  const all = readdirSync(dir)
    .filter((name) => BACKUP_RE.test(name))
    .sort()
    .reverse();
  const removed = all.slice(Math.max(1, keep));
  for (const name of removed) rmSync(path.join(dir, name), { force: true });
  return { file, removed };
}

/** 毎日の時刻（JST の HH:MM）を過ぎたか */
export function pastTimeOfDay(nowMs: number, hm: string): boolean {
  return toJstParts(nowMs).time >= hm;
}
