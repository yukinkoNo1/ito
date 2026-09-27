// 手元で連携キーの確認をする: ビルド済みのサーバーを別のポートと一時 DB で起動し、
// feed-check-inner.mjs（キーを表示せず状態コードだけを出す）を走らせて、起動したサーバーだけを止める。
// 先に `pnpm build` しておく。
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = '8790';
const dataDir = path.join(repo, '.data', 'feed-check');
rmSync(dataDir, { recursive: true, force: true });

const env = {
  ...process.env,
  NODE_ENV: 'development',
  AUTH_MODE: 'dev',
  HOST: '127.0.0.1',
  PORT: port,
  APP_ORIGIN: `http://localhost:${port}`,
  DEV_LOGIN: 'papa@example.com',
  ADMIN_LOGINS: 'papa@example.com',
  DATABASE_PATH: path.join(dataDir, 'ito.db'),
  BACKUP_DIR: path.join(dataDir, 'backups'),
  ANTHROPIC_API_KEY: '',
  LOG_LEVEL: 'warn',
};

const server = spawn(process.execPath, [path.join(repo, 'apps/server/dist/server.js')], {
  env,
  stdio: 'inherit',
});

async function waitHealthy() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let code = 1;
try {
  if (!(await waitHealthy())) throw new Error('サーバーが起動しませんでした');
  const inner = spawnSync(process.execPath, [path.join(repo, 'scripts/feed-check-inner.mjs')], {
    env: {
      ...env,
      FEED_CHECK_CLI: path.join(repo, 'apps/server/dist/cli.js'),
      FEED_CHECK_URL: `http://127.0.0.1:${port}`,
    },
    encoding: 'utf8',
  });
  process.stdout.write(inner.stdout);
  code = inner.status ?? 1;
} catch (e) {
  process.stdout.write(`${e}\n`);
} finally {
  server.kill();
}
process.exit(code);
