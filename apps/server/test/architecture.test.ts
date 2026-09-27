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
});
