import { addDays, fromJst } from '@ito/core';
import { describe, expect, it } from 'vitest';
import {
  buildActivity,
  buildDetail,
  buildTrash,
  draftToInput,
  emptyDraft,
  eventToDraft,
} from '../src/viewmodels/detail';
import { buildDay, buildFlowItems, buildSummary, groupByDay } from '../src/viewmodels/flow';
import { detailDateLabel, detailTimeLabel, longDateLabel } from '../src/viewmodels/labels';
import { buildMonth } from '../src/viewmodels/month';
import {
  isFresh,
  occurrencesBetween,
  toMemberVMs,
  toOccurrenceVM,
} from '../src/viewmodels/occurrence';
import { allDayEv, ctx, ev, M, members } from './fixtures';

describe('OccurrenceVM（§22）', () => {
  it('全員の予定は memberIds に全員の ID、他人の非公開は title: null・isPrivate', () => {
    const events = [
      ev({ title: '焼肉', forEveryone: true, memberIds: [] }),
      ev({
        title: null,
        visibility: 'private',
        ownerId: M.yuki,
        memberIds: [M.yuki],
        updatedAt: null,
        createdAt: null,
      }),
    ];
    const occs = occurrencesBetween(events, '2026-09-29', '2026-09-30').map((o) =>
      toOccurrenceVM(o, ctx()),
    );
    expect(occs[0]?.memberIds).toEqual([M.papa, M.mama, M.yuki, M.haru]);
    expect(occs[1]).toMatchObject({ title: null, isPrivate: true, fresh: false });
  });

  it('新着の印: 前回開いた時刻より新しく、自分以外が変えた予定だけ', () => {
    const since = fromJst('2026-09-28', '12:00');
    expect(
      isFresh(ev({ updatedAt: '2026-09-28T13:00:00+09:00', updatedBy: M.mama }), {
        freshSince: since,
        meId: M.papa,
      }),
    ).toBe(true);
    expect(
      isFresh(ev({ updatedAt: '2026-09-28T13:00:00+09:00', updatedBy: M.papa }), {
        freshSince: since,
        meId: M.papa,
      }),
    ).toBe(false);
    expect(
      isFresh(ev({ updatedAt: '2026-09-28T11:00:00+09:00', updatedBy: M.mama }), {
        freshSince: since,
        meId: M.papa,
      }),
    ).toBe(false);
    expect(
      isFresh(ev({ updatedAt: '2026-09-28T13:00:00+09:00' }), { freshSince: null, meId: M.papa }),
    ).toBe(false);
  });

  it('MemberVM は有効な人だけ・自分に isMe', () => {
    const vms = toMemberVMs(
      [...members, { ...members[3], id: 'x', disabled: true } as (typeof members)[number]],
      M.papa,
    );
    expect(vms.map((m) => m.isMe)).toEqual([true, false, false, false]);
  });
});

