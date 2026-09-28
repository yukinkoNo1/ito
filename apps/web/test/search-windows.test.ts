import { addDays, fromJst } from '@ito/core';
import { describe, expect, it, vi } from 'vitest';
import type { VmContext } from '../src/viewmodels/occurrence';
import { searchOccurrences } from '../src/viewmodels/search';
import { ev, M, members } from './fixtures';

/** 検索が展開した範囲（from-to）を覚える。展開そのものは本物 */
const windows: string[] = [];
vi.mock('@ito/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ito/core')>();
  return {
    ...real,
    expandAll: (...args: Parameters<typeof real.expandAll>) => {
      windows.push(`${args[1]}-${args[2]}`);
      return real.expandAll(...args);
    },
  };
});

const ctx: VmContext = {
  nowMs: fromJst('2026-09-28', '09:00'),
  today: '2026-09-28',
  meId: M.papa,
  members,
  freshSince: null,
};

describe('検索の窓（総点検のレビュー 8 回目 J1）', () => {
  it('1 年より前に UNTIL で終わった長い終日の繰り返しでも、過ぎた回の窓を同じ範囲で 2 度展開しない', () => {
    const start = addDays('2026-09-28', -1100);
    const series = ev({
      title: '合宿',
      allDay: true,
      startAt: undefined,
      startDate: start,
      endDate: addDays(start, 365),
      rrule: `FREQ=DAILY;UNTIL=${addDays('2026-09-28', -380).replaceAll('-', '')}`,
    });
    windows.length = 0;
    const found = searchOccurrences([series], '合宿', null, ctx);
    // 1 年の範囲の始まりより前に始まり範囲にかかる回が答え（範囲の始まりで切った窓は最後の窓と同じ）
    expect(found.flatMap((g) => g.items.map((i) => i.startDate))).toEqual(['2025-09-13']);
    expect(windows.length).toBeGreaterThan(0);
    expect(new Set(windows).size).toBe(windows.length);
    // 範囲にかかる回がない（1 日だけの回が 1 年より前に終わった）ときも、同じ範囲を 2 度展開しない
    const short = ev({
      title: '合宿',
      rrule: `FREQ=DAILY;UNTIL=${addDays('2026-09-28', -380).replaceAll('-', '')}T235959`,
      startAt: `${start}T09:00:00+09:00`,
    });
    windows.length = 0;
    expect(searchOccurrences([short], '合宿', null, ctx)).toEqual([]);
    expect(windows.length).toBeGreaterThan(0);
    expect(new Set(windows).size).toBe(windows.length);
  });

  it('過ぎた回を探す窓は、今日から（UNTIL がなければ）7・35・120・366 日前の順に広げる', () => {
    const series = ev({
      title: '散歩',
      rrule: 'FREQ=DAILY;UNTIL=20260630T235959',
      startAt: '2026-01-05T07:00:00+09:00',
    });
    const plain = ev({ title: '散歩（昔）', startAt: '2025-12-01T07:00:00+09:00' });
    windows.length = 0;
    searchOccurrences([series], '散歩', null, ctx);
    // UNTIL の翌日（7/1）から前へ 7 日の窓で見つかる（先の窓 4 つ＋過ぎた窓 1 つ）
    expect(windows).toHaveLength(5);
    windows.length = 0;
    searchOccurrences([plain], '散歩', null, ctx);
    // 繰り返しでない予定は今日から前へ 7・35・120・366 日の窓（先の窓 4 つ＋過ぎた窓 4 つ）
    expect(windows).toHaveLength(8);
  });
});
