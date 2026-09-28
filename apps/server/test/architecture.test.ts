import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** リポジトリ全体の決まりを機械的に確かめる（CLAUDE.md・RUNBOOK 4.・SPEC §18） */
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_DIRS = ['apps/server/src', 'apps/web/src', 'packages/core/src'];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((d) => walk(path.join(repo, d)));

function offenders(pattern: RegExp, allow: (rel: string) => boolean = () => false): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const rel = path.relative(repo, file).replaceAll('\\', '/');
    if (allow(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${rel}:${i + 1}`);
    });
  }
  return hits;
}

describe('リポジトリの決まり', () => {
  it('ソースがある', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('今の時刻は Clock から取る（Date.now() は clock.ts だけ）', () => {
    expect(offenders(/Date\.now\(/, (rel) => rel === 'packages/core/src/clock.ts')).toEqual([]);
  });

  it('引数なしの new Date() を使わない', () => {
    expect(offenders(/new Date\(\s*\)/)).toEqual([]);
  });

  it('dangerouslySetInnerHTML を使わない', () => {
    expect(offenders(/dangerouslySetInnerHTML/)).toEqual([]);
  });

  it('型エラーを @ts-ignore・@ts-expect-error・any で隠さない', () => {
    expect(offenders(/@ts-ignore|@ts-expect-error|\bas any\b|:\s*any\b/)).toEqual([]);
  });

  it('ソースに双方向の上書き・ゼロ幅の文字を直接書かない（見た目と中身が違うコードにしない。総点検 A6）', () => {
    expect(offenders(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u)).toEqual([]);
  });

  it('運用の手順は連携キーをコマンドラインに書かせない・人の端末で試させない（総点検 A12。§18 T15・T16）', () => {
    for (const doc of ['docs/SPEC.md', 'README.md', 'docs/RUNBOOK.md']) {
      const text = readFileSync(path.join(repo, doc), 'utf8');
      expect([doc, /-H\s*["']?Authorization:\s*Bearer/i.test(text)]).toEqual([doc, false]);
      expect([doc, /(人の|個人の)\s*PC\s*から試す/.test(text)]).toEqual([doc, false]);
    }
  });

  it('依存の監査（pnpm audit。開発用の依存も含む）で外すのは、受け入れた 1 件だけ（総点検 B6。§18 T13）', () => {
    const yaml = readFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'utf8');
    const ignored = [...yaml.matchAll(/^\s+-\s+(GHSA-[\w-]+)\s*$/gm)].map((m) => m[1]);
    expect(ignored).toEqual(['GHSA-67mh-4wv8-2f99']);
    expect(yaml).toMatch(/^auditConfig:\n\s+ignoreGhsas:/m);
  });
});
