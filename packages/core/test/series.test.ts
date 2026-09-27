import { describe, expect, it } from 'vitest';
import type { EventRecord } from '../src/events';
import { fromJst } from '../src/jst';
import { fromPreset, sameRule, toPreset } from '../src/recurrence';
import { allScopeChanges, seriesLoss, shiftSeries, splitSeries } from '../src/series';

/** 繰り返しの範囲の計算（§11）。レビュー P3-core-02・03・05・06、P3-server-01・03 の再現を含む */

function master(over: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'm',
    version: 1,
    title: 'ゴミ出し',
    note: null,
    location: null,
    allDay: false,
    startAt: fromJst('2026-09-28', '07:30'),
    endAt: fromJst('2026-09-28', '08:00'),
    startDate: null,
    endDate: null,
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    exdates: [],
    parentId: null,
    recurrenceId: null,
    memberIds: ['a'],
    forEveryone: false,
    busy: true,
    visibility: 'family',
    ownerId: 'a',
    createdBy: 'a',
    updatedBy: 'a',
    deletedBy: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...over,
  };
}

/** 10/5（月）の回を 10/6（火）9:00 に動かした例外行 */
function movedException(m: EventRecord): EventRecord {
  return {
    ...m,
    id: 'ex',
    rrule: null,
    parentId: m.id,
    recurrenceId: '2026-10-05T07:30',
    startAt: fromJst('2026-10-06', '09:00'),
    endAt: fromJst('2026-10-06', '09:30'),
  };
}

describe('「すべて」の変更（allScopeChanges）', () => {
  it('例外で動かした回から件名だけ直すと、日時はシリーズの変更にしない（全部の項目を送っても）', () => {
    const m = master();
    const ex = movedException(m);
    const r = allScopeChanges(m, '2026-10-05T07:30', ex, {
      title: '燃えるゴミ',
      startAt: '2026-10-06T09:00:00+09:00',
      endAt: '2026-10-06T09:30:00+09:00',
      allDay: false,
    });
    expect(r).toEqual({ changes: { title: '燃えるゴミ' } });
  });

  it('日時を変えたら、元の回の日時からの差分をマスターに当てる（曜日もずらす）', () => {
    const m = master();
    const r = allScopeChanges(
      m,
      '2026-10-05T07:30',
      { ...m, startAt: fromJst('2026-10-05', '07:30'), endAt: fromJst('2026-10-05', '08:00') },
      {
        startAt: '2026-10-06T08:00:00+09:00',
        endAt: '2026-10-06T08:30:00+09:00',
      },
    );
    expect(r).toEqual({
      changes: {
        allDay: false,
        startAt: '2026-09-29T08:00:00+09:00',
        endAt: '2026-09-29T08:30:00+09:00',
        rrule: 'FREQ=WEEKLY;BYDAY=TU,FR',
      },
    });
  });

  it('動かした先が規則の回にならないなら保存しない（第2・第4水曜を第3木曜へ）', () => {
    const m = master({
      startAt: fromJst('2026-10-14', '07:30'),
      endAt: null,
      rrule: 'FREQ=MONTHLY;BYDAY=2WE,4WE',
    });
    const base = { ...m };
    const r = allScopeChanges(m, '2026-10-14T07:30', base, {
      startAt: '2026-10-15T07:30:00+09:00',
    });
    expect('errors' in r).toBe(true);
  });

  it('毎月の日付: 同じ月の中で動かしたら、その日の毎月にして開始をその月の回に置き直す', () => {
    const m = master({
      startAt: fromJst('2026-09-30', '07:30'),
      endAt: null,
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
    });
    const at = (date: string, time: string) => ({
      allDay: false,
      startAt: fromJst(date, time),
      endAt: null,
      startDate: null,
      endDate: null,
    });
    // 月末（10/31）→ 10/30: 毎月 30 日、開始は 9/30
    expect(shiftSeries(m, '2026-10-31T07:30', at('2026-10-30', '08:00'))).toEqual({
      ...at('2026-09-30', '08:00'),
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=30',
    });
    // 月をまたぐ（10/31 → 11/1）は決められないので断る（レビュー P3-core-03）
    expect(shiftSeries(m, '2026-10-31T07:30', at('2026-11-01', '07:30'))).toEqual({
      error: expect.any(String),
    });
  });

  it('第 n 曜日: 第2水曜（10/14）を 10/15 に動かすと第3木曜、開始は元の月の第3木曜', () => {
    const m = master({
      startAt: fromJst('2026-09-09', '07:30'),
      endAt: null,
      rrule: 'FREQ=MONTHLY;BYDAY=2WE',
    });
    const s = shiftSeries(m, '2026-10-14T07:30', {
      allDay: false,
      startAt: fromJst('2026-10-15', '07:30'),
      endAt: null,
      startDate: null,
      endDate: null,
    });
    expect(s).toEqual({
      allDay: false,
      startAt: fromJst('2026-09-17', '07:30'),
      endAt: null,
      startDate: null,
      endDate: null,
      rrule: 'FREQ=MONTHLY;BYDAY=3TH',
    });
  });
});

