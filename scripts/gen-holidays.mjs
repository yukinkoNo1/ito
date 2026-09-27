// @holiday-jp/holiday_jp の表から、2000 年以降の「日付 → 名前」だけの小さな表を作る（PWA のバンドルを小さくするため。§19）。
// 使い方: node scripts/gen-holidays.mjs（依存を上げたら作り直す。core のテストがライブラリの表と一致することを確かめる）

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repo, 'packages/core/package.json'));
const table = require('@holiday-jp/holiday_jp/lib/holidays');
const version = require('@holiday-jp/holiday_jp/package.json').version;
const rows = Object.keys(table)
  .filter((d) => d >= '2000-01-01')
  .sort()
  .map((d) => `${d.replaceAll('-', '')}${table[d].name}`);
const body = `// 自動生成（scripts/gen-holidays.mjs）。@holiday-jp/holiday_jp ${version} の 2000 年以降の祝日。手で書き換えない
export const HOLIDAY_DATA_VERSION = '${version}';
export const HOLIDAYS_PACKED = ${JSON.stringify(rows.join('|'))};
`;
writeFileSync(path.join(repo, 'packages/core/src/holidays-data.ts'), body);
process.stdout.write(`${rows.length} 件\n`);
