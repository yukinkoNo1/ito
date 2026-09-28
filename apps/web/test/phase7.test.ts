import { fromJst } from '@ito/core';
import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../src/data/api';
import { downloadExport, fileNameOf } from '../src/pwa/export';
import { buildFreeTimeVM } from '../src/viewmodels/free';
import type { VmContext } from '../src/viewmodels/occurrence';
import { rememberQuery, searchOccurrences, searchTerms } from '../src/viewmodels/search';
import { ev, M, members } from './fixtures';

/** Phase 7（空き時間・検索・書き出し）の PWA 側 */

const ctx: VmContext = {
  nowMs: fromJst('2026-09-28', '09:00'),
  today: '2026-09-28',
  meId: M.papa,
  members,
  freshSince: null,
};

describe('検索（§6 S-10）', () => {
  const dentist = ev({
    title: '歯医者',
    location: '駅前歯科',
    startAt: '2026-10-03T19:00:00+09:00',
    memberIds: [M.papa],
    ownerId: M.papa,
  });
  const pastDentist = ev({
    title: '歯医者（定期）',
    startAt: '2026-09-01T10:00:00+09:00',
    memberIds: [M.mama],
    ownerId: M.mama,
  });
  const note = ev({
    title: '買い物',
    note: 'ＡＢＣストアで牛乳',
    startAt: '2026-10-05T10:00:00+09:00',
    memberIds: [M.mama],
    ownerId: M.mama,
  });
  const othersPrivate = ev({
    title: null,
    visibility: 'private',
    startAt: '2026-10-04T10:00:00+09:00',
    memberIds: [M.haru],
    ownerId: M.haru,
  });
  const weekly = ev({
    title: 'ピアノ',
    startAt: '2026-09-07T17:00:00+09:00',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    memberIds: [M.yuki],
    ownerId: M.yuki,
  });
  const events = [dentist, pastDentist, note, othersPrivate, weekly];

  it('件名・場所・メモの部分一致（全角半角・大文字小文字を区別しない、空白は AND）', () => {
    expect(
      searchOccurrences(events, '駅前', null, ctx).flatMap((g) => g.items.map((i) => i.title)),
    ).toEqual(['歯医者']);
    expect(
      searchOccurrences(events, 'abc 牛乳', null, ctx).flatMap((g) => g.items.map((i) => i.title)),
    ).toEqual(['買い物']);
    expect(searchOccurrences(events, '  ', null, ctx)).toEqual([]);
    expect(searchTerms(' Ａ　ｂ ')).toEqual(['a', 'b']);
  });

  it('これからの回を近い順に、そのあとに過ぎた回を新しい順に。日付で見出しを付ける', () => {
    const groups = searchOccurrences(events, '歯医者', null, ctx);
    expect(groups.map((g) => [g.dateLabel, g.items.map((i) => i.title)])).toEqual([
      ['10月3日(土)', ['歯医者']],
      ['9月1日(火)', ['歯医者（定期）']],
    ]);
  });

  it('繰り返しはシリーズごとに 1 回（これからの最初の回）', () => {
    const groups = searchOccurrences(events, 'ピアノ', null, ctx);
    expect(groups.map((g) => [g.dateLabel, g.items.map((i) => i.key)])).toEqual([
      ['9月28日(月)', [`${weekly.id}@2026-09-28T17:00`]],
    ]);
  });

  it('他人の非公開は探さない（「予定あり」も出さない）', () => {
    for (const q of ['予定あり', '予定', '']) {
      const all = searchOccurrences(events, q || ' ', null, ctx).flatMap((g) => g.items);
      expect(all.some((i) => i.eventId === othersPrivate.id)).toBe(false);
    }
  });

  it('人で絞り込む（全員の予定は含む）', () => {
    const groups = searchOccurrences(events, '歯医者', [M.mama], ctx);
    expect(groups.flatMap((g) => g.items.map((i) => i.title))).toEqual(['歯医者（定期）']);
  });

  it('最近の検索語は新しい順に 5 つまで（同じ語は前へ）', () => {
    let list: string[] = [];
    for (const q of ['a', 'b', 'c', 'd', 'e', 'f', 'c', ' ']) list = rememberQuery(list, q);
    expect(list).toEqual(['c', 'f', 'e', 'd', 'b']);
  });
});

