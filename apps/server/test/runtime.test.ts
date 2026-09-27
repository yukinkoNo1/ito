import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClock } from '@ito/core';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';
import { startServer } from '../src/runtime';
import { devEnv, LogCapture, MIGRATIONS_DIR } from './helpers';

const tmp = fileURLToPath(new URL('../../../.data/test-tmp/runtime', import.meta.url));

async function removeWithRetry(dir: string) {
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

describe('起動と終了処理（SPEC §15・§20）', () => {
  it('空の DB でマイグレーションしてから待ち受け、shutdown で接続・DB を閉じる', async () => {
    await removeWithRetry(tmp);
    const dbPath = path.join(tmp, 'ito.db');
    const env = devEnv({ DATABASE_PATH: dbPath });
    const logs = new LogCapture();
    let jobStopped = false;
    const running = await startServer(
      { ...env, PORT: 0 },
      fakeClock(0),
      createLogger('info', logs.stream),
      { migrationsDir: MIGRATIONS_DIR, defaultStaticDir: null },
      {
        jobs: () => [
          {
            stop: () => {
              jobStopped = true;
            },
          },
        ],
      },
    );
    expect(existsSync(dbPath)).toBe(true);
    const tables = running.database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='members'")
      .all();
    expect(tables).toHaveLength(1);

    const res = await fetch(`http://127.0.0.1:${running.port}/healthz`);
    expect(res.status).toBe(200);

    await running.shutdown();
    expect(jobStopped).toBe(true);
    expect(running.database.sqlite.open).toBe(false);
    await expect(fetch(`http://127.0.0.1:${running.port}/healthz`)).rejects.toThrow();
    // 2 回呼んでも同じ
    await running.shutdown();
    await removeWithRetry(tmp);
  });
});
