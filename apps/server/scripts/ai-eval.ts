/**
 * pnpm ai:eval（SPEC §16・§21・RUNBOOK Phase 5）: §21 の表の 38 件を本物の Anthropic API に投げ、
 * 期待値との違いを表で出す。環境変数 ANTHROPIC_API_KEY があるときだけ動く（pnpm check・CI では実行しない。
 * 鍵はファイルから読まず、実行する人が環境変数で渡す）。
 * 鍵は表示しない。入力文は §21 の表の固定の文だけ（家族の本物の予定は使わない）。
 * 今は §21 と同じ 2026-09-27(日) 14:18（偽の時計）、家族は 父・母・さき・はると、書いた人ははると
 */
import '../src/zod-setup';
import { fileURLToPath } from 'node:url';
import { fakeClock } from '@ito/core';
import { CASES, comparable, expected } from '../../../packages/core/test/fixtures/nlp-cases';
import { openDatabase, runMigrations } from '../src/db/client';
import { members } from '../src/db/schema';
import { createLogger } from '../src/logger';
import { anthropicClient } from '../src/services/ai-client';
import { parseText } from '../src/services/parse';

const key = process.env.ANTHROPIC_API_KEY?.trim();
if (!key) {
  process.stdout.write('ANTHROPIC_API_KEY がないので実行しません（本物の API を使う評価です）\n');
  process.exit(0);
}

const clock = fakeClock(Date.UTC(2026, 8, 27, 5, 18));
const database = openDatabase(':memory:');
runMigrations(database.db, fileURLToPath(new URL('../drizzle', import.meta.url)));
const family = [
  { id: 'm-papa', name: 'お父さん', mark: '父', aliases: ['パパ'], color: 'kaki' },
  { id: 'm-mama', name: 'お母さん', mark: '母', aliases: ['ママ'], color: 'wakatake' },
  { id: 'm-saki', name: 'さき', mark: 'さ', aliases: [], color: 'fuji' },
  { id: 'm-haru', name: 'はると', mark: 'は', aliases: ['ハル'], color: 'asagi' },
];
family.forEach((m, i) => {
  database.db
    .insert(members)
    .values({
      id: m.id,
      login: `${m.id}@example.com`,
      name: m.name,
      mark: m.mark,
      color: m.color,
      role: i === 0 ? 'admin' : 'member',
      aliases: JSON.stringify(m.aliases),
      settings: '{}',
      activityReadAt: 0,
      createdAt: i,
      updatedAt: i,
      disabledAt: null,
    })
    .run();
});
const writer = database.db
  .select()
  .from(members)
  .all()
  .find((m) => m.id === 'm-haru');
if (!writer) throw new Error('writer');

const ai = anthropicClient({
  apiKey: key,
  model: process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5',
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 6000) || 6000,
});
const deps = {
  db: database.db,
  clock,
  logger: createLogger('silent'),
  ai,
  ratePerMin: 1000,
  ratePerDay: 1000,
};

let ok = 0;
const rows: string[] = ['| # | 入力 | 解析 | 結果 | 違い |', '|---|---|---|---|---|'];
for (const [n, input, e] of CASES) {
  const r = await parseText(deps, writer, input);
  const got = comparable(r) as Record<string, unknown>;
  const want = expected(e) as Record<string, unknown>;
  const diff = Object.keys(want).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k]));
  if (diff.length === 0) ok++;
  rows.push(
    `| ${n} | ${input} | ${r.source}${r.reason ? `（${r.reason}）` : ''} | ${diff.length === 0 ? '一致' : '違う'} | ${diff
      .map((k) => `${k}: ${JSON.stringify(got[k])} ≠ ${JSON.stringify(want[k])}`)
      .join('<br>')} |`,
  );
}
process.stdout.write(`${rows.join('\n')}\n\n一致 ${ok} / ${CASES.length}\n`);
database.close();
