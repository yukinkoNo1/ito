import './zod-setup';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemClock } from '@ito/core';
import { EnvError, loadEnv } from './env';
import { createLogger } from './logger';
import { startServer } from './runtime';
import { anthropicClient } from './services/ai-client';
import { vapidKeysFrom, webPushSender } from './services/push-sender';
import { createScheduler } from './services/scheduler';

// このファイルは src/main.ts（開発）と dist/server.js（バンドル）のどちらでもパッケージ直下の 1 つ下にある
const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv(process.env);
  } catch (e) {
    if (e instanceof EnvError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const logger = createLogger(env.LOG_LEVEL);
  const vapid = vapidKeysFrom(env);
  const sender = vapid ? webPushSender(vapid) : null;
  if (!sender) logger.warn('push disabled (VAPID keys are not set)');
  const running = await startServer(
    env,
    systemClock,
    logger,
    {
      migrationsDir: path.resolve(here, '../drizzle'),
      defaultStaticDir: path.resolve(here, '../public'),
    },
    {
      push: { publicKey: vapid?.publicKey ?? null, sender },
      // 一言入力の AI（鍵がなければルール解析だけ。§16）
      ai: env.ANTHROPIC_API_KEY
        ? anthropicClient({
            apiKey: env.ANTHROPIC_API_KEY,
            model: env.ANTHROPIC_MODEL,
            timeoutMs: env.AI_TIMEOUT_MS,
          })
        : null,
      // スケジューラ（1 分ごと。§15）。shutdown で止める
      jobs: ({ database }) => {
        const scheduler = createScheduler({ db: database.db, clock: systemClock, sender, logger });
        scheduler.start();
        return [scheduler];
      },
    },
  );

  const onSignal = (signal: string) => {
    logger.info({ signal }, 'signal');
    running.shutdown().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ err }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  process.once('SIGINT', () => onSignal('SIGINT'));
}

main().catch((err: unknown) => {
  process.stderr.write(`起動に失敗しました: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
