import { type DateISO, MINUTE_MS, todayJst } from '@ito/core';
import type { Stoppable } from '../runtime';
import { type CleanupResult, cleanup, hasBackup, pastTimeOfDay, runBackup } from './maintenance';
import { flushFamilyNotices, type NotifierDeps, sendDigests, sendReminders } from './notifier';

/**
 * スケジューラ（1 分ごと、単一プロセス。§15）。時刻は注入した Clock で扱い、テストでは tick() を直接呼ぶ。
 * 前の実行が終わっていなければ次の実行はとばす（送信が遅いときに重ならないように）。
 * 通知（予定の通知・まとめ・家族の変更）に加えて、バックアップ（3:30 を過ぎてその日の分がなければ）と
 * 掃除（4:00 を過ぎてその日にまだなら）を行う（止まっていた日の分は、動き出したときに行う）
 */
export interface TickResult {
  reminders: number;
  digests: number;
  changes: number;
  /** その実行で作ったバックアップのファイル名 */
  backup?: string;
  /** その実行で消した件数 */
  cleanup?: CleanupResult;
}

export interface Scheduler extends Stoppable {
  tick(): Promise<TickResult>;
}

export interface MaintenanceOptions {
  backupDir: string;
  backupKeep: number;
}

export const BACKUP_TIME = '03:30';
export const CLEANUP_TIME = '04:00';

export function createScheduler(
  deps: NotifierDeps,
  intervalMs = MINUTE_MS,
  maintenance: MaintenanceOptions | null = null,
): Scheduler & {
  start(): void;
} {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<unknown> | null = null;
  // 同じ日に何度も試さない（失敗したら次の日か、次に起動したとき）
  let backupTried: DateISO | null = null;
  let cleanedOn: DateISO | null = null;

  const failed = (job: string, err: unknown) =>
    deps.logger.error(
      { job, err: err instanceof Error ? err.name : 'unknown' },
      'scheduler job failed',
    );

  const tick = async (): Promise<TickResult> => {
    const result: TickResult = { reminders: 0, digests: 0, changes: 0 };
    // 1 つが失敗してもほかは続ける（例外の中身はログに出さず、種類だけ）
    const step = async (name: 'reminders' | 'digests' | 'changes', fn: () => Promise<number>) => {
      try {
        result[name] = await fn();
      } catch (err) {
        failed(name, err);
      }
    };
    // 送り先がない（VAPID の鍵がない）ときは、予定の通知とまとめは作らない。変更のまとめ待ちは捨てるために回す
    if (deps.sender) {
      await step('reminders', () => sendReminders(deps));
      await step('digests', () => sendDigests(deps));
    }
    await step('changes', () => flushFamilyNotices(deps));

    if (maintenance) {
      const now = deps.clock.now();
      const today = todayJst(now);
      if (
        backupTried !== today &&
        pastTimeOfDay(now, BACKUP_TIME) &&
        !hasBackup(maintenance.backupDir, today)
      ) {
        backupTried = today;
        try {
          const r = runBackup(deps.db, maintenance.backupDir, maintenance.backupKeep, now);
          result.backup = r.file;
          deps.logger.info({ file: r.file, removed: r.removed.length }, 'backup');
        } catch (err) {
          failed('backup', err);
        }
      }
      if (cleanedOn !== today && pastTimeOfDay(now, CLEANUP_TIME)) {
        cleanedOn = today;
        try {
          result.cleanup = cleanup(deps.db, now);
          deps.logger.info({ ...result.cleanup }, 'cleanup');
        } catch (err) {
          failed('cleanup', err);
        }
      }
    }
    return result;
  };

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        if (running) return;
        running = tick().finally(() => {
          running = null;
        });
      }, intervalMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (running) await running;
    },
  };
}
