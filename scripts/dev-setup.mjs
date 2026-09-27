// 手元で試すための設定ファイルを作る（どれも .gitignore 済み。すでにあれば触らない）。
// - deploy/app.env: compose で本番と同じ設定（NODE_ENV=production・AUTH_MODE=tailscale）で動かすための開発用の値
// - deploy/.env: TS_AUTHKEY は空（ts は鍵なしで起動を試すだけ）
// - .data/dev.secrets.env: pnpm dev のサーバーが読む開発用の鍵
// 鍵は開発用にここで生成し、値は画面に出さない（RUNBOOK 4.）。
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(pub.x, 'base64url');
  const y = Buffer.from(pub.y, 'base64url');
  return {
    publicKey: Buffer.concat([Buffer.from([4]), x, y]).toString('base64url'),
    privateKey: Buffer.from(jwk.d, 'base64url').toString('base64url'),
  };
}

function writeIfMissing(rel, content) {
  const file = path.join(repo, rel);
  if (existsSync(file)) {
    process.stdout.write(`skip   ${rel}（もうある）\n`);
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, { mode: 0o600 });
  process.stdout.write(`create ${rel}\n`);
}

const composeKeys = vapidKeys();
writeIfMissing(
  'deploy/app.env',
  [
    '# 手元の docker compose で試すための開発用の値（scripts/dev-setup.mjs が作った。本番では使わない）',
    'APP_ORIGIN=https://ito.example.ts.net',
    'AUTH_MODE=tailscale',
    'ADMIN_LOGINS=you@example.com',
    'MAX_MEMBERS=6',
    'ANTHROPIC_API_KEY=',
    'ANTHROPIC_MODEL=claude-haiku-4-5',
    `VAPID_PUBLIC_KEY=${composeKeys.publicKey}`,
    `VAPID_PRIVATE_KEY=${composeKeys.privateKey}`,
    'VAPID_SUBJECT=mailto:you@example.com',
    'BACKUP_KEEP=14',
    'FEED_ALLOW_USER_DEVICES=false',
    'LOG_LEVEL=info',
    '',
  ].join('\n'),
);
writeIfMissing('deploy/.env', '# ts は鍵なしで起動を試すだけ\nTS_AUTHKEY=\n');

const devKeys = vapidKeys();
writeIfMissing(
  '.data/dev.secrets.env',
  [
    '# pnpm dev のサーバー用の開発用の鍵（scripts/dev-setup.mjs が作った）',
    `VAPID_PUBLIC_KEY=${devKeys.publicKey}`,
    `VAPID_PRIVATE_KEY=${devKeys.privateKey}`,
    'VAPID_SUBJECT=mailto:dev@example.com',
    '',
  ].join('\n'),
);
