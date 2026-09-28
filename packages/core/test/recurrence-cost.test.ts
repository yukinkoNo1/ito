import * as rruleModule from 'rrule';
import { describe, expect, it, vi } from 'vitest';
import { eventCreateSchema, fieldsFromCreate } from '../src/index';
import { addDays } from '../src/jst';
import {
  densityPathsForTest,
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
  // rrule は BYSETPOS の位置が同じ日を指すと同じ日時を 2 回出す。展開は 1 回にするので、正解の側もまとめる
  return plain(text, dtstart)
    .between(floating(from), toD, true)
    .filter((d, i, all) => d < toD && (i === 0 || d.getTime() !== all[i - 1]?.getTime()))
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

describe('BYSETPOS の位置が同じ日を指しても、同じ回を 2 回出さない（総点検のレビューで見つけた rrule の重複）', () => {
  it('毎月 15 日の 1 番目と最後（同じ日）・4 週の月の第 4 と最後の月曜は 1 回', () => {
    expect(
      ruleStarts(
        rule('FREQ=MONTHLY;BYMONTHDAY=15;BYSETPOS=1,-1'),
        wall('2026-01-15'),
        wall('2026-01-01'),
        wall('2026-04-01'),
      ).map((w) => w.date),
    ).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    const mondays = ruleStarts(
      rule('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=4,-1'),
      wall('2026-01-05'),
      wall('2026-01-01'),
      wall('2027-01-01'),
    ).map((w) => w.date);
    expect(new Set(mondays).size).toBe(mondays.length);
  });
});

describe('総点検のレビュー（2 回目）: 回が出ると形から決める判定の誤り', () => {
  it('BYDAY に曜日と第 n 曜日を混ぜた規則は、rrule では両方に合う日だけ。回が出なければ保存できない', () => {
    const start = wall('2026-01-01');
    for (const text of [
      'FREQ=MONTHLY;BYDAY=MO,1TU',
      'FREQ=YEARLY;BYDAY=MO,1TU',
      'FREQ=YEARLY;BYMONTH=3;BYDAY=SU,2SA',
    ]) {
      expect([text, ruleDensityError(rule(text), start)]).not.toEqual([text, null]);
    }
    // 両方に合う日がある規則（最後の月曜）は保存でき、素の rrule と同じ回
    const ok = 'FREQ=MONTHLY;BYDAY=MO,-1MO';
    expect(ruleDensityError(rule(ok), start)).toBeNull();
    expect(mine(ok, start, wall('2026-01-01'), wall('2027-01-01'))).toEqual(
      reference(ok, start, wall('2026-01-01'), wall('2027-01-01')),
    );
  });
});

describe('形からの判定は、周期をたどる判定と食い違わない（総点検のレビュー 2 回目）', () => {
  it('決まった乱数で作った毎月・毎年の規則で、形から「どの期間にも回が出る」とした規則は、たどっても回の出ない期間が続かない', () => {
    let seed = 777;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    let claimed = 0;
    for (let i = 0; i < 1500; i++) {
      const freq = rand(2) === 0 ? 'MONTHLY' : 'YEARLY';
      const parts = [`FREQ=${freq}`];
      const byDay: string[] = [];
      for (let j = rand(3); j > 0; j--) {
        const n = rand(3) === 0 ? '' : String([1, 2, 3, 4, 5, -1, -2, -5][rand(8)]);
        byDay.push(`${n}${days[rand(7)]}`);
      }
      if (byDay.length > 0) parts.push(`BYDAY=${[...new Set(byDay)].join(',')}`);
      if (rand(3) === 0) parts.push(`BYMONTHDAY=${[1, 13, 28, 29, 30, 31, -1, -28, -29][rand(9)]}`);
      if (rand(3) === 0) parts.push(`BYMONTH=${1 + rand(12)}`);
      if (freq === 'YEARLY' && rand(6) === 0) parts.push(`BYWEEKNO=${1 + rand(53)}`);
      if (rand(3) === 0) parts.push(`INTERVAL=${1 + rand(24)}`);
      const parsed = parseRrule(parts.join(';'));
      if (!parsed.ok) continue;
      const start = wall(addDays('1990-01-01', rand(365 * 60)));
      const { shape, walk } = densityPathsForTest(parsed.rule, start);
      if (shape) {
        claimed++;
        expect([parts.join(';'), start.date, walk]).toEqual([parts.join(';'), start.date, true]);
      }
    }
    expect(claimed).toBeGreaterThan(100);
  });
});

describe('総点検のレビュー（2 回目）D2: COUNT の毎月・毎年の規則も、表示のたびに開始から歩かない', () => {
  it('1970 年に始まる COUNT の毎月・毎年の規則が 600 本あっても、2 回目の展開は 100ms 未満', async () => {
    vi.resetModules();
    const r = await import('../src/recurrence');
    for (const text of [
      'FREQ=MONTHLY;COUNT=1000',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=1000',
      'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=1000',
      'FREQ=YEARLY;COUNT=1000',
    ]) {
      const parsed = r.parseRrule(text);
      if (!parsed.ok) throw new Error(parsed.message);
      const starts = Array.from({ length: 600 }, (_, i) =>
        wall(addDays('1970-01-01', i * 3), '09:00'),
      );
      const window = [wall('2026-09-28'), wall('2026-10-01')] as const;
      for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
      const t0 = performance.now();
      for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
      // 直す前は 600 本で 1 回およそ 0.9〜1.2 秒（毎月）
      expect([text, performance.now() - t0 < 100]).toEqual([text, true]);
    }
  });
});

describe('COUNT の毎月・毎年で開始を送っても、出る回は素の rrule と同じ（総点検のレビュー 2 回目 D2）', () => {
  it('決まった乱数で作った COUNT の毎月・毎年の規則（BYSETPOS の重複・第 n 曜日・月の絞り込み・週番号を含む）', () => {
    let seed = 4242;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const shapes = [
      '',
      'BYMONTHDAY=31',
      'BYMONTHDAY=-1',
      'BYMONTHDAY=15;BYSETPOS=1,-1',
      'BYDAY=MO;BYSETPOS=4,-1',
      'BYDAY=2WE,4WE',
      'BYDAY=-1FR',
      'BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'BYDAY=FR;BYMONTHDAY=13',
      'BYMONTH=2;BYMONTHDAY=29',
      'BYMONTH=3,9;BYDAY=1SU',
    ];
    let compared = 0;
    for (let i = 0; i < 500; i++) {
      const freq = rand(3) === 0 ? 'YEARLY' : 'MONTHLY';
      const parts = [`FREQ=${freq}`];
      const shape = shapes[rand(shapes.length)] as string;
      if (shape) parts.push(shape);
      if (freq === 'YEARLY' && rand(5) === 0) parts.push('BYWEEKNO=20;BYDAY=MO');
      const interval = 1 + rand(freq === 'MONTHLY' ? 13 : 4);
      if (interval > 1) parts.push(`INTERVAL=${interval}`);
      parts.push(`COUNT=${1 + rand(1000)}`);
      const text = parts.join(';');
      const parsed = parseRrule(text);
      if (!parsed.ok) continue;
      const start = wall(
        addDays('1970-01-01', rand(365 * 60)),
        `${String(rand(24)).padStart(2, '0')}:${rand(2) === 0 ? '00' : '30'}`,
      );
      if (ruleDensityError(parsed.rule, start) !== null) continue;
      const fromDate = addDays('2020-01-01', rand(365 * 10));
      const from = wall(fromDate);
      const to = wall(addDays(fromDate, 1 + rand(400)));
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

describe('総点検のレビュー（2 回目）D3: 範囲の外の開始に終わりの時刻があっても 500 にしない', () => {
  it('開始が日本時間で 3000 年・1899 年になる時刻と終わりの時刻は、日付の範囲のエラー', () => {
    const owner = '0192f5d0-0000-7000-8000-000000000001';
    for (const [startAt, endAt, rrule] of [
      ['2999-12-31T20:00:00-10:00', '2999-12-31T21:00:00-10:00', null],
      ['2999-12-31T20:00:00-10:00', '2999-12-31T21:00:00-10:00', 'FREQ=MONTHLY'],
      ['1900-01-01T00:00:00+14:00', '1900-01-01T01:00:00+14:00', 'FREQ=DAILY'],
    ] as const) {
      const input = eventCreateSchema.parse({
        title: 'x',
        allDay: false,
        startAt,
        endAt,
        rrule,
        memberIds: [owner],
      });
      const res = fieldsFromCreate(input, owner);
      expect([startAt, 'errors' in res && res.errors.map((e) => e.field)]).toEqual([
        startAt,
        ['startAt'],
      ]);
    }
  });
});

describe('総点検のレビュー（3 回目）E1・E2: COUNT の毎月・毎年で覚えるものが入れ替わり続けない・範囲が動いても開始から足し直さない', () => {
  const pad = (n: number) => String(n).padStart(2, '0');
  const starts = Array.from({ length: 600 }, (_, i) =>
    wall(addDays('1970-01-01', i * 3), `${pad(8 + Math.floor(i / 60))}:${pad(i % 60)}`),
  );

  it('E1 始まる時刻がばらばらな 600 本でも、期間ごとの回の数は規則の形ごとに 1 回だけ数える（2 回目の展開は 100ms 未満）', async () => {
    vi.resetModules();
    const r = await import('../src/recurrence');
    // 仕事の数で確かめる（時刻を鍵に入れると、600 本 × 期間の種類およそ 98 回を数え直す。4 回目 F4・F6）
    const counted = r.parseRrule('FREQ=MONTHLY;COUNT=1000');
    if (!counted.ok) throw new Error(counted.message);
    const first = r.recurrenceWorkForTest().probes;
    for (const s of starts) r.ruleStarts(counted.rule, s, wall('2026-09-28'), wall('2026-10-01'));
    // 最初の期間（開始より後）を 1 本ずつ 600 回と、期間の種類（開始の日で決まる BYMONTHDAY の 31 通りの形 ×
    // およそ 98 種類）。時刻を鍵に入れると 600 本 × 98 種類＝およそ 58,800 回になる
    expect(r.recurrenceWorkForTest().probes - first).toBeLessThan(5000);
    // 間隔も回の数に関係しないので鍵に入れない（間隔を変えた 600 本でも同じ。5 回目 G6）
    const second = r.recurrenceWorkForTest().probes;
    for (const [i, s] of starts.entries()) {
      const p = r.parseRrule(`FREQ=MONTHLY;INTERVAL=${1 + (i % 12)};COUNT=1000`);
      if (!p.ok) throw new Error(p.message);
      r.ruleStarts(p.rule, s, wall('2026-09-28'), wall('2026-10-01'));
    }
    expect(r.recurrenceWorkForTest().probes - second).toBeLessThan(1000);
    for (const text of [
      'FREQ=MONTHLY;COUNT=1000',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1;COUNT=1000',
    ]) {
      const parsed = r.parseRrule(text);
      if (!parsed.ok) throw new Error(parsed.message);
      const window = [wall('2026-09-28'), wall('2026-10-01')] as const;
      for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
      const t0 = performance.now();
      for (const s of starts) r.ruleStarts(parsed.rule, s, ...window);
      // 直す前はおよそ 0.56〜0.92 秒
      expect([text, performance.now() - t0 < 100]).toEqual([text, true]);
    }
  });

  it('E2 表示範囲を 1 か月ずつ動かしても、開始から足し直さない（1 本あたり 64 期間まで。1 回の展開は 600 本で 100ms 未満）', async () => {
    vi.resetModules();
    const r = await import('../src/recurrence');
    const parsed = r.parseRrule('FREQ=MONTHLY;COUNT=1000');
    if (!parsed.ok) throw new Error(parsed.message);
    for (const s of starts) r.ruleStarts(parsed.rule, s, wall('2026-09-28'), wall('2026-10-01'));
    for (const month of ['2026-10-28', '2026-11-28', '2026-12-28']) {
      // 仕事の数で確かめる（区切りを覚えないと、1 本あたり開始からの 670 期間ほどを足し直す。4 回目 F3・F5）
      const before = r.recurrenceWorkForTest().periodSteps;
      const t0 = performance.now();
      for (const s of starts) r.ruleStarts(parsed.rule, s, wall(month), wall(addDays(month, 3)));
      expect([month, r.recurrenceWorkForTest().periodSteps - before <= 600 * 64]).toEqual([
        month,
        true,
      ]);
      // 直す前は 1 か月動かすたびにおよそ 0.27 秒
      expect([month, performance.now() - t0 < 100]).toEqual([month, true]);
    }
  });
});

describe('総点検のレビュー（4 回目）F1・F2: 繰り返しの上限（1 人 100 件・家族は 8 人まで＝800 件）いっぱいでも、覚えたものが入れ替わり続けない', () => {
  const pad = (n: number) => String(n).padStart(2, '0');
  // 形から判定できない（周期をたどる）規則と、COUNT の毎月の規則を、形をすべて変えて 800 本
  const triples: [number, number, number][] = [];
  for (let a = 1; a <= 28 && triples.length < 800; a++)
    for (let b = a + 1; b <= 28 && triples.length < 800; b++)
      for (let c = b + 1; c <= 28 && triples.length < 800; c++) triples.push([a, b, c]);
  const starts = triples.map((_, i) =>
    wall(addDays('1970-01-05', i * 7), `${pad(6 + (i % 12))}:${pad(i % 60)}`),
  );

  it('F1 形から判定できない 800 本の規則: 2 回目の展開は 300ms 未満', async () => {
    vi.resetModules();
    const r = await import('../src/recurrence');
    const rules = triples.map(([a, b, c]) => {
      const p = r.parseRrule(
        `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYMONTHDAY=${a},${b},${c};BYSETPOS=1`,
      );
      if (!p.ok) throw new Error(p.message);
      return p.rule;
    });
    const window = [wall('2026-09-28'), wall('2026-10-01')] as const;
    for (const [i, rule] of rules.entries()) r.ruleStarts(rule, starts[i] as Wall, ...window);
    const t0 = performance.now();
    for (const [i, rule] of rules.entries()) r.ruleStarts(rule, starts[i] as Wall, ...window);
    expect(performance.now() - t0).toBeLessThan(300);
  }, 30_000);

  it('F2 形がすべて違う COUNT の毎月の規則 800 本: 2 回目の展開は期間ごとの回の数を数え直さない', async () => {
    vi.resetModules();
    const r = await import('../src/recurrence');
    const rules = triples.map(([a, b, c]) => {
      const p = r.parseRrule(`FREQ=MONTHLY;BYMONTHDAY=${a},${b},-${c};COUNT=1000`);
      if (!p.ok) throw new Error(p.message);
      return p.rule;
    });
    const window = [wall('2026-09-28'), wall('2026-10-01')] as const;
    for (const [i, rule] of rules.entries()) r.ruleStarts(rule, starts[i] as Wall, ...window);
    const before = r.recurrenceWorkForTest().probes;
    const t0 = performance.now();
    for (const [i, rule] of rules.entries()) r.ruleStarts(rule, starts[i] as Wall, ...window);
    expect(r.recurrenceWorkForTest().probes - before).toBe(0);
    expect(performance.now() - t0).toBeLessThan(300);
  }, 30_000);
});

describe('総点検のレビュー（5 回目）G3: BYSETPOS は 7 個まで（1 期間ごとの計算を重くしない）', () => {
  it('BYSETPOS の値が 8 個以上の規則は保存できない。7 個までは使える', () => {
    const long = parseRrule(
      'FREQ=YEARLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYSETPOS=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20',
    );
    expect(long.ok).toBe(false);
    expect(parseRrule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,2,3,4,5,6,7,8').ok).toBe(false);
    expect(parseRrule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1,2,3,4,5,-2,-1').ok).toBe(true);
    expect(parseRrule('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1').ok).toBe(true);
  });
});
