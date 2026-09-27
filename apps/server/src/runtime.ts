import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { serve } from '@hono/node-server';
import type { Clock } from '@ito/core';
import { type App, createApp } from './app';
import { type Database_, openDatabase, runMigrations } from './db/client';
import type { Env } from './env';
import type { Logger } from './logger';

export interface RuntimePaths {
  migrationsDir: string;
  /** 既定の静的配信の場所（STATIC_DIR がなければ使う。なければ配信しない） */
  defaultStaticDir: string | null;
}

export interface RunningServer {
  app: App;
  database: Database_;
  port: number;
  /** 新しい接続を止め、スケジューラを止め、DB を閉じる（SPEC §15 の終了処理） */
  shutdown(): Promise<void>;
}

export interface Stoppable {
  stop(): void | Promise<void>;
}

/**
 * DB を開いてマイグレーションを適用してから待ち受ける（SPEC §20）。
 * 終了処理は shutdown() を直接呼ぶテストで確かめる（Windows では Node に SIGTERM が届かないため）。
 */
export async function startServer(
  env: Env,
  clock: Clock,
  logger: Logger,
  paths: RuntimePaths,
  extras: { jobs?: (deps: { database: Database_ }) => Stoppable[] } = {},
): Promise<RunningServer> {
  if (env.DATABASE_PATH !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(env.DATABASE_PATH)), { recursive: true });
  }
  const database = openDatabase(env.DATABASE_PATH);
  runMigrations(database.db, paths.migrationsDir);

  const staticDir = env.STATIC_DIR ?? paths.defaultStaticDir;
  const app = createApp({
    env,
    db: database.db,
    sqlite: database.sqlite,
    clock,
    logger,
    staticDir,
  });

  const jobs = extras.jobs?.({ database }) ?? [];

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, () => resolve(s));
    s.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  logger.info({ host: env.HOST, port: address.port }, 'listening');

  let stopping: Promise<void> | null = null;
  const shutdown = () => {
    stopping ??= (async () => {
      logger.info('shutting down');
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // 開いたままの keep-alive 接続を閉じる
        if ('closeAllConnections' in server) server.closeAllConnections();
      });
      for (const job of jobs) await job.stop();
      database.close();
      logger.info('stopped');
    })();
    return stopping;
  };

  return { app, database, port: address.port, shutdown };
}
