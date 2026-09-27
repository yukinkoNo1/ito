import { describe, expect, it } from 'vitest';
import { fromJst } from '../src/jst';
import { expand, expandAll, type OccurrenceSource } from '../src/occurrences';
import {
  countBefore,
  describe as describeRrule,
  fromPreset,
  MAX_OCCURRENCES_PER_EXPAND,
  normalizeRrule,
  parseRrule,
  previousStart,
  type RuleParts,
  ruleStarts,
  shiftRule,
  suggestMonthEnd,
  toPreset,
  untilFor,
  type Wall,
} from '../src/recurrence';
import { expandDirect } from './fixtures/recurring';

function rule(rrule: string): RuleParts {
  const r = parseRrule(rrule);
  if (!r.ok) throw new Error(r.message);
  return r.rule;
}

function starts(rrule: string, dtstart: Wall, from: string, to: string, limit?: number): string[] {
  return ruleStarts(
    rule(rrule),
    dtstart,
    { date: from, time: '00:00' },
    { date: to, time: '00:00' },
    limit,
  ).map((w) => (w.time === '00:00' ? w.date : `${w.date}T${w.time}`));
}

/** 経過時間の計測（core の型設定は実行環境の型を持たないので、globalThis から取り出す） */
const performance = (globalThis as unknown as { performance: { now(): number } }).performance;

