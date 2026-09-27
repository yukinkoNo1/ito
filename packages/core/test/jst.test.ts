import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  diffDays,
  fromJst,
  isValidDate,
  isValidTime,
  parseIsoToMs,
  startOfWeek,
  todayJst,
  toIsoJst,
  toJstParts,
  weekdayOf,
} from '../src/jst';

describe('jst（SPEC §11）', () => {
  it('JST の 23:59 と 0:00 の境界', () => {
    const lastMinute = fromJst('2026-09-27', '23:59');
    expect(todayJst(lastMinute)).toBe('2026-09-27');
    expect(todayJst(lastMinute + 60_000)).toBe('2026-09-28');
    // UTC では前日の 15:00
    expect(new Date(fromJst('2026-09-28', '00:00')).toISOString()).toBe('2026-09-27T15:00:00.000Z');
  });

  it('toJstParts は端末のタイムゾーンに依存しない', () => {
    const p = toJstParts(Date.UTC(2026, 8, 27, 5, 18));
    expect(p).toMatchObject({ date: '2026-09-27', time: '14:18', weekday: 0 });
  });

  it('曜日', () => {
    expect(weekdayOf('2026-09-27')).toBe(0);
    expect(weekdayOf('2026-10-03')).toBe(6);
    expect(weekdayOf('2028-02-29')).toBe(2);
  });

  it('日付の足し算（月末・年末・うるう年）', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-09-27', '2026-10-12')).toBe(15);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('週の始まり', () => {
    expect(startOfWeek('2026-09-30', 0)).toBe('2026-09-27');
    expect(startOfWeek('2026-09-30', 1)).toBe('2026-09-28');
    expect(startOfWeek('2026-09-27', 1)).toBe('2026-09-21');
  });

  it('ISO（+09:00）との変換', () => {
    const ms = fromJst('2026-10-03', '07:00');
    expect(toIsoJst(ms)).toBe('2026-10-03T07:00:00+09:00');
    expect(parseIsoToMs('2026-10-03T07:00:00+09:00')).toBe(ms);
    expect(parseIsoToMs('2026-10-02T22:00:00Z')).toBe(ms);
    expect(parseIsoToMs('2026-10-03 07:00')).toBeNull();
    expect(parseIsoToMs('2026-02-30T07:00:00+09:00')).toBeNull();
  });

  it('形式の検査', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('07:30')).toBe(true);
    expect(isValidTime('7:30')).toBe(false);
  });
});
