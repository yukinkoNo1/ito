// 連携キーの確認（§23 Phase 1「CLI で発行したキーで curl すると 200、止めると 401」）。
// キーは表示しない。create → 要求 → revoke → 要求 を行い、状態コードだけを出す（RUNBOOK 4.）。
// 依存なしの Node だけで動く（Docker の中でも `docker compose exec -T app node --input-type=module - < このファイル` で動かす）。
// 環境変数: APP_ORIGIN（Host ヘッダに使う）、DATABASE_PATH（CLI が使う）、FEED_CHECK_CLI（既定 dist/cli.js）、FEED_CHECK_URL（既定 http://127.0.0.1:8787）
import { spawnSync } from 'node:child_process';
import http from 'node:http';

const cli = process.env.FEED_CHECK_CLI ?? 'dist/cli.js';
const base = new URL(process.env.FEED_CHECK_URL ?? 'http://127.0.0.1:8787');
const hostHeader = new URL(process.env.APP_ORIGIN ?? base.origin).host;

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: base.hostname,
        port: base.port,
        path,
        method: 'GET',
        headers: { Host: hostHeader, ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const created = runCli(['feed-token', 'create', '--name', 'feed-check']);
const key = created.stdout.match(/ito_feed_[A-Za-z0-9_-]{43}/)?.[0];
const id = created.stdout.match(/id: ([0-9a-f-]{36})/)?.[1];
if (created.status !== 0 || !key || !id) {
  process.stdout.write(`連携キーを作れませんでした（CLI の終了コード ${created.status}）\n`);
  process.exit(1);
}
let withoutKey = null;
let withKey = null;
let revoked = null;
let afterRevoke = null;
try {
  withoutKey = await get('/api/feed/display');
  withKey = await get('/api/feed/display?days=3', { Authorization: `Bearer ${key}` });
} finally {
  // 要求が失敗しても、確認用のキーはいつも止める（使われないキーを残さない）
  revoked = runCli(['feed-token', 'revoke', id]);
}
afterRevoke = await get('/api/feed/display?days=3', { Authorization: `Bearer ${key}` });
process.stdout.write(
  `キーなし: ${withoutKey}\nキーあり: ${withKey}\n止めた（CLI の終了コード ${revoked.status}）あと: ${afterRevoke}\n`,
);
process.exit(
  withoutKey === 401 && withKey === 200 && revoked.status === 0 && afterRevoke === 401 ? 0 : 1,
);
