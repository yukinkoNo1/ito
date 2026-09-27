import './zod-setup';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemClock } from '@ito/core';
import { EnvError, loadEnv } from './env';
import { createLogger } from './logger';
import { startServer } from './runtime';

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
  const running = await startServer(env, systemClock, logger, {
    migrationsDir: path.resolve(here, '../drizzle'),
    defaultStaticDir: path.resolve(here, '../public'),
  });

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
