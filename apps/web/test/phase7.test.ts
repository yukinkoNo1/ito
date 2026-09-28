import { addDays, fromJst } from '@ito/core';
import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../src/data/api';
import { downloadExport, fileNameOf } from '../src/pwa/export';
import { isDeniedNavigation } from '../src/pwa/nav-denylist';
import { splitLinks } from '../src/ui/labels';
import { MOCK_TODAY, mockContext, mockEvents } from '../src/ui/mock';
import { buildFreeTimeVM } from '../src/viewmodels/free';
import type { VmContext } from '../src/viewmodels/occurrence';
import {
  buildFlowScreen,
  countFlowFresh,
  extendFlowRange,
  FLOW_FUTURE_LIMIT,
  FLOW_PAST_LIMIT,
  FLOW_WINDOW_DAYS,
  keepSame,
  MAX_FLOW_DAYS,
  reuseSame,
  sameData,
  sortMembersKeepingSame,
} from '../src/viewmodels/screens';
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
  // 他人の非公開（手元に古い中身が残っていても探さない。投影の前の行が残った場合も守る）
  const othersPrivate = ev({
    title: '秘密の歯医者',
    note: 'ひみつのメモ',
    visibility: 'private',
    startAt: '2026-10-04T10:00:00+09:00',
    memberIds: [M.haru],
    ownerId: M.haru,
  });
  const everyone = ev({
    title: '歯医者の送迎（全員）',
    startAt: '2026-10-06T10:00:00+09:00',
    memberIds: [],
    forEveryone: true,
  });
  const weekly = ev({
    title: 'ピアノ',
    startAt: '2026-09-07T17:00:00+09:00',
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    memberIds: [M.yuki],
    ownerId: M.yuki,
  });
  const events = [dentist, pastDentist, note, othersPrivate, weekly, everyone];

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
      ['10月6日(火)', ['歯医者の送迎（全員）']],
      ['9月1日(火)', ['歯医者（定期）']],
    ]);
  });

  it('繰り返しはシリーズごとに 1 回（これからの最初の回）', () => {
    const groups = searchOccurrences(events, 'ピアノ', null, ctx);
    expect(groups.map((g) => [g.dateLabel, g.items.map((i) => i.key)])).toEqual([
      ['9月28日(月)', [`${weekly.id}@2026-09-28T17:00`]],
    ]);
  });

  it('他人の非公開は探さない（件名・メモが手元に残っていても。「予定あり」も出さない）', () => {
    for (const q of ['秘密', 'ひみつのメモ', '歯医者', '予定あり']) {
      const all = searchOccurrences(events, q, null, ctx).flatMap((g) => g.items);
      expect(all.some((i) => i.eventId === othersPrivate.id)).toBe(false);
    }
  });

  it('昨日の終日・昨日 24:00 に終わった予定は過ぎた回（これからの回を先に）', () => {
    const yesterday = ev({
      title: '運動会',
      allDay: true,
      startAt: undefined,
      endAt: undefined,
      startDate: '2026-09-27',
      endDate: '2026-09-27',
    });
    const cleanup = ev({ title: '運動会の片付け', startAt: '2026-10-03T10:00:00+09:00' });
    const lateNight = ev({
      title: '運動会の打ち上げ',
      startAt: '2026-09-27T23:00:00+09:00',
      endAt: '2026-09-28T00:00:00+09:00',
    });
    const groups = searchOccurrences([yesterday, cleanup, lateNight], '運動会', null, ctx);
    expect(groups.flatMap((g) => g.items.map((i) => i.title))).toEqual([
      '運動会の片付け',
      '運動会の打ち上げ',
      '運動会',
    ]);
    // 毎日の終日のシリーズは今日の回
    const daily = ev({
      title: '当番',
      allDay: true,
      startAt: undefined,
      endAt: undefined,
      startDate: '2026-09-20',
      endDate: '2026-09-20',
      rrule: 'FREQ=DAILY',
    });
    expect(searchOccurrences([daily], '当番', null, ctx)[0]?.items[0]?.key).toBe(
      `${daily.id}@2026-09-28`,
    );
  });

  it('人の絞り込みは回ごとに当てる（「この回だけ」別の人にした回があっても、シリーズのほかの回で出す）', () => {
    const piano = ev({
      title: 'ピアノ',
      startAt: '2026-09-21T17:00:00+09:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      memberIds: [M.yuki],
      ownerId: M.yuki,
    });
    const moved = ev({
      title: 'ピアノ',
      startAt: '2026-09-28T17:00:00+09:00',
      parentId: piano.id,
      recurrenceId: '2026-09-28T17:00',
      memberIds: [M.mama],
      ownerId: M.yuki,
    });
    const keys = (filter: string[] | null) =>
      searchOccurrences([piano, moved], 'ピアノ', filter, ctx).flatMap((g) =>
        g.items.map((i) => i.key),
      );
    expect(keys([M.yuki])).toEqual([`${piano.id}@2026-10-05T17:00`]);
    expect(keys([M.mama])).toEqual([`${piano.id}@2026-09-28T17:00`]);
  });

  it('人で絞り込む（全員の予定は含む）', () => {
    const groups = searchOccurrences(events, '歯医者', [M.mama], ctx);
    expect(groups.flatMap((g) => g.items.map((i) => i.title))).toEqual([
      '歯医者の送迎（全員）',
      '歯医者（定期）',
    ]);
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

describe('メモのリンク（§18 T4）', () => {
  it('http(s) だけをリンクにし、ほかの形（javascript:・data:・ftp:）は文字のまま。文末の句読点は含めない', () => {
    const parts = splitLinks(
      '地図 https://example.com/a?b=1。 予約 http://example.jp/x、 危ない javascript:alert(1) data:text/html,x ftp://example.com/f',
    );
    const links = parts.filter((p) => p.href).map((p) => p.href);
    expect(links).toEqual(['https://example.com/a?b=1', 'http://example.jp/x']);
    const text = parts.map((p) => p.text).join('');
    expect(text).toContain('javascript:alert(1)');
    expect(text).toContain('data:text/html,x');
    expect(parts.find((p) => p.href === 'https://example.com/a?b=1')?.text).toBe(
      'https://example.com/a?b=1',
    );
    // 句読点はリンクの外
    expect(parts.some((p) => p.href === null && p.text.startsWith('。'))).toBe(true);
  });

  it('リンクでない文だけなら、そのまま 1 つ', () => {
    expect(splitLinks('ただのメモ')).toEqual([{ text: 'ただのメモ', href: null, at: 0 }]);
  });
});

describe('これからの一覧の範囲（§19。§24 D38）', () => {
  const today = '2026-09-28';
  it('端までスクロールして足したら、140 日を超えた反対側を削る', () => {
    let r = { from: '2026-09-27', to: '2026-11-23' };
    for (let i = 0; i < 5; i++) r = extendFlowRange(r, 'end', true, today);
    expect(r.to).toBe(addDays('2026-11-23', 5 * 28));
    expect(r.from).toBe(addDays(r.to, -MAX_FLOW_DAYS));
    expect((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000).toBe(MAX_FLOW_DAYS);
    let back = { from: '2026-09-27', to: '2026-11-23' };
    for (let i = 0; i < 5; i++) back = extendFlowRange(back, 'start', true, today);
    expect((Date.parse(back.to) - Date.parse(back.from)) / 86_400_000).toBe(MAX_FLOW_DAYS);
  });

  it('スクロールではなく（一覧が画面に収まっているときのタップで）足したときは削らない。今日の日は消えない', () => {
    let r = { from: '2026-09-27', to: '2026-11-23' };
    for (let i = 0; i < 6; i++) r = extendFlowRange(r, 'end', false, today);
    expect(r.from).toBe('2026-09-27');
  });

  it('上限の近くへ移動した範囲で端まで行っても、見ている側の端を内へ動かさない（見ている日を消さない。レビュー 2 回目 D10）', () => {
    const future = addDays(today, FLOW_FUTURE_LIMIT);
    const nearFuture = { from: addDays(future, -56), to: addDays(future, 56) };
    for (const byScroll of [true, false]) {
      const r = extendFlowRange(nearFuture, 'end', byScroll, today);
      expect(r.to >= nearFuture.to).toBe(true);
      expect(r.from <= future && future < r.to).toBe(true);
    }
    const past = addDays(today, FLOW_PAST_LIMIT + 5);
    const nearPast = { from: addDays(past, -56), to: addDays(past, 56) };
    for (const byScroll of [true, false]) {
      const r = extendFlowRange(nearPast, 'start', byScroll, today);
      expect(r.from <= nearPast.from).toBe(true);
      expect(r.from <= past && past < r.to).toBe(true);
    }
  });

  it('足せるのは今日から過去 1 年・未来 3 年まで', () => {
    const limit = addDays(today, 366 * 3);
    const r = extendFlowRange({ from: '2026-09-27', to: addDays(limit, -2) }, 'end', false, today);
    expect(r.to).toBe(limit);
    expect(extendFlowRange(r, 'end', false, today).to).toBe(limit);
  });
});

describe('SW のページ遷移の除外（§17・§18 T3。総点検 A5）', () => {
  it('/api・/healthz はクエリ付き・/api ちょうど・エンコードした形も index.html にしない', () => {
    for (const path of [
      '/api/export?format=json',
      '/api',
      '/api?x=1',
      '/API/export',
      '/%61pi/export?format=json',
      '/api%2Fexport',
      '/healthz',
      '/healthz?probe=1',
    ]) {
      expect([path, isDeniedNavigation(new URL(path, 'https://ito.example.ts.net'))]).toEqual([
        path,
        true,
      ]);
    }
  });

  it('アプリの画面への遷移は index.html を返す（クエリに % があってもよい）', () => {
    for (const path of [
      '/',
      '/month/2026-10',
      '/day/2026-10-01',
      '/search?q=%E3%81%82',
      '/apiary',
      '/healthzz',
    ]) {
      expect([path, isDeniedNavigation(new URL(path, 'https://ito.example.ts.net'))]).toEqual([
        path,
        false,
      ]);
    }
  });
});

describe('これからの一覧の描き直しを小さくする（§19。§24 D40）', () => {
  const flowAt = (
    from: string,
    to: string,
    extra: Partial<Parameters<typeof buildFlowScreen>[0]> = {},
  ) =>
    buildFlowScreen({
      events: mockEvents(),
      ctx: mockContext(),
      filter: null,
      from,
      to,
      selectedDate: MOCK_TODAY,
      weekStart: 0,
      unreadActivity: 0,
      notice: null,
      showBackToToday: false,
      ...extra,
    });

  it('同じ入力で作り直した行は中身が同じ（使い回せる）。範囲を足したときは重なる日をそのまま使う', () => {
    const from = addDays(MOCK_TODAY, -1);
    const first = flowAt(from, addDays(MOCK_TODAY, FLOW_WINDOW_DAYS));
    const again = flowAt(from, addDays(MOCK_TODAY, FLOW_WINDOW_DAYS));
    const reused = reuseSame(first.items, again.items);
    expect(reused.every((item, i) => item === first.items[i])).toBe(true);
    // 4 週足した一覧: 前からある日は前のオブジェクト、新しい日だけ新しい
    const longer = flowAt(from, addDays(MOCK_TODAY, FLOW_WINDOW_DAYS + 28));
    const merged = reuseSame(first.items, longer.items);
    const old = new Set(first.items);
    const kept = merged.filter((item) => old.has(item));
    expect(kept.length).toBeGreaterThan(0);
    for (const item of merged) {
      const before = first.items.find((x) => x.key === item.key);
      if (before && sameData(before, item)) expect(item).toBe(before);
    }
    expect(merged.map((i) => i.key)).toEqual(longer.items.map((i) => i.key));
  });

  it('sortMembersKeepingSame: 家族の一覧は作った順に並べ、同期で同じ中身を書き直しても前の配列を使う（useMembers。レビュー 2 回目 D8・3 回目 E4）', () => {
    const a = {
      id: 'a',
      createdAt: '2026-01-01T00:00:00+09:00',
      name: 'お父さん',
      aliases: ['パパ'],
    };
    const b = {
      id: 'b',
      createdAt: '2026-02-01T00:00:00+09:00',
      name: 'お母さん',
      aliases: [] as string[],
    };
    const first = sortMembersKeepingSame(null, [b, a]);
    expect(first.map((m) => m.id)).toEqual(['a', 'b']);
    // 同期で消して書き直した（別のオブジェクト・並びも違う）が中身は同じ
    expect(sortMembersKeepingSame(first, [structuredClone(b), structuredClone(a)])).toBe(first);
    const renamed = sortMembersKeepingSame(first, [{ ...a, name: 'パパ' }, structuredClone(b)]);
    expect(renamed).not.toBe(first);
    expect(renamed[0]?.name).toBe('パパ');
  });

  it('keepSame: 同期で同じ中身を書き直しても前の配列を使う（家族の一覧。レビュー 2 回目 D8）', () => {
    const prev = [{ id: 'a', name: 'お父さん', aliases: ['パパ'] }];
    expect(keepSame(prev, [{ id: 'a', name: 'お父さん', aliases: ['パパ'] }])).toBe(prev);
    const changed = [{ id: 'a', name: 'お父さん', aliases: ['父'] }];
    expect(keepSame(prev, changed)).toBe(changed);
    expect(keepSame(null, changed)).toBe(changed);
  });

  it('中身が変わった行は新しいオブジェクト（古い行を出し続けない）', () => {
    const from = addDays(MOCK_TODAY, -1);
    const to = addDays(MOCK_TODAY, FLOW_WINDOW_DAYS);
    const first = flowAt(from, to);
    const renamed = mockEvents().map((e, i) =>
      i === 0 ? { ...e, title: `${e.title}（変更）` } : e,
    );
    const next = flowAt(from, to, { events: renamed });
    const merged = reuseSame(first.items, next.items);
    const changed = merged.filter((item, i) => item !== first.items[i]);
    expect(changed.length).toBeGreaterThan(0);
    for (const item of changed) expect(JSON.stringify(item)).toContain('（変更）');
    expect(sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameData({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('「新しい予定 n件」は範囲と別に数えても、描く範囲に関係なく同じ数', () => {
    const fresh = mockContext({ freshSince: 0 });
    const events = mockEvents();
    const expected = countFlowFresh(events, fresh, null);
    expect(expected).toBeGreaterThan(0);
    const near = flowAt(addDays(MOCK_TODAY, -1), addDays(MOCK_TODAY, FLOW_WINDOW_DAYS), {
      ctx: fresh,
    });
    const far = flowAt(addDays(MOCK_TODAY, 200), addDays(MOCK_TODAY, 340), { ctx: fresh });
    const given = flowAt(addDays(MOCK_TODAY, 200), addDays(MOCK_TODAY, 340), {
      ctx: fresh,
      freshCount: expected,
    });
    expect([near.freshCount, far.freshCount, given.freshCount]).toEqual([
      expected,
      expected,
      expected,
    ]);
  });
});
