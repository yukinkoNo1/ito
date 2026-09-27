import { describe, expect, it } from 'vitest';
import { holidayName, holidaysBetween } from '../src/holidays';
import { fromJst } from '../src/jst';
import { compareOccurrences, expandAll, occurrenceTimes, overlapsRange } from '../src/occurrences';

const base = { rrule: null, exdates: [], parentId: null, recurrenceId: null };

describe('回（§11）', () => {
  it('日付をまたぐ時刻予定は開始日に、終わる日は翌日', () => {
    const t = occurrenceTimes({
      ...base,
      id: 'a',
      allDay: false,
      startAt: '2026-10-01T22:00:00+09:00',
      endAt: '2026-10-02T01:00:00+09:00',
    });
    expect(t).toMatchObject({
      startDate: '2026-10-01',
      endDate: '2026-10-02',
      startTime: '22:00',
      endTime: '01:00',
    });
  });

  it('終日の終わりは最終日の翌日 0:00（含まない）', () => {
    const t = occurrenceTimes({
      ...base,
      id: 'a',
      allDay: true,
      startDate: '2026-09-28',
      endDate: '2026-09-30',
    });
    expect(t?.endMs).toBe(fromJst('2026-10-01'));
  });

  it('範囲にかかるか（終了なしは開始が範囲内のものだけ・ちょうど始まりに終わるものは入らない）', () => {
    const from = fromJst('2026-09-29');
    const to = fromJst('2026-09-30');
    expect(overlapsRange({ startMs: from - 1, endMs: from }, from, to)).toBe(false);
    expect(overlapsRange({ startMs: from - 1, endMs: from + 1 }, from, to)).toBe(true);
    expect(overlapsRange({ startMs: from - 1, endMs: null }, from, to)).toBe(false);
    expect(overlapsRange({ startMs: to - 1, endMs: null }, from, to)).toBe(true);
    expect(overlapsRange({ startMs: to, endMs: null }, from, to)).toBe(false);
  });

  it('並び: 開始 → 終日が先 → 終わりの早い順 → key', () => {
    const a = { startMs: 0, endMs: 10, allDay: false, key: 'b' };
    const b = { startMs: 0, endMs: 10, allDay: true, key: 'z' };
    const c = { startMs: 0, endMs: null, allDay: false, key: 'c' };
    const d = { startMs: 0, endMs: 10, allDay: false, key: 'a' };
    expect([a, b, c, d].sort(compareOccurrences).map((x) => x.key)).toEqual(['z', 'c', 'a', 'b']);
  });

  it('expandAll は例外行（parentId あり）を単独では出さない', () => {
    const events = [
      { ...base, id: 'p', allDay: true, startDate: '2026-09-29', endDate: '2026-09-29' },
      {
        ...base,
        id: 'x',
        parentId: 'p',
        recurrenceId: '2026-09-29',
        allDay: true,
        startDate: '2026-09-29',
        endDate: '2026-09-29',
      },
    ];
    expect(
      expandAll(events, fromJst('2026-09-29'), fromJst('2026-09-30')).map((o) => o.key),
    ).toEqual(['p']);
  });
});

describe('祝日（§21: 2026-09-21/22/23、2026-10-12）', () => {
  it('振替休日・国民の休日を含む', () => {
    expect(holidayName('2026-09-21')).toBe('敬老の日');
    expect(holidayName('2026-09-22')).toBe('休日');
    expect(holidayName('2026-09-23')).toBe('秋分の日');
    expect(holidayName('2026-10-12')).toBe('スポーツの日');
    expect(holidayName('2026-09-24')).toBeNull();
    expect(holidaysBetween('2026-09-20', '2026-10-13').map((h) => h.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-10-12',
    ]);
  });
});