describe('RRULE の検証（§11 のサブセット）', () => {
  it.each([
    ['FREQ=HOURLY', '毎時'],
    ['FREQ=MINUTELY', '毎時'],
    ['FREQ=SECONDLY', '毎時'],
    ['FREQ=DAILY;INTERVAL=0', '間隔'],
    ['FREQ=DAILY;INTERVAL=100', '間隔'],
    ['FREQ=DAILY;COUNT=0', '回数'],
    ['FREQ=DAILY;COUNT=1001', '回数'],
    ['FREQ=DAILY;COUNT=3;UNTIL=20261231', 'どちらか'],
    ['FREQ=DAILY;BYHOUR=7,8', 'BYHOUR'],
    ['FREQ=DAILY;BYMINUTE=0', 'BYMINUTE'],
    ['DTSTART=20260101T000000;FREQ=DAILY', 'DTSTART'],
    ['FREQ=DAILY;TZID=Asia/Tokyo', 'TZID'],
    ['FREQ=WEEKLY;BYDAY=2WE', '第 n'],
    ['FREQ=WEEKLY;BYMONTHDAY=3', 'BYMONTHDAY'],
    ['FREQ=DAILY;BYMONTH=2;BYMONTHDAY=31', 'BYMONTHDAY'],
    ['FREQ=MONTHLY;BYDAY=6WE', '第 n'],
    ['FREQ=MONTHLY;BYMONTHDAY=32', '正しくありません'],
    ['FREQ=DAILY;UNTIL=20260231', '終わりの日付'],
    ['FREQ=DAILY;FREQ=WEEKLY', '正しくありません'],
    ['FREQ=DAILY;X-FOO=1', 'X-FOO'],
    ['INTERVAL=2', '頻度'],
  ])('%s は拒否（%s）', (input, message) => {
    const r = parseRrule(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(message);
  });

  it('決まった順にして保存する', () => {
    expect(normalizeRrule('rrule:byday=th,mo;freq=weekly')).toBe('FREQ=WEEKLY;BYDAY=TH,MO');
    expect(normalizeRrule('FREQ=MONTHLY;COUNT=5;BYDAY=2WE,4WE')).toBe(
      'FREQ=MONTHLY;BYDAY=2WE,4WE;COUNT=5',
    );
    expect(normalizeRrule('FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3')).toBe(
      'FREQ=YEARLY;BYMONTHDAY=3;BYMONTH=11',
    );
  });
});

describe('展開（浮動時刻）', () => {
  it('第2・第4水曜', () => {
    expect(
      starts(
        'FREQ=MONTHLY;BYDAY=2WE,4WE',
        { date: '2026-10-14', time: '07:30' },
        '2026-10-01',
        '2027-01-01',
      ),
    ).toEqual([
      '2026-10-14T07:30',
      '2026-10-28T07:30',
      '2026-11-11T07:30',
      '2026-11-25T07:30',
      '2026-12-09T07:30',
      '2026-12-23T07:30',
    ]);
  });

  it('月末（-1）と、31 日指定は 31 日のない月をとばす', () => {
    expect(
      starts(
        'FREQ=MONTHLY;BYMONTHDAY=-1',
        { date: '2026-01-31', time: '00:00' },
        '2026-01-01',
        '2026-05-01',
      ),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(
      starts(
        'FREQ=MONTHLY;BYMONTHDAY=31',
        { date: '2026-01-31', time: '00:00' },
        '2026-01-01',
        '2026-06-01',
      ),
    ).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('2/29 の毎年はうるう年だけ', () => {
    expect(
      starts('FREQ=YEARLY', { date: '2028-02-29', time: '00:00' }, '2028-01-01', '2037-01-01'),
    ).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });

  it('COUNT は回数で終わる', () => {
    expect(
      starts(
        'FREQ=DAILY;COUNT=10',
        { date: '2026-09-27', time: '22:00' },
        '2026-09-01',
        '2026-12-01',
      ),
    ).toHaveLength(10);
  });

  it('時刻ありの UNTIL は 23:59:59 にすると最終日の回が残る（日付だけの UNTIL は 0:00 と読まれて落ちる）', () => {
    const dt = { date: '2026-10-01', time: '19:00' };
    expect(
      starts(`FREQ=DAILY;UNTIL=${untilFor('2026-10-05', false)}`, dt, '2026-10-01', '2026-11-01'),
    ).toEqual([
      '2026-10-01T19:00',
      '2026-10-02T19:00',
      '2026-10-03T19:00',
      '2026-10-04T19:00',
      '2026-10-05T19:00',
    ]);
    expect(starts('FREQ=DAILY;UNTIL=20261005', dt, '2026-10-01', '2026-11-01')).toHaveLength(4);
    // 終日は日付だけの UNTIL でよい（0:00 に始まる）
    expect(
      starts(
        `FREQ=DAILY;UNTIL=${untilFor('2026-10-05', true)}`,
        { date: '2026-10-01', time: '00:00' },
        '2026-10-01',
        '2026-11-01',
      ),
    ).toHaveLength(5);
  });

  it('1 回の展開は 2,000 回で打ち切る', () => {
    const n = starts(
      'FREQ=DAILY',
      { date: '2000-01-01', time: '00:00' },
      '2000-01-01',
      '2099-01-01',
    );
    expect(n).toHaveLength(MAX_OCCURRENCES_PER_EXPAND);
  });

  it('回が出ない規則（毎年 2/31）でも、すぐ終わる', () => {
    const t0 = performance.now();
    expect(
      starts(
        'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31',
        { date: '2026-01-01', time: '00:00' },
        '2026-01-01',
        '2030-01-01',
      ),
    ).toEqual([]);
    expect(
      starts(
        'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30,31',
        { date: '2026-01-01', time: '00:00' },
        '2026-01-01',
        '2030-01-01',
      ),
    ).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('JST の境界: 23:59 と 0:00 は、端末のタイムゾーンに関係なくその日の回', () => {
    expect(
      starts(
        'FREQ=DAILY;COUNT=2',
        { date: '2026-12-31', time: '23:59' },
        '2026-12-31',
        '2027-01-02',
      ),
    ).toEqual(['2026-12-31T23:59', '2027-01-01T23:59']);
    expect(
      starts(
        'FREQ=WEEKLY;BYDAY=TH',
        { date: '2026-10-01', time: '00:00' },
        '2026-10-01',
        '2026-10-16',
      ),
    ).toEqual(['2026-10-01', '2026-10-08', '2026-10-15']);
  });
});

describe('分割・日時の差分', () => {
  const dt = { date: '2026-10-01', time: '07:00' };
  it('前の回と、その前の回の数', () => {
    const r = rule('FREQ=WEEKLY;BYDAY=TH;COUNT=10');
    expect(previousStart(r, dt, { date: '2026-10-15', time: '07:00' })).toEqual({
      date: '2026-10-08',
      time: '07:00',
    });
    expect(previousStart(r, dt, dt)).toBeNull();
    expect(countBefore(r, dt, { date: '2026-10-15', time: '07:00' })).toBe(2);
  });

  it('「すべて」で日時を 1 日後ろにしたら、曜日・日もずらす', () => {
    expect(shiftRule(rule('FREQ=WEEKLY;BYDAY=MO,TH'), 1).byDay.map((d) => d.weekday)).toEqual([
      2, 5,
    ]);
    expect(shiftRule(rule('FREQ=WEEKLY;BYDAY=SA'), 1).byDay.map((d) => d.weekday)).toEqual([0]);
    expect(shiftRule(rule('FREQ=MONTHLY;BYMONTHDAY=15'), -2).byMonthDay).toEqual([13]);
    expect(shiftRule(rule('FREQ=MONTHLY;BYDAY=2WE,4WE'), 1).byDay).toEqual([
      { weekday: 4, nth: 2 },
      { weekday: 4, nth: 4 },
    ]);
  });

  it('29〜31 日を選んだら「月末にしますか？」（§11）', () => {
    expect(suggestMonthEnd('2026-01-31')).toBe(true);
    expect(suggestMonthEnd('2026-03-29')).toBe(true);
    expect(suggestMonthEnd('2026-02-28')).toBe(false);
    expect(suggestMonthEnd('2026-03-15')).toBe(false);
  });
});

describe('説明文（§11）と UI の形（§22）', () => {
  it.each([
    ['FREQ=WEEKLY;BYDAY=MO,TH', '毎週 月・木'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '隔週 土'],
    ['FREQ=MONTHLY;BYDAY=2WE,4WE', '毎月 第2・第4 水'],
    ['FREQ=MONTHLY;BYDAY=-1FR', '毎月 最終 金'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', '毎月 月末'],
    ['FREQ=MONTHLY;BYMONTHDAY=1', '毎月 1日'],
    ['FREQ=YEARLY', '毎年'],
    ['FREQ=DAILY;COUNT=10', '毎日（10回）'],
    ['FREQ=WEEKLY;BYDAY=SA;UNTIL=20261231', '毎週 土（12/31まで）'],
    ['FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3', 'カスタムの繰り返し'],
  ])('%s → %s', (rrule, text) => {
    expect(describeRrule(rrule, '2026-10-03')).toBe(text);
  });

  it('UI の形 ⇔ RRULE（なし／◯回／◯日まで）', () => {
    const cases = [
      {
        recurrence: {
          kind: 'weekly' as const,
          interval: 1,
          weekdays: [4, 1] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
        },
        end: { kind: 'count' as const, count: 10 },
      },
      {
        recurrence: { kind: 'monthlyByWeekday' as const, nth: [2, 4], weekday: 3 as const },
        end: { kind: 'never' as const },
      },
      {
        recurrence: { kind: 'monthlyByDate' as const, day: -1 },
        end: { kind: 'until' as const, date: '2027-03-31' },
      },
      { recurrence: { kind: 'daily' as const, interval: 2 }, end: { kind: 'never' as const } },
      { recurrence: { kind: 'yearly' as const }, end: { kind: 'never' as const } },
    ];
    for (const c of cases) {
      const rrule = fromPreset(c.recurrence, c.end, false);
      expect(typeof rrule).toBe('string');
      const back = toPreset(rrule as string, '2026-10-01');
      expect(back.end).toEqual(c.end);
      if (c.recurrence.kind === 'weekly') {
        expect(back.recurrence).toEqual({ kind: 'weekly', interval: 1, weekdays: [1, 4] });
      } else {
        expect(back.recurrence).toEqual(c.recurrence);
      }
    }
    expect(
      fromPreset(
        { kind: 'weekly', interval: 1, weekdays: [6] },
        { kind: 'until', date: '2026-12-31' },
        false,
      ),
    ).toBe('FREQ=WEEKLY;BYDAY=SA;UNTIL=20261231T235959');
    expect(
      fromPreset(
        { kind: 'weekly', interval: 1, weekdays: [6] },
        { kind: 'until', date: '2026-12-31' },
        true,
      ),
    ).toBe('FREQ=WEEKLY;BYDAY=SA;UNTIL=20261231');
    expect(fromPreset({ kind: 'none' }, { kind: 'never' }, false)).toBeNull();
    expect(fromPreset({ kind: 'custom', label: 'x' }, { kind: 'never' }, false)).toBeUndefined();
    expect(toPreset('FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=3', '2026-11-03').recurrence.kind).toBe(
      'custom',
    );
  });
});

describe('expand（例外・取り消し）', () => {
  const parent: OccurrenceSource & { title: string } = {
    id: 'p',
    title: '燃えるゴミ',
    allDay: false,
    startAt: '2026-09-28T07:30:00+09:00',
    endAt: '2026-09-28T08:00:00+09:00',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    exdates: ['2026-10-01T07:30'],
    parentId: null,
    recurrenceId: null,
  };
  const moved = {
    ...parent,
    id: 'x',
    title: '燃えるゴミ（祝日なので火曜）',
    startAt: '2026-10-06T07:30:00+09:00',
    endAt: '2026-10-06T08:00:00+09:00',
    rrule: null,
    exdates: [],
    parentId: 'p',
    recurrenceId: '2026-10-05T07:30',
  };
  const range = [fromJst('2026-09-28'), fromJst('2026-10-10')] as const;

  it('取り消した回は出ず、例外行はその回を置き換える（key は親の ID@recurrenceId のまま）', () => {
    const occ = expand(parent, [moved], ...range);
    const list = occ
      .sort((a, b) => a.startMs - b.startMs)
      .map((o) => [o.key, o.startDate, o.startTime, (o.event as typeof parent).title]);
    expect(list).toEqual([
      ['p@2026-09-28T07:30', '2026-09-28', '07:30', '燃えるゴミ'],
      ['p@2026-10-05T07:30', '2026-10-06', '07:30', '燃えるゴミ（祝日なので火曜）'],
      ['p@2026-10-08T07:30', '2026-10-08', '07:30', '燃えるゴミ'],
    ]);
  });

  it('expandAll でも例外行は親といっしょに（例外行だけで回を作らない）', () => {
    const keys = expandAll([moved, parent], ...range).map((o) => o.key);
    expect(keys).toEqual(['p@2026-09-28T07:30', 'p@2026-10-05T07:30', 'p@2026-10-08T07:30']);
  });

  it('範囲の前から続く回（前日 22:00〜翌 1:00）も入る', () => {
    const late = {
      ...parent,
      id: 'l',
      rrule: 'FREQ=DAILY',
      exdates: [],
      startAt: '2026-10-01T22:00:00+09:00',
      endAt: '2026-10-02T01:00:00+09:00',
    };
    const occ = expand(late, [], fromJst('2026-10-03'), fromJst('2026-10-04'));
    expect(occ.map((o) => [o.key, o.endDate, o.endTime])).toEqual([
      ['l@2026-10-02T22:00', '2026-10-03', '01:00'],
      ['l@2026-10-03T22:00', '2026-10-04', '01:00'],
    ]);
  });

  it('複数日の終日の繰り返しは、長さを保つ', () => {
    const trip = {
      ...parent,
      id: 't',
      allDay: true,
      startAt: undefined,
      endAt: undefined,
      startDate: '2026-10-10',
      endDate: '2026-10-11',
      rrule: 'FREQ=MONTHLY;COUNT=2',
      exdates: [],
    };
    const occ = expand(trip, [], fromJst('2026-10-01'), fromJst('2026-12-01'));
    expect(occ.map((o) => [o.key, o.startDate, o.endDate])).toEqual([
      ['t@2026-10-10', '2026-10-10', '2026-10-11'],
      ['t@2026-11-10', '2026-11-10', '2026-11-11'],
    ]);
  });
});

describe('3 通りの展開で比べるデータ（core を直接）', () => {
  it('手で確かめた回と同じ（2026-10 の 1 か月）', () => {
    const got = expandDirect('0192f5a0-1c00-7000-8000-000000000001');
    const id = (n: number) => `0192f5d0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
    expect(got).toEqual([
      `${id(3)}@2026-10-01 2026-10-01 → 2026-10-01`,
      `${id(1)}@2026-10-01T07:30 2026-10-01 07:30 → 2026-10-01 08:00`,
      `${id(5)}@2026-10-02T22:00 2026-10-02 22:00 → 2026-10-03 06:00`,
      `${id(1)}@2026-10-05T07:30 2026-10-05 07:30 → 2026-10-05 08:00`,
      `${id(1)}@2026-10-08T07:30 2026-10-08 07:30 → 2026-10-08 08:00`,
      `${id(4)}@2026-10-10 2026-10-10 → 2026-10-11`,
      `${id(1)}@2026-10-12T07:30 2026-10-12 07:30 → 2026-10-12 08:00`,
      `${id(2)}@2026-10-14T07:30 2026-10-14 07:30 → 2026-10-14`,
      `${id(1)}@2026-10-15T07:30 2026-10-15 07:30 → 2026-10-15 08:00`,
      `${id(5)}@2026-10-16T22:00 2026-10-16 22:00 → 2026-10-17 06:00`,
      `${id(1)}@2026-10-19T07:30 2026-10-19 07:30 → 2026-10-19 08:00`,
      `${id(1)}@2026-10-22T07:30 2026-10-22 07:30 → 2026-10-22 08:00`,
      `${id(1)}@2026-10-26T07:30 2026-10-26 07:30 → 2026-10-26 08:00`,
      `${id(6)}@2026-10-28T07:00 2026-10-28 07:00 → 2026-10-28`,
      `${id(2)}@2026-10-28T07:30 2026-10-28 07:30 → 2026-10-28`,
      `${id(6)}@2026-10-29T07:00 2026-10-29 07:00 → 2026-10-29`,
      `${id(1)}@2026-10-29T07:30 2026-10-29 07:30 → 2026-10-29 08:00`,
      `${id(6)}@2026-10-30T07:00 2026-10-30 07:00 → 2026-10-30`,
      `${id(5)}@2026-10-30T22:00 2026-10-30 22:00 → 2026-10-31 06:00`,
      `${id(6)}@2026-10-31T07:00 2026-10-31 07:00 → 2026-10-31`,
    ]);
  });
});
