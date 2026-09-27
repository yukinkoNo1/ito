import { MINUTE_MS } from '@ito/core';
import type { Stoppable } from '../runtime';
import { flushFamilyNotices, type NotifierDeps, sendDigests, sendReminders } from './notifier';

/**
 * スケジューラ（1 分ごと、単一プロセス。§15）。時刻は注入した Clock で扱い、テストでは tick() を直接呼ぶ。
 * 前の実行が終わっていなければ次の実行はとばす（送信が遅いときに重ならないように）。
 * 掃除とバックアップのジョブは Phase 7 でここに足す。
 */
export interface Scheduler extends Stoppable {
  tick(): Promise<{ reminders: number; digests: number; changes: number }>;
}

export function createScheduler(
  deps: NotifierDeps,
  intervalMs = MINUTE_MS,
): Scheduler & {
  start(): void;
} {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<unknown> | null = null;

  const tick = async () => {
    const result = { reminders: 0, digests: 0, changes: 0 };
    // 1 つが失敗してもほかは続ける（例外の中身はログに出さず、種類だけ）
    const step = async (name: keyof typeof result, fn: () => Promise<number>) => {
      try {
        result[name] = await fn();
      } catch (err) {
        deps.logger.error(
          { job: name, err: err instanceof Error ? err.name : 'unknown' },
          'scheduler job failed',
        );
      }
    };
    // 送り先がない（VAPID の鍵がない）ときは、予定の通知とまとめは作らない。変更のまとめ待ちは捨てるために回す
    if (deps.sender) {
      await step('reminders', () => sendReminders(deps));
      await step('digests', () => sendDigests(deps));
    }
    await step('changes', () => flushFamilyNotices(deps));
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