describe('DayVM と「これから」（S-01）', () => {
  it('終日は各日に span 付きで、時刻ありは開始日だけ・開始時刻順。今日は現在時刻線の位置', () => {
    const events = [
      allDayEv('2026-09-28', '2026-09-30', { title: '出張', memberIds: [M.papa] }),
      ev({ title: '夜', startAt: '2026-09-29T22:00:00+09:00', endAt: '2026-09-30T01:00:00+09:00' }),
      ev({ title: '朝', startAt: '2026-09-29T07:00:00+09:00', endAt: '2026-09-29T07:15:00+09:00' }),
      ev({ title: '昼', startAt: '2026-09-29T12:00:00+09:00' }),
    ];
    const byDay = groupByDay(events, '2026-09-28', '2026-10-01', ctx(), null);
    const today = buildDay('2026-09-29', byDay.get('2026-09-29'), ctx());
    expect(today.allDay.map((a) => a.span)).toEqual(['middle']);
    expect(today.timed.map((t) => t.occ.title)).toEqual(['朝', '昼', '夜']);
    expect(today.timed.map((t) => t.past)).toEqual([true, false, false]);
    expect(today.nowIndex).toBe(1);
    expect(today.ongoingMemberIds).toEqual([M.papa]);
    expect(buildDay('2026-09-30', byDay.get('2026-09-30'), ctx()).timed).toHaveLength(0);
    expect(buildDay('2026-09-28', byDay.get('2026-09-28'), ctx()).allDay[0]?.span).toBe('start');
  });

  it('予定のない日はまとめて 1 行、今日はいつも出し、月の見出しを入れる。祝日の日は出す', () => {
    const events = [ev({ title: 'A', startAt: '2026-10-05T10:00:00+09:00' })];
    const items = buildFlowItems(events, '2026-09-28', '2026-10-13', ctx(), null);
    expect(
      items.map((i) =>
        i.kind === 'day' ? i.day.date : i.kind === 'gap' ? `gap ${i.from}..${i.to}` : i.label,
      ),
    ).toEqual([
      'gap 2026-09-28..2026-09-28',
      '2026年9月',
      '2026-09-29',
      'gap 2026-09-30..2026-10-04',
      '2026年10月',
      '2026-10-05',
      'gap 2026-10-06..2026-10-11',
      '2026-10-12',
    ]);
    const gap = items.find((i) => i.kind === 'gap' && i.from === '2026-09-30');
    expect(gap?.kind === 'gap' && gap.days).toBe(5);
  });

  it('「自分」で絞ると、ほかの人の続いている予定（出張）も出さない。全員の予定は出す', () => {
    const events = [
      allDayEv('2026-09-28', '2026-09-30', { title: '出張', memberIds: [M.papa] }),
      ev({ title: '母の予定', memberIds: [M.mama] }),
      ev({
        title: 'みんな',
        forEveryone: true,
        memberIds: [],
        startAt: '2026-09-29T18:00:00+09:00',
      }),
    ];
    const byDay = groupByDay(events, '2026-09-29', '2026-09-30', ctx({ meId: M.mama }), [M.mama]);
    const day = buildDay('2026-09-29', byDay.get('2026-09-29'), ctx({ meId: M.mama }));
    expect([...day.allDay, ...day.timed].map((x) => x.occ.title)).toEqual(['母の予定', 'みんな']);
    expect(day.ongoingMemberIds).toEqual([]);
  });

  it('今日のまとめ: 今日 n件・全員の予定・留守の人・新しい予定', () => {
    const events = [
      allDayEv('2026-09-28', '2026-09-30', { title: '出張', memberIds: [M.papa] }),
      ev({ title: '夕食', forEveryone: true, memberIds: [], startAt: '2026-09-29T18:00:00+09:00' }),
      ev({ title: '歯医者' }),
    ];
    const byDay = groupByDay(events, '2026-09-29', '2026-09-30', ctx(), null);
    const day = buildDay('2026-09-29', byDay.get('2026-09-29'), ctx());
    expect(buildSummary(day, members, 2)).toEqual([
      '今日 3件',
      '18:00 全員で夕食',
      '父は出張中（〜30日）',
      '新しい予定 2件',
    ]);
    expect(buildSummary(buildDay('2026-10-05', undefined, ctx()), members, 0)).toEqual([
      '今日 0件',
    ]);
  });
});

describe('MonthVM（S-02）', () => {
  it('6 行 × 7 列、日曜始まり・月曜始まり、祝日、2 件と +n、複数日の線は週ごと', () => {
    const events = [
      ev({ title: 'A', startAt: '2026-10-12T09:00:00+09:00' }),
      ev({ title: 'B', startAt: '2026-10-12T10:00:00+09:00' }),
      ev({ title: 'C', startAt: '2026-10-12T11:00:00+09:00', forEveryone: true, memberIds: [] }),
      allDayEv('2026-10-10', '2026-10-12', { title: '旅行', memberIds: [M.papa, M.mama] }),
    ];
    const m = buildMonth(events, 2026, 10, 0, ctx());
    expect(m).toMatchObject({
      label: '2026年10月',
      wafu: '神無月',
      weekdayLabels: ['日', '月', '火', '水', '木', '金', '土'],
    });
    expect(m.weeks).toHaveLength(5);
    expect(m.weeks[0]?.[0]).toMatchObject({ date: '2026-09-27', inMonth: false });
    const cell = m.weeks.flat().find((c) => c.date === '2026-10-12');
    expect(cell).toMatchObject({ holiday: 'スポーツの日', count: 4, more: 2, hasEveryone: true });
    expect(cell?.items.map((i) => i.title)).toEqual(['旅行', 'A']);
    expect(cell?.memberIds).toEqual([M.papa, M.mama, M.yuki, M.haru]);
    expect(
      m.spans.filter((s) => s.title === '旅行').map((s) => [s.week, s.fromCol, s.toCol]),
    ).toEqual([
      [1, 6, 6],
      [2, 0, 1],
    ]);
    const mon = buildMonth(events, 2026, 10, 1, ctx());
    expect(mon.weekdayLabels[0]).toBe('月');
    expect(mon.weeks[0]?.[0]?.date).toBe('2026-09-28');
  });
});

