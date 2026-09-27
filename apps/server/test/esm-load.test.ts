import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * pnpm dev・seed・cli は tsx（Node の ESM）で動く。Vitest・Vite・esbuild は CommonJS の名前付きの export を
 * 変換してくれるので、そこでは見つからない読み込みの失敗（rrule の UMD など）を、本物の Node で確かめる
 * （レビュー P3-core-01）
 */
const serverDir = fileURLToPath(new URL('..', import.meta.url));

describe('Node の ESM（tsx）で読み込める', () => {
  it('@ito/core・サーバーのアプリ・CLI の入口を読み込み、繰り返しの展開が動く', () => {
    const script = [
      "const core = await import('@ito/core');",
      "await import('./src/app.ts');",
      "await import('./src/cli/run.ts');",
      "const r = core.parseRrule('FREQ=WEEKLY;BYDAY=MO');",
      "if (!r.ok) throw new Error('parse');",
      "const s = core.ruleStarts(r.rule, { date: '2026-09-28', time: '07:30' }, { date: '2026-09-28', time: '00:00' }, { date: '2026-10-06', time: '00:00' });",
      'process.stdout.write(String(s.length));',
    ].join('\n');
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        cwd: serverDir,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('2');
  });
});
