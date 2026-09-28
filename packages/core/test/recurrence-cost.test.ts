import * as rruleModule from 'rrule';
import { describe, expect, it, vi } from 'vitest';
import { eventCreateSchema, fieldsFromCreate } from '../src/index';
import { addDays } from '../src/jst';
import {
  isOccurrenceOf,
  MAX_EMPTY_PERIODS,
  parseRrule,
  previousStart,
  type RuleParts,
  ruleDensityError,
  ruleStarts,
  type Wall,
} from '../src/recurrence';

/**
 * 総点検 B1（§24 D39）: 繰り返しの展開の重さ。rrule は開始から 1 期間ずつ歩き、回の出ない期間も歩くので、
 * 回の出ない規則は 9999 年まで空回りし、1970 年に始まる毎日の規則は表示範囲まで 2 万日を歩いていた
 */

const performance = (globalThis as unknown as { performance: { now(): number } }).performance;

function rule(text: string): RuleParts {
  const r = parseRrule(text);
  if (!r.ok) throw new Error(r.message);
  return r.rule;
}

const wall = (date: string, time = '00:00'): Wall => ({ date, time });

/** 開始を送らずに rrule だけで展開した結果（比べるための正解） */
type RRuleModule = typeof rruleModule;
const lib: RRuleModule =
  'RRule' in rruleModule && rruleModule.RRule
    ? rruleModule
    : (rruleModule as unknown as { default: RRuleModule }).default;

function floating(w: Wall): Date {
  const [y, m, d] = w.date.split('-').map(Number);
  const [hh, mm] = w.time.split(':').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0));
}

function label(d: Date): string {
  return d.toISOString().slice(0, 16);
}

function plain(text: string, dtstart: Wall): InstanceType<RRuleModule['RRule']> {
  const opts = lib.RRule.parseString(text);
  return new lib.RRule({ ...opts, dtstart: floating(dtstart) });
}

function reference(text: string, dtstart: Wall, from: Wall, to: Wall): string[] {
  const toD = floating(to);
  return plain(text, dtstart)
    .between(floating(from), toD, true)
    .filter((d) => d < toD)
    .map(label);
}

function mine(text: string, dtstart: Wall, from: Wall, to: Wall): string[] {
  return ruleStarts(rule(text), dtstart, from, to).map((w) => label(floating(w)));
}

