// E2E モードのサーバー（SPEC §21）: 本番ビルド（E2E 用）を Hono が配信する。
// NODE_ENV=development・AUTH_MODE=dev・APP_ORIGIN=http://localhost:<port>、ヘッダは本番と同じ。
// 毎回まっさらな DB で始める。ANTHROPIC_API_KEY は空にして実 API を呼ばない。
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.E2E_PORT ?? '8788';
const dataDir = path.join(repo, '.data', 'e2e');

for (let i = 0; i < 20; i++) {
  try {
    rmSync(dataDir, { recursive: true, force: true });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

Object.assign(process.env, {
  NODE_ENV: 'development',
  AUTH_MODE: 'dev',
  HOST: '127.0.0.1',
  PORT: port,
  APP_ORIGIN: `http://localhost:${port}`,
  DEV_LOGIN: 'papa@example.com',
  ADMIN_LOGINS: 'papa@example.com',
  DATABASE_PATH: path.join(dataDir, 'ito.db'),
  BACKUP_DIR: path.join(dataDir, 'backups'),
  STATIC_DIR: path.join(repo, 'apps', 'web', 'dist-e2e'),
  ANTHROPIC_API_KEY: '',
  LOG_LEVEL: 'warn',
});

await import(new URL('../apps/server/dist/server.js', import.meta.url).href);
