import * as rruleModule from 'rrule';
import { describe, expect, it } from 'vitest';
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