describe('繰り返しの展開の重さ（総点検 B1）', () => {
  it('1970 年に始まる毎日・毎週の規則でも、1 回の展開は開始から歩かない（20 回で 100ms 未満）', () => {
    const daily = rule('FREQ=DAILY');
    const weekdays = rule('FREQ=DAILY;BYDAY=MO,WE,FR');
    const weekly = rule('FREQ=WEEKLY;BYDAY=MO');
    const start = wall('1970-01-01', '07:30');
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const from = addDays('2026-09-01', i);
      for (const r of [daily, weekdays, weekly]) {
        ruleStarts(r, start, wall(from), wall(addDays(from, 3)));
      }
    }
    // 直す前は 1 回およそ 35ms（2 万日を歩く）× 60 回
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('回が 1 つも出ない規則・まれにしか出ない規則は保存できない', () => {
    const start = wall('1970-01-01');
    for (const text of [
      'FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30,31',
      'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=31',
      'FREQ=MONTHLY;BYMONTHDAY=31;BYMONTH=4,6,9,11',
      'FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29', // 1970 年から 4 年ごとはうるう年に当たらない
      'FREQ=YEARLY;BYWEEKNO=53;BYDAY=MO;BYMONTH=6',
      'FREQ=MONTHLY;BYDAY=5MO;BYMONTH=2', // 2 月の第 5 月曜は 28 年に 1 回ほど（120 か月を超えて出ない）
    ]) {
      expect([text, ruleDensityError(rule(text), start)]).not.toEqual([text, null]);
      const parsed = eventCreateSchema.parse({
        title: 'x',
        allDay: true,
        startDate: '1970-01-01',
        rrule: text,
        memberIds: ['0192f5d0-0000-7000-8000-000000000001'],
      });
      const res = fieldsFromCreate(parsed, '0192f5d0-0000-7000-8000-000000000001');
      expect([text, 'errors' in res]).toEqual([text, true]);
    }
  });

  it('回の出ない規則の展開はすぐ終わる（保存では拒むが、前からある行でも止まらない）', () => {
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      expect(
        ruleStarts(
          rule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=30,31'),
          wall('1970-01-01'),
          wall(addDays('2026-09-28', i)),
          wall(addDays('2026-10-01', i)),
        ),
      ).toEqual([]);
    }
    // 直す前は 1 回およそ 150ms（9999 年まで歩く）× 60 回
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('うるう日・月末・第 5 曜日など、まれでも上限の中の規則は保存できる', () => {
    for (const [text, start] of [
      ['FREQ=YEARLY', wall('2028-02-29')],
      ['FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=29', wall('2028-02-29')],
      ['FREQ=MONTHLY;BYMONTHDAY=31', wall('2026-01-31')],
      ['FREQ=MONTHLY;BYDAY=5FR', wall('2026-10-30')],
      ['FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', wall('2026-11-13')],
      ['FREQ=YEARLY;INTERVAL=99', wall('2026-10-01')],
      ['FREQ=MONTHLY;INTERVAL=99;BYMONTHDAY=-1', wall('2026-10-31')],
      ['FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO', wall('2026-12-28')],
    ] as const) {
      expect([text, ruleDensityError(rule(text), start)]).toEqual([text, null]);
    }
    expect(MAX_EMPTY_PERIODS).toEqual({ MONTHLY: 120, YEARLY: 10 });
  });
});

describe('開始を送っても、出る回は変わらない（総点検 B1）', () => {
  const cases: [string, Wall][] = [
    ['FREQ=DAILY', wall('1970-01-01', '07:30')],
    ['FREQ=DAILY;INTERVAL=3', wall('2001-03-05', '23:59')],
    ['FREQ=DAILY;INTERVAL=2;BYDAY=MO,TH', wall('1999-12-31')],
    ['FREQ=WEEKLY', wall('1985-06-12', '10:00')],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=SU', wall('2010-01-07', '19:00')],
    ['FREQ=WEEKLY;INTERVAL=3;BYDAY=SU,SA', wall('2020-02-29')],
    ['FREQ=MONTHLY', wall('1990-01-31', '09:00')],
    ['FREQ=MONTHLY;BYMONTH=3,9', wall('2000-01-15')],
    ['FREQ=MONTHLY;BYDAY=2WE,4WE', wall('2003-10-08', '07:30')],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', wall('1971-01-31')],
    ['FREQ=MONTHLY;INTERVAL=5;BYDAY=-1FR', wall('1975-05-30')],
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', wall('1980-01-31')],
    ['FREQ=YEARLY', wall('1972-02-29')],
    ['FREQ=YEARLY;BYMONTH=3', wall('1980-01-15')],
    ['FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=4TH', wall('1976-11-25')],
    ['FREQ=YEARLY;BYWEEKNO=1;BYDAY=MO', wall('1990-01-01')],
    ['FREQ=YEARLY;BYYEARDAY=-1', wall('1970-12-31')],
    ['FREQ=DAILY;COUNT=1000', wall('2024-01-01', '06:00')],
    ['FREQ=WEEKLY;COUNT=40;BYDAY=TU', wall('2026-01-06')],
    ['FREQ=MONTHLY;COUNT=500;BYMONTHDAY=31', wall('1990-01-31')],
    ['FREQ=DAILY;UNTIL=20261015T235959', wall('1970-01-01', '12:00')],
    ['FREQ=MONTHLY;UNTIL=20270101;BYDAY=1SU', wall('1995-01-01')],
  ];
  const windows: [Wall, Wall][] = [
    [wall('2026-09-28'), wall('2026-10-05')],
    [wall('2026-09-01', '07:30'), wall('2026-12-01')],
    [wall('2025-10-01'), wall('2027-10-01')],
    [wall('1970-01-01'), wall('1970-03-01')],
    [wall('2030-12-25'), wall('2031-01-10')],
  ];

  it('送った展開と、開始から歩く展開の結果が同じ', () => {
    for (const [text, start] of cases) {
      for (const [from, to] of windows) {
        expect([text, start, from, mine(text, start, from, to)]).toEqual([
          text,
          start,
          from,
          reference(text, start, from, to),
        ]);
      }
    }
  });

  it('直前の回（previousStart）と、その回か（isOccurrenceOf）も同じ', () => {
    for (const [text, start] of cases) {
      const occurrences = plain(text, start).between(
        floating(wall('2026-01-01')),
        floating(wall('2027-01-01')),
        true,
      );
      for (const d of occurrences.slice(0, 5)) {
        const at: Wall = {
          date: d.toISOString().slice(0, 10),
          time: d.toISOString().slice(11, 16),
        };
        const prev = plain(text, start).before(d, false);
        const got = previousStart(rule(text), start, at);
        expect([text, label(d), got ? label(floating(got)) : null]).toEqual([
          text,
          label(d),
          prev ? label(prev) : null,
        ]);
        expect([text, label(d), isOccurrenceOf(rule(text), start, at)]).toEqual([
          text,
          label(d),
          true,
        ]);
      }
    }
  });
});

describe('総点検のレビュー（C1・C2・C3）: キャッシュが空でも、行が多くても展開は重くならない', () => {
  async function fresh() {
    vi.resetModules();
    return await import('../src/recurrence');
  }
  const window = [wall('2026-09-28'), wall('2026-10-01')] as const;

  it('C1 COUNT の規則は、表示範囲の前でもシリーズ全体を歩かない（60 本のうるう日 COUNT=1000 で 100ms 未満）', async () => {
    const r = await fresh();
    const parsed = r.parseRrule('FREQ=MONTHLY;BYMONTH=2;BYMONTHDAY=29;COUNT=1000');
    if (!parsed.ok) throw new Error(parsed.message);
    const t0 = performance.now();
    for (let mm = 0; mm < 60; mm++) {
      const start = wall('2028-02-29', `07:${String(mm).padStart(2, '0')}`);
      expect(r.ruleStarts(parsed.rule, start, ...window)).toEqual([]);
    }
    // 直す前は 1 本およそ 86ms（4 万 8 千か月を歩く）
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('C1 COUNT の毎年・毎日の規則が 600 本あっても、2 回目の展開は 100ms 未満（キャッシュが入れ替わり続けない）', async () => {
    const r = await fresh();
    for (const text of ['FREQ=YEARLY;COUNT=1000', 'FREQ=DAILY;COUNT=1000']) {
      const parsed = r.parseRrule(text);
      if (!parsed.ok) throw new Error(parsed.message);
      const starts = Array.from({ length: 600 }, (_, i) => wall(addDays('2026-01-01', i), '09:00'));
      for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
      const t0 = performance.now();
      for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
      expect([text, performance.now() - t0 < 100]).toEqual([text, true]);
    }
  });

  it('C2 毎月・毎年の規則が 600 本あっても、回の出ない期間の検査で毎回重くならない（2 回目以降 100ms 未満）', async () => {
    const r = await fresh();
    for (const text of ['FREQ=MONTHLY', 'FREQ=YEARLY', 'FREQ=MONTHLY;BYMONTHDAY=31']) {
      const parsed = r.parseRrule(text);
      if (!parsed.ok) throw new Error(parsed.message);
      const starts = Array.from({ length: 600 }, (_, i) => wall(addDays('2026-01-01', i), '09:00'));
      for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
      for (let pass = 0; pass < 2; pass++) {
        const t0 = performance.now();
        for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
        // 直す前は 600 本で 1 回およそ 1.5 秒（毎月）
        expect([text, pass, performance.now() - t0 < 100]).toEqual([text, pass, true]);
      }
    }
  });

  it('C3 開始が日本時間で 1900〜2999 年の外になる時刻でも、500 ではなく日付の範囲のエラー', () => {
    const owner = '0192f5d0-0000-7000-8000-000000000001';
    for (const [startAt, rrule] of [
      ['2999-12-31T20:00:00-10:00', 'FREQ=MONTHLY'],
      ['2999-12-31T20:00:00-10:00', 'FREQ=YEARLY'],
      ['1900-01-01T00:00:00+14:00', 'FREQ=YEARLY'],
      ['1900-01-01T00:00:00+14:00', 'FREQ=MONTHLY'],
    ] as const) {
      const input = eventCreateSchema.parse({
        title: 'x',
        allDay: false,
        startAt,
        endAt: null,
        rrule,
        memberIds: [owner],
      });
      const res = fieldsFromCreate(input, owner);
      expect([startAt, rrule, 'errors' in res && res.errors.map((e) => e.field)]).toEqual([
        startAt,
        rrule,
        ['startAt'],
      ]);
    }
  });
});

describe('開始を送った展開と素の rrule を、決まった乱数で作った多くの規則で比べる（総点検のレビュー C1）', () => {
  it('毎日・毎週（COUNT・UNTIL・曜日・間隔・WKST・時刻）と毎月・毎年の規則で、表示範囲の回がすべて同じ', () => {
    let seed = 20260928;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    const pickDays = () => {
      const out = days.filter(() => rand(3) === 0);
      return out.length > 0 ? out : [days[rand(7)] as string];
    };
    const monthlyShapes = [
      'BYMONTHDAY=15',
      'BYMONTHDAY=-1',
      'BYMONTHDAY=31',
      'BYDAY=2WE,4WE',
      'BYDAY=-1FR',
      'BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'BYDAY=FR;BYMONTHDAY=13',
    ];
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      const freq = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'][rand(4)] as string;
      let interval = 1 + rand(freq === 'DAILY' ? 20 : 5);
      const parts = [`FREQ=${freq}`];
      if (freq === 'DAILY' && rand(2) === 0) {
        if (interval % 7 === 0) interval += 1;
        parts.push(`BYDAY=${pickDays().join(',')}`);
      }
      if (freq === 'WEEKLY' && rand(3) > 0) parts.push(`BYDAY=${pickDays().join(',')}`);
      if (freq === 'WEEKLY' && rand(3) === 0) parts.push(`WKST=${days[rand(7)]}`);
      if (freq === 'MONTHLY' && rand(2) === 0)
        parts.push(monthlyShapes[rand(monthlyShapes.length)] as string);
      if (interval > 1) parts.push(`INTERVAL=${interval}`);
      const end = rand(3);
      if (end === 0) parts.push(`COUNT=${1 + rand(1000)}`);
      if (end === 1)
        parts.push(`UNTIL=${2026 + rand(3)}${String(1 + rand(12)).padStart(2, '0')}15T235959`);
      const text = parts.join(';');
      const parsed = parseRrule(text);
      if (!parsed.ok) continue;
      const start = wall(
        addDays('1990-01-01', rand(365 * 40)),
        `${String(rand(24)).padStart(2, '0')}:${String(rand(4) * 15).padStart(2, '0')}`,
      );
      if (ruleDensityError(parsed.rule, start) !== null) continue;
      const fromDate = addDays('2025-01-01', rand(365 * 3));
      const from = wall(fromDate, rand(2) === 0 ? '00:00' : '12:30');
      const to = wall(addDays(fromDate, 1 + rand(120)));
      expect([text, start, from, mine(text, start, from, to)]).toEqual([
        text,
        start,
        from,
        reference(text, start, from, to),
      ]);
      compared++;
    }
    expect(compared).toBeGreaterThan(300);
  });
});
