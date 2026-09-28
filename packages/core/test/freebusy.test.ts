import { describe, expect, it } from 'vitest';
import {
  type FreeBusySource,
  freeBusy,
  isRestDay,
  mergeIntervals,
  nextHalfHourMinutes,
  subtractIntervals,
} from '../src/freebusy';
import { fromJst } from '../src/jst';

/** 空き時間（§6 S-06・§22 FreeTimeVM・RUNBOOK 7. Phase 7） */

const P = 'p-papa';
const M = 'p-mama';
const K = 'p-kid';

let n = 0;
function timed(
  date: string,
  start: string,
  end: string | null,
  extra: Partial<FreeBusySource> = {},
) {
  n++;
  return {
    id: `e${n}`,
    title: `予定${n}`,
    allDay: false,
    startAt: `${date}T${start}:00+09:00`,
    endAt: end ? (end.includes('T') ? end : `${date}T${end}:00+09:00`) : null,
    rrule: null,
    exdates: [],
    parentId: null,
    recurrenceId: null,
    busy: true,
    forEveryone: false,
    memberIds: [P],
    visibility: 'family',
    ownerId: P,
    ...extra,
  } satisfies FreeBusySource;
}

function allDay(startDate: string, endDate: string, extra: Partial<FreeBusySource> = {}) {
  n++;
  return {
    id: `e${n}`,
    title: `終日${n}`,
    allDay: true,
    startDate,
    endDate,
    rrule: null,
    exdates: [],
    parentId: null,
    recurrenceId: null,
    busy: true,
    forEveryone: false,
    memberIds: [P],
    visibility: 'family',
    ownerId: P,
    ...extra,
  } satisfies FreeBusySource;
}

// 2026-09-28(月) 9:00 に見る。週は 9/28(月)〜10/4(日)
const NOW = fromJst('2026-09-28', '09:00');
const base = {
  from: '2026-09-28',
  days: 7,
  memberIds: [P, M],
  preset: 'evenings' as const,
  minDuration: 120,
  nowMs: NOW,
  viewerId: P,
};

describe('区間の計算', () => {
  it('和と差', () => {
    expect(
      mergeIntervals([
        { startMin: 60, endMin: 120 },
        { startMin: 0, endMin: 30 },
        { startMin: 100, endMin: 200 },
        { startMin: 200, endMin: 210 },
      ]),
    ).toEqual([
      { startMin: 0, endMin: 30 },
      { startMin: 60, endMin: 210 },
    ]);
    expect(
      subtractIntervals(1020, 1440, [
        { startMin: 1080, endMin: 1140 },
        { startMin: 1300, endMin: 1500 },
      ]),
    ).toEqual([
      { startMin: 1020, endMin: 1080 },
      { startMin: 1140, endMin: 1300 },
    ]);
    expect(subtractIntervals(1020, 1440, [{ startMin: 0, endMin: 1440 }])).toEqual([]);
  });

  it('今の時刻を 30 分単位に切り上げる（ちょうどならそのまま）', () => {
    expect(nextHalfHourMinutes(fromJst('2026-09-27', '14:18'))).toBe(14 * 60 + 30);
    expect(nextHalfHourMinutes(fromJst('2026-09-27', '15:00'))).toBe(15 * 60);
    expect(nextHalfHourMinutes(fromJst('2026-09-27', '15:00') + 1000)).toBe(15 * 60 + 30);
    expect(nextHalfHourMinutes(fromJst('2026-09-27', '23:45'))).toBe(24 * 60);
  });

  it('休日は土日と祝日（振替休日を含む）', () => {
    expect(isRestDay('2026-10-03')).toBe(true);
    expect(isRestDay('2026-10-04')).toBe(true);
    expect(isRestDay('2026-10-12')).toBe(true); // スポーツの日
    expect(isRestDay('2026-09-22')).toBe(true); // 国民の休日
    expect(isRestDay('2026-10-05')).toBe(false);
  });
});