describe('空き時間の VM（§22 FreeTimeVM）', () => {
  it('今日から 7 日、夜の候補と時間軸。他人の非公開は中身なし', () => {
    const vm = buildFreeTimeVM({
      events: [
        ev({
          title: null,
          visibility: 'private',
          startAt: '2026-09-28T18:00:00+09:00',
          endAt: '2026-09-28T20:00:00+09:00',
          memberIds: [M.mama],
          ownerId: M.mama,
        }),
      ],
      start: '2026-09-28',
      preset: 'evenings',
      minDuration: 120,
      memberIds: [M.papa, M.mama],
      ctx,
    });
    expect(vm.rangeLabel).toBe('9/28(月) – 10/4(日)');
    expect([vm.dayStartMin, vm.dayEndMin]).toEqual([17 * 60, 24 * 60]);
    expect(vm.days[0]?.busy).toEqual([
      { memberId: M.mama, startMin: 18 * 60, endMin: 20 * 60, label: null },
    ]);
    expect(vm.candidates[0]).toEqual({
      date: '2026-09-28',
      label: '9/28(月) 20:00–24:00',
      startMin: 20 * 60,
      endMin: 24 * 60,
    });
    expect(vm.candidates).toHaveLength(5);
  });
});

describe('書き出し（§17）', () => {
  it('ファイル名は Content-Disposition から（形が違えば ito.<形式>）', () => {
    expect(fileNameOf('attachment; filename="ito-20260927.ics"', 'ics')).toBe('ito-20260927.ics');
    expect(fileNameOf('attachment; filename="../../x"', 'json')).toBe('ito.json');
    expect(fileNameOf(null, 'json')).toBe('ito.json');
  });

  function fetcherFor(status: number, headers: Record<string, string> = {}) {
    const calls: { path: string; init: RequestInit }[] = [];
    const fetcher: Fetcher = async (path, init) => {
      calls.push({ path, init });
      return new Response('BEGIN:VCALENDAR', { status, headers });
    };
    return { calls, fetcher };
  }

  it('fetch で取り（X-Ito-Client 付き）、<a download> で保存する', async () => {
    const { calls, fetcher } = fetcherFor(200, {
      'content-disposition': 'attachment; filename="ito-20260927.ics"',
    });
    const saved: { name: string; type: string }[] = [];
    const r = await downloadExport('ics', {
      fetcher,
      platform: 'other',
      save: (blob, name) => saved.push({ name, type: blob.type }),
    });
    expect(r).toBe('saved');
    expect(calls[0]?.path).toBe('/api/export?format=ics');
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers['X-Ito-Client']).toBe('1');
    expect(saved).toEqual([{ name: 'ito-20260927.ics', type: 'text/calendar' }]);
  });

  it('iPhone は共有シートで渡す（閉じたら cancelled）。つながらなければ offline、4xx は failed', async () => {
    const shared: string[] = [];
    const ok = await downloadExport('json', {
      fetcher: fetcherFor(200, { 'content-disposition': 'attachment; filename="ito-1.json"' })
        .fetcher,
      platform: 'ios',
      canShare: () => true,
      share: async (d) => {
        shared.push(d.files[0]?.name ?? '');
      },
      save: () => {
        throw new Error('保存しない');
      },
    });
    expect(ok).toBe('shared');
    expect(shared).toEqual(['ito-1.json']);
    const cancelled = await downloadExport('json', {
      fetcher: fetcherFor(200).fetcher,
      platform: 'ios',
      canShare: () => true,
      share: async () => {
        throw new DOMException('closed', 'AbortError');
      },
    });
    expect(cancelled).toBe('cancelled');
    const offline = await downloadExport('json', {
      fetcher: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(offline).toBe('offline');
    expect(await downloadExport('json', { fetcher: fetcherFor(403).fetcher })).toBe('failed');
  });
});
