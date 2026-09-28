// ビルド成果物の検査（SPEC §18 T7・§21 セキュリティ回帰）。`pnpm build` の最後に動く（Docker のビルドでも）。
// 本番のビルド（apps/web/dist・apps/server/dist）に、秘密情報の形（Anthropic の API キー・連携キー・秘密鍵）と、
// 開発・E2E 用のもの（X-Dev-Login・ギャラリー・見本のデータ）が入っていないかを見る。見つけたら終了コード 1。
// 見つけた文字列そのものは出さない（ファイル名と種類だけ）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECRETS = [
  { name: 'Anthropic の API キー', re: /sk-ant-[a-z]+\d*-[A-Za-z0-9_-]{16,}/ },
  { name: '連携キー', re: /ito_feed_[A-Za-z0-9_-]{20,}/ },
  { name: '秘密鍵', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const targets = [
  {
    dir: 'apps/web/dist',
    forbid: [
      ...SECRETS,
      { name: '開発用のログイン', re: /X-Dev-Login|ito\.devLogin/i },
      { name: 'ギャラリー', re: /__gallery|表示する状態/ },
      { name: 'ギャラリーの見本の日付', re: /2030-09-29/ },
      { name: 'VAPID の秘密鍵の名前', re: /VAPID_PRIVATE_KEY/ },
    ],
  },
  { dir: 'apps/server/dist', forbid: SECRETS },
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

let problems = 0;
for (const t of targets) {
  const dir = path.join(repo, t.dir);
  let count = 0;
  try {
    for (const file of files(dir)) {
      count++;
      if (!/\.(js|mjs|cjs|html|json|webmanifest|css|map|txt)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const f of t.forbid) {
        if (f.re.test(text)) {
          problems++;
          process.stderr.write(`NG ${path.relative(repo, file)}: ${f.name}\n`);
        }
      }
    }
  } catch {
    process.stderr.write(`NG ${t.dir} がありません（先にビルドする）\n`);
    problems++;
    continue;
  }
  if (count === 0) {
    process.stderr.write(`NG ${t.dir} が空です\n`);
    problems++;
  }
}

// §19: 初回表示の JS（index.html が読む script と modulepreload）は gzip で 200KB 以内
const JS_BUDGET = 200 * 1000;
let initialJs = 0;
try {
  const html = readFileSync(path.join(repo, 'apps/web/dist/index.html'), 'utf8');
  const urls = [
    ...html.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"/g),
    ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+\.js)"/g),
  ].map((m) => m[1]);
  for (const url of new Set(urls)) {
    const file = path.join(repo, 'apps/web/dist', url.replace(/^\//, ''));
    initialJs += gzipSync(readFileSync(file)).length;
  }
  if (urls.length === 0) throw new Error('no script');
} catch {
  process.stderr.write('NG apps/web/dist/index.html の JS を測れません\n');
  problems++;
}
if (initialJs > JS_BUDGET) {
  process.stderr.write(
    `NG 初回表示の JS が gzip で ${initialJs} バイト（§19 の上限 ${JS_BUDGET}）\n`,
  );
  problems++;
}

if (problems > 0) process.exit(1);
process.stdout.write(
  `check-dist: OK（秘密情報・開発用のものは入っていません。初回表示の JS は gzip で ${Math.round(initialJs / 1000)}KB）\n`,
);