describe('詳細・履歴・ゴミ箱', () => {
  it('他人の非公開は編集できない。日付と時刻のラベル', () => {
    const secret = ev({
      title: null,
      visibility: 'private',
      ownerId: M.yuki,
      createdBy: M.yuki,
      updatedBy: M.yuki,
      memberIds: [M.yuki],
      updatedAt: null,
      createdAt: null,
    });
    const [occ] = occurrencesBetween([secret], '2026-09-29', '2026-09-30');
    const d = buildDetail(occ as NonNullable<typeof occ>, ctx(), members);
    expect(d).toMatchObject({ canEdit: false, createdByName: 'ゆき', updatedLabel: '' });
    const own = ev({
      title: '会議',
      startAt: '2026-10-03T07:00:00+09:00',
      endAt: '2026-10-03T15:00:00+09:00',
      updatedAt: '2026-09-25T21:04:00+09:00',
    });
    const [o2] = occurrencesBetween([own], '2026-10-03', '2026-10-04');
    expect(buildDetail(o2 as NonNullable<typeof o2>, ctx(), members)).toMatchObject({
      canEdit: true,
      dateLabel: '10月3日 土曜日',
      timeLabel: '07:00 — 15:00',
      updatedLabel: '更新 お母さん · 9/25 21:04',
    });
    expect(detailDateLabel('2026-10-10', '2026-10-12', true)).toBe('10月10日(土) – 12日(月)');
    expect(detailDateLabel('2026-10-31', '2026-11-02', true)).toBe('10月31日(土) – 11月2日(月)');
    expect(detailTimeLabel(false, '2026-10-01', '22:00', '2026-10-02', '01:00')).toBe(
      '22:00 — 翌01:00',
    );
    expect(longDateLabel('2026-09-27')).toBe('9月27日 日曜日');
  });

  it('履歴のラベル（今日・昨日・n分前）', () => {
    const now = fromJst('2026-09-29', '10:00');
    const vms = buildActivity(
      [
        {
          id: 'a',
          actorId: M.mama,
          action: 'update',
          eventId: 'e',
          title: 'x',
          detail: '開始 8:00 → 7:00',
          createdAt: '2026-09-29T09:57:00+09:00',
          unread: true,
        },
        {
          id: 'b',
          actorId: M.mama,
          action: 'create',
          eventId: 'e',
          title: 'x',
          detail: null,
          createdAt: '2026-09-28T21:40:00+09:00',
          unread: false,
        },
      ],
      now,
    );
    expect(vms.map((v) => [v.dayLabel, v.atLabel])).toEqual([
      ['今日', '3分前'],
      ['昨日', '21:40'],
    ]);
  });

  it('ゴミ箱の残り日数と削除した人', () => {
    const now = fromJst('2026-09-29', '10:00');
    const vms = buildTrash(
      [
        {
          event: ev({ title: '買い物', startAt: '2026-09-25T18:00:00+09:00' }),
          deletedAt: '2026-09-26T12:00:00+09:00',
          deletedBy: M.yuki,
        },
      ],
      members,
      now,
    );
    expect(vms[0]).toMatchObject({
      title: '買い物',
      whenLabel: '9/25(金) 18:00',
      deletedByName: 'ゆき',
      deletedLabel: '9/26 に削除',
      daysLeft: 27,
    });
  });
});

describe('入力の下書き（S-05）', () => {
  it('時刻ありの下書き → 本文（終わりが始まりより前の時刻なら翌日）', () => {
    const d = { ...emptyDraft('2026-10-01', M.papa, '22:00'), title: '夜釣り', endTime: '01:00' };
    expect(draftToInput(d)).toMatchObject({
      allDay: false,
      startAt: '2026-10-01T22:00:00+09:00',
      endAt: '2026-10-02T01:00:00+09:00',
      memberIds: [M.papa],
    });
  });

  it('終日・全員・内緒の下書き', () => {
    const d = {
      ...emptyDraft('2026-10-10', M.papa),
      title: '旅行',
      endDate: '2026-10-12',
      forEveryone: true,
    };
    expect(draftToInput(d)).toMatchObject({
      allDay: true,
      startDate: '2026-10-10',
      endDate: '2026-10-12',
      forEveryone: true,
      memberIds: [],
    });
    const p = { ...emptyDraft('2026-10-10', M.papa), title: '内緒', isPrivate: true };
    expect(draftToInput(p)).toMatchObject({
      visibility: 'private',
      forEveryone: false,
      memberIds: [M.papa],
    });
  });

  it('予定 → 下書き → 本文で元に戻る', () => {
    const e = ev({
      title: '会議',
      startAt: '2026-10-03T07:00:00+09:00',
      endAt: '2026-10-03T15:00:00+09:00',
      location: '駅前',
    });
    const input = draftToInput(eventToDraft(e));
    expect(input).toMatchObject({
      title: '会議',
      startAt: e.startAt,
      endAt: e.endAt,
      location: '駅前',
    });
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
  });
});