describe('空き時間の候補（§6 S-06）', () => {
  it('夜（17–24 時）: 家族みんなが空いている区間を、長さの条件で日付の順に最大 5 件', () => {
    const r = freeBusy({
      ...base,
      events: [
        timed('2026-09-28', '18:00', '19:00'),
        timed('2026-09-29', '17:00', '23:00', { memberIds: [M], ownerId: M }),
      ],
    });
    // 9/28 は 17–18（60 分で足りない）と 19–24、9/29 は 23–24（足りない）
    expect(r.days[0]?.commonFree).toEqual([{ startMin: 19 * 60, endMin: 24 * 60 }]);
    expect(r.days[1]?.commonFree).toEqual([]);
    expect(r.candidates.map((c) => c.label)).toEqual([
      '9/28(月) 19:00–24:00',
      '9/30(水) 17:00–24:00',
      '10/1(木) 17:00–24:00',
      '10/2(金) 17:00–24:00',
      '10/3(土) 17:00–24:00',
    ]);
    expect(r.days).toHaveLength(7);
  });

  it('今日は 30 分単位に切り上げた今より後だけ。昨日までの日は候補にしない', () => {
    const r = freeBusy({
      ...base,
      events: [],
      preset: 'all',
      from: '2026-09-27',
      days: 3,
      nowMs: fromJst('2026-09-28', '14:18'),
    });
    expect(r.days.map((d) => [d.date, d.commonFree])).toEqual([
      ['2026-09-27', []],
      ['2026-09-28', [{ startMin: 14 * 60 + 30, endMin: 24 * 60 }]],
      ['2026-09-29', [{ startMin: 6 * 60, endMin: 24 * 60 }]],
    ]);
    expect(r.candidates[0]?.label).toBe('9/28(月) 14:30–24:00');
  });

  it('休日（土日祝の 8–24 時）は、その日だけを並べる', () => {
    const r = freeBusy({ ...base, events: [], preset: 'holidays', from: '2026-10-05', days: 14 });
    expect(r.days.map((d) => [d.date, d.holiday])).toEqual([
      ['2026-10-10', null],
      ['2026-10-11', null],
      ['2026-10-12', 'スポーツの日'],
      ['2026-10-17', null],
      ['2026-10-18', null],
    ]);
    expect(r.candidates[0]?.label).toBe('10/10(土) 8:00–24:00');
  });

  it('予定なし（busy=false）は除き、他人の非公開は中身を出さずに「予定あり」として含める', () => {
    const r = freeBusy({
      ...base,
      events: [
        timed('2026-09-28', '17:00', '18:00', { busy: false, title: '見るだけ' }),
        timed('2026-09-28', '20:00', '21:00', {
          memberIds: [M],
          ownerId: M,
          visibility: 'private',
          title: null,
        }),
        timed('2026-09-28', '22:00', '23:00', { visibility: 'private', title: '自分の内緒' }),
      ],
    });
    expect(r.days[0]?.busy).toEqual([
      { memberId: M, startMin: 20 * 60, endMin: 21 * 60, label: null },
      { memberId: P, startMin: 22 * 60, endMin: 23 * 60, label: '自分の内緒' },
    ]);
    expect(r.days[0]?.commonFree).toEqual([{ startMin: 17 * 60, endMin: 20 * 60 }]);
  });

  it('終了時刻なしは 60 分。日付をまたぐ予定は翌日にも反映する', () => {
    const r = freeBusy({
      ...base,
      minDuration: 60,
      events: [
        timed('2026-09-28', '17:30', null),
        timed('2026-09-29', '22:00', '2026-09-30T08:00:00+09:00', { memberIds: [M], ownerId: M }),
      ],
    });
    expect(r.days[0]?.busy.map((b) => [b.startMin, b.endMin])).toEqual([
      [17 * 60 + 30, 18 * 60 + 30],
    ]);
    expect(r.days[1]?.busy.map((b) => [b.startMin, b.endMin])).toEqual([[22 * 60, 24 * 60]]);
    expect(r.days[2]?.busy.map((b) => [b.startMin, b.endMin])).toEqual([[0, 8 * 60]]);
    expect(r.days[1]?.commonFree).toEqual([{ startMin: 17 * 60, endMin: 22 * 60 }]);
  });

  it('全員の予定は選んだ家族みんなをふさぐ。選んでいない家族の予定はふさがない', () => {
    const r = freeBusy({
      ...base,
      events: [
        timed('2026-09-28', '17:00', '2026-09-29T00:00:00+09:00', { memberIds: [K], ownerId: K }),
        timed('2026-09-29', '17:00', '2026-09-30T00:00:00+09:00', {
          memberIds: [],
          forEveryone: true,
        }),
      ],
    });
    expect(r.days[0]?.commonFree).toEqual([{ startMin: 17 * 60, endMin: 24 * 60 }]);
    expect(r.days[1]?.busy.map((b) => b.memberId).sort()).toEqual([M, P]);
    expect(r.days[1]?.commonFree).toEqual([]);
  });

  it('複数日の終日（留守）はその日すべてをふさぐ。1 日だけの終日（既定は予定なし）はふさがない', () => {
    const r = freeBusy({
      ...base,
      events: [
        allDay('2026-09-29', '2026-09-30'),
        allDay('2026-10-01', '2026-10-01', { busy: false }),
      ],
    });
    expect(r.days[1]?.busy).toEqual([
      { memberId: P, startMin: 0, endMin: 1440, label: '終日' + (n - 1) },
    ]);
    expect(r.days[1]?.commonFree).toEqual([]);
    expect(r.days[2]?.commonFree).toEqual([]);
    expect(r.days[3]?.commonFree).toEqual([{ startMin: 17 * 60, endMin: 24 * 60 }]);
  });

  it('繰り返しの回もふさぐ（取り消した回はふさがない）', () => {
    const r = freeBusy({
      ...base,
      events: [
        {
          ...timed('2026-09-28', '19:00', '20:00'),
          rrule: 'FREQ=DAILY;COUNT=7',
          exdates: ['2026-09-30T19:00'],
        },
      ],
    });
    expect(r.days.map((d) => d.busy.length)).toEqual([1, 1, 0, 1, 1, 1, 1]);
    expect(r.days[2]?.commonFree).toEqual([{ startMin: 17 * 60, endMin: 24 * 60 }]);
  });
});