describe('消える例外・取り消し（seriesLoss。サーバーのリセットと C-04 の件数で共有）', () => {
  const m = master({ exdates: ['2026-10-01T07:30', '2026-10-12T07:30'] });
  const exceptions = ['2026-10-05T07:30', '2026-10-15T07:30'];

  it('何も変えなければ消えない。書き方だけ違う規則も同じ', () => {
    expect(seriesLoss(m, m, exceptions)).toEqual({ exceptions: [], exdates: [] });
    expect(seriesLoss(m, { ...m, rrule: 'FREQ=WEEKLY;BYDAY=TH,MO' }, exceptions)).toEqual({
      exceptions: [],
      exdates: [],
    });
  });

  it('開始の日時が変わったら、すべて消える', () => {
    const next = { ...m, startAt: fromJst('2026-09-28', '08:00') };
    expect(seriesLoss(m, next, exceptions)).toEqual({
      exceptions,
      exdates: m.exdates,
    });
  });

  it('終わりの回数だけ変えたら、新しい規則でも回として残るものは残る（レビュー P3-server-03）', () => {
    // 9/28 から月・木で 5 回 → 9/28, 10/1, 10/5, 10/8, 10/12
    const next = { ...m, rrule: 'FREQ=WEEKLY;BYDAY=MO,TH;COUNT=5' };
    expect(seriesLoss(m, next, exceptions)).toEqual({
      exceptions: ['2026-10-15T07:30'],
      exdates: [],
    });
  });

  it('曜日を変えたら、新しい曜日に当たらないものだけ消える', () => {
    const next = { ...m, rrule: 'FREQ=WEEKLY;BYDAY=MO' };
    expect(seriesLoss(m, next, exceptions)).toEqual({
      exceptions: ['2026-10-15T07:30'],
      exdates: ['2026-10-01T07:30'],
    });
  });
});

describe('規則の比べ方（sameRule）と、画面を通しても規則が変わらないこと（レビュー P3-core-05）', () => {
  it('並び・暗に決まる曜日の違いは同じ', () => {
    expect(sameRule('FREQ=WEEKLY;BYDAY=TH,MO', 'FREQ=WEEKLY;BYDAY=MO,TH', '2026-09-28')).toBe(true);
    expect(sameRule('FREQ=WEEKLY', 'FREQ=WEEKLY;BYDAY=MO', '2026-09-28')).toBe(true);
    expect(sameRule('FREQ=MONTHLY', 'FREQ=MONTHLY;BYMONTHDAY=28', '2026-09-28')).toBe(true);
    expect(sameRule('FREQ=WEEKLY;BYDAY=MO', 'FREQ=WEEKLY;BYDAY=TU', '2026-09-28')).toBe(false);
    expect(sameRule('FREQ=DAILY;COUNT=5', 'FREQ=DAILY;COUNT=6', '2026-09-28')).toBe(false);
    expect(sameRule('FREQ=DAILY;COUNT=5', 'FREQ=DAILY;COUNT=6', '2026-09-28', true)).toBe(true);
    expect(sameRule(null, null, '2026-09-28')).toBe(true);
    expect(sameRule('FREQ=DAILY', null, '2026-09-28')).toBe(false);
  });

  it.each([
    'FREQ=WEEKLY;BYDAY=TH,MO',
    'FREQ=WEEKLY',
    'FREQ=DAILY;INTERVAL=2;COUNT=10',
    'FREQ=MONTHLY;BYDAY=2WE,4WE',
    'FREQ=MONTHLY;BYMONTHDAY=-1',
    'FREQ=YEARLY;UNTIL=20271231T235959',
    'FREQ=DAILY;WKST=MO',
  ])('%s は toPreset → fromPreset を通しても同じ規則', (rrule) => {
    const p = toPreset(rrule, '2026-09-28');
    const back = fromPreset(p.recurrence, p.end, false);
    // カスタム（undefined）は今の規則のまま
    expect(sameRule(rrule, back === undefined ? rrule : back, '2026-09-28')).toBe(true);
  });
});

describe('「これ以降」の分割', () => {
  it('初回なら null（「すべて」と同じ）', () => {
    expect(splitSeries(master(), '2026-09-28T07:30')).toBeNull();
    expect(splitSeries(master(), '2026-10-01T07:30')).not.toBeNull();
  });
});
