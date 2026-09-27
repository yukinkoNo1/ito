import 'fake-indexeddb/auto';
import {
  createLocally,
  type EventDTO,
  eventCreateSchema,
  fakeClock,
  fromJst,
  type MeDTO,
  memberSettingsSchema,
} from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expandDirect,
  RECURRING_BODIES,
  RECURRING_WINDOW,
} from '../../../packages/core/test/fixtures/recurring';
import type { Fetcher } from '../src/data/api';
import { ItoDb, type LocalEvent } from '../src/data/db';
import { DataStore } from '../src/data/store';
import { monthEndQuestion } from '../src/viewmodels/composer-vm';
import { draftToInput, emptyDraft, eventToDraft } from '../src/viewmodels/detail';
import { groupByDay } from '../src/viewmodels/flow';
import {
  lostCounts,
  occurrenceChanges,
  occurrenceEvent,
  thisScopeBlock,
} from '../src/viewmodels/series';
import { ctx, ev, M, members } from './fixtures';

/** Phase 3（繰り返し）の PWA 側 */

describe('3 通りの展開（PWA の viewmodel 経由）', () => {
  it('これから・月が使う日ごとの振り分けが、core を直接展開したものと同じ回を出す', () => {
    const events: LocalEvent[] = RECURRING_BODIES.map((body) => {
      const input = eventCreateSchema.parse(body);
      const made = createLocally(input, input.id as string, M.papa, fromJst('2026-09-27'));
      if (!('value' in made)) throw new Error('作れない');
      return { ...made.value, sync: 'synced' as const };
    });
    const byDay = groupByDay(events, RECURRING_WINDOW.from, RECURRING_WINDOW.to, ctx(), null);
    const got = new Set<string>();
    for (const day of byDay.values()) {
      for (const x of [...day.allDay, ...day.timed]) {
        const o = x.occ;
        got.add(
          `${o.key} ${o.startDate}${o.startTime ? ` ${o.startTime}` : ''} → ${o.endDate}${o.endTime ? ` ${o.endTime}` : ''}`,
        );
      }
    }
    // 前月から続く回（夜勤の 9/18〜）は除いて比べる（直接の展開は 10/1 から）
    expect([...got].sort()).toEqual([...expandDirect(M.papa)].sort());
  });

  it('繰り返しの説明が行に出る（§11 describe）', () => {
    const [body] = RECURRING_BODIES;
    const input = eventCreateSchema.parse(body);
    const made = createLocally(input, input.id as string, M.papa, fromJst('2026-09-27'));
    if (!('value' in made)) throw new Error('作れない');
    const byDay = groupByDay(
      [{ ...made.value, sync: 'synced' }],
      '2026-10-01',
      '2026-10-02',
      ctx(),
      null,
    );
    expect(byDay.get('2026-10-01')?.timed[0]?.occ.recurrenceLabel).toBe('毎週 月・木');
  });
});

describe('書く画面の繰り返し（§22 RecurrenceVM ⇔ RRULE）', () => {
  it('下書きの繰り返しを rrule にし、予定から下書きに戻す', () => {
    const draft = {
      ...emptyDraft('2026-10-05', M.papa, '07:30'),
      title: 'ゴミ出し',
      recurrence: {
        kind: 'weekly' as const,
        interval: 1,
        weekdays: [1, 4] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[],
      },
      recurrenceEnd: { kind: 'until' as const, date: '2026-12-31' },
    };
    const input = draftToInput(draft);
    expect(input.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261231T235959');
    const e = ev({ ...input, rrule: input.rrule, title: 'ゴミ出し' } as Partial<EventDTO>);
    const back = eventToDraft(e);
    expect(back.recurrence).toEqual({ kind: 'weekly', interval: 1, weekdays: [1, 4] });
    expect(back.recurrenceEnd).toEqual({ kind: 'until', date: '2026-12-31' });
    // カスタム（UI で作れない形）は今の rrule のまま（本文に入れない）
    expect('rrule' in draftToInput({ ...draft, recurrence: { kind: 'custom', label: 'x' } })).toBe(
      false,
    );
    // 繰り返しなしは null（繰り返しをやめる）
    expect(draftToInput({ ...draft, recurrence: { kind: 'none' } }).rrule).toBeNull();
  });
});

describe('毎月 29〜31 日（§11「月末にしますか？」）', () => {
  it('29〜31 日の毎月なら聞き、月末（-1）を選べる', () => {
    const d = emptyDraft('2026-10-31', M.papa);
    expect(
      monthEndQuestion({ ...d, recurrence: { kind: 'monthlyByDate', day: 15 } }, null),
    ).toBeNull();
    const q = monthEndQuestion({ ...d, recurrence: { kind: 'monthlyByDate', day: 31 } }, null);
    expect(q?.question).toContain('月末にしますか');
    expect(q?.options[1]?.patch).toEqual({ recurrence: { kind: 'monthlyByDate', day: -1 } });
    expect(
      monthEndQuestion({ ...d, recurrence: { kind: 'monthlyByDate', day: 30 } }, 0)?.chosen,
    ).toBe(0);
  });
});

describe('範囲（C-04）の計算', () => {
  const master = ev({
    title: 'ヨガ',
    startAt: '2026-10-01T07:00:00+09:00',
    endAt: '2026-10-01T08:00:00+09:00',
    rrule: 'FREQ=WEEKLY;BYDAY=TH',
    exdates: ['2026-10-08T07:00', '2026-10-29T07:00'],
  });
  const exception = ev({
    title: 'ヨガ（別の先生）',
    startAt: '2026-10-22T07:00:00+09:00',
    parentId: master.id,
    recurrenceId: '2026-10-22T07:00',
  });

  it('消える件数: これ以降はその回以降、すべては開始が変わるとき全部・規則だけならその規則で回でなくなるもの、削除のすべては 0', () => {
    // 件名だけ: 何も消えない
    expect(
      lostCounts(master, [exception], '2026-10-15T07:00', {
        action: 'edit',
        changes: { title: 'x' },
      }),
    ).toEqual({ following: 2, all: 0 });
    // 時刻を変える: すべて消える（取り消し 2 件＋例外 1 件）
    expect(
      lostCounts(master, [exception], '2026-10-15T07:00', {
        action: 'edit',
        changes: { startAt: '2026-10-15T08:00:00+09:00', endAt: '2026-10-15T09:00:00+09:00' },
      }),
    ).toEqual({ following: 2, all: 3 });
    // 終わりの回数だけ変える（レビュー P3-web-02・P3-server-03）: 回数 4（10/1〜10/22）で残らない 10/29 だけ
    expect(
      lostCounts(master, [exception], '2026-10-15T07:00', {
        action: 'edit',
        changes: { rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=4' },
      }).all,
    ).toBe(1);
    expect(lostCounts(master, [exception], '2026-10-15T07:00', { action: 'delete' }).all).toBe(0);
  });

  it('最初の回の「これ以降」は「すべて」と同じ件数。削除ならシリーズごとゴミ箱なので 0（レビュー P3-web-12）', () => {
    expect(
      lostCounts(master, [exception], '2026-10-01T07:00', {
        action: 'edit',
        changes: { title: 'x' },
      }),
    ).toEqual({ following: 0, all: 0 });
    expect(
      lostCounts(master, [exception], '2026-10-01T07:00', {
        action: 'edit',
        changes: { startAt: '2026-10-01T08:00:00+09:00', endAt: '2026-10-01T09:00:00+09:00' },
      }),
    ).toEqual({ following: 3, all: 3 });
    expect(lostCounts(master, [exception], '2026-10-01T07:00', { action: 'delete' })).toEqual({
      following: 0,
      all: 0,
    });
  });

  it('回の今の中身（例外行があればそれ、なければ親をその回に）', () => {
    expect(occurrenceEvent(master, [exception], '2026-10-22T07:00')?.title).toBe(
      'ヨガ（別の先生）',
    );
    const synth = occurrenceEvent(master, [exception], '2026-10-15T07:00');
    expect(synth).toMatchObject({
      startAt: '2026-10-15T07:00:00+09:00',
      endAt: '2026-10-15T08:00:00+09:00',
      rrule: null,
    });
    expect(occurrenceEvent(master, [], '2026-10-16T07:00')).toBeNull();
  });

  it('送る変更は回の今の中身との差分だけ: 例外で動かした回から件名だけ直しても日時を送らない（レビュー P3-web-03・P3-core-02）', () => {
    const moved = ev({
      ...exception,
      startAt: '2026-10-22T09:00:00+09:00',
      endAt: '2026-10-22T10:00:00+09:00',
    });
    // 書く画面の下書きは、回の中身に親の繰り返しを付けたもの
    const whole = {
      ...draftToInput(eventToDraft(moved)),
      rrule: master.rrule,
      title: 'ヨガ（新）',
    };
    for (const scope of ['this', 'following', 'all'] as const) {
      expect(occurrenceChanges(master, moved, whole, scope)).toEqual({
        ok: true,
        changes: { title: 'ヨガ（新）' },
      });
    }
    // 時刻を変えたら入る
    const later = {
      ...whole,
      startAt: '2026-10-22T10:00:00+09:00',
      endAt: '2026-10-22T11:00:00+09:00',
    };
    const r = occurrenceChanges(master, moved, later, 'all');
    expect(r.ok && r.changes.startAt).toBe('2026-10-22T10:00:00+09:00');
  });

  it('繰り返しは、書き方が違っても同じ規則なら送らない。この回だけでは送らない（レビュー P3-core-05）', () => {
    const base = occurrenceEvent(master, [], '2026-10-15T07:00');
    if (!base) throw new Error('回がない');
    const input = {
      title: 'ヨガ',
      allDay: false,
      startAt: base.startAt ?? null,
      rrule: 'FREQ=WEEKLY',
    };
    const same = occurrenceChanges(master, base, input, 'all');
    expect(same.ok && 'rrule' in same.changes).toBe(false);
    const fr = occurrenceChanges(
      master,
      base,
      { ...input, rrule: 'FREQ=WEEKLY;BYDAY=FR' },
      'following',
    );
    expect(fr.ok && fr.changes.rrule).toBe('FREQ=WEEKLY;BYDAY=FR');
    const only = occurrenceChanges(
      master,
      base,
      { ...input, rrule: 'FREQ=WEEKLY;BYDAY=FR' },
      'this',
    );
    expect(only.ok && 'rrule' in only.changes).toBe(false);
  });

  it('「この予定だけ」を選べない理由: 公開・非公開、繰り返しの変更（レビュー P3-web-04・P3-web-11）', () => {
    expect(thisScopeBlock(master, { title: 'x' })).toBeNull();
    expect(thisScopeBlock(master, { visibility: 'private' })).toContain('公開・非公開');
    expect(thisScopeBlock(master, { rrule: 'FREQ=WEEKLY;BYDAY=FR' })).toContain('繰り返し');
    expect(thisScopeBlock(master, { rrule: 'FREQ=WEEKLY;BYDAY=TH' })).toBeNull();
  });
});

/* ───────── 送信待ち（DataStore） ───────── */

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
type Reply = { status: number; body?: unknown } | 'network';

const me: MeDTO = {
  id: M.papa,
  name: 'お父さん',
  mark: '父',
  color: 'kaki',
  role: 'admin',
  aliases: [],
  settings: memberSettingsSchema.parse({}),
  activityReadAt: null,
};

let db: ItoDb;
let seq = 0;
const clock = fakeClock(fromJst('2026-09-29', '07:30'));
beforeEach(async () => {
  seq++;
  db = new ItoDb(`phase3-${seq}`);
  await db.setMeta('me', me);
  await db.members.bulkPut(members);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

function storeWith(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (path, init) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const call = {
      method: init.method ?? 'GET',
      path,
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    if (r === 'network') throw new TypeError('Failed to fetch');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  const store = new DataStore(db, clock, fetcher);
  const realSync = store.syncNow.bind(store);
  store.syncNow = async () => {};
  return { store, calls, realSync };
}

describe('送信待ちの繰り返し（§11・§12）', () => {
  const series = () =>
    ev({
      title: '燃えるゴミ',
      memberIds: [M.papa],
      ownerId: M.papa,
      version: 3,
      startAt: '2026-10-05T07:30:00+09:00',
      endAt: '2026-10-05T08:00:00+09:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    });

  it('この回だけ: オフラインでも手元に例外行を作って積む。取得で消えず、送れたら例外行を入れる', async () => {
    const s = series();
    await db.events.put(s);
    let online = false;
    const plain = ({ sync: _s, ...e }: LocalEvent): EventDTO => e;
    // サーバーが持っている行（PATCH のあとは例外行も同期に出る）
    const serverRows: EventDTO[] = [plain(s)];
    const { store, calls, realSync } = storeWith((c) => {
      if (!online) return 'network';
      if (c.path === '/api/me') return { status: 200, body: me };
      if (c.path.startsWith('/api/sync')) {
        return {
          status: 200,
          body: {
            cursor: 5,
            full: true,
            events: serverRows,
            deletedEventIds: [],
            members,
            myReminderPrefs: [],
            me,
            unreadActivity: 0,
          },
        };
      }
      const body = c.body as { exceptionId: string; changes: { title: string } };
      const exception: EventDTO = {
        ...plain(s),
        id: body.exceptionId,
        version: 1,
        title: body.changes.title,
        startAt: '2026-10-08T07:30:00+09:00',
        endAt: '2026-10-08T08:00:00+09:00',
        rrule: null,
        parentId: s.id,
        recurrenceId: '2026-10-08T07:30',
      };
      serverRows[0] = { ...plain(s), version: 4 };
      serverRows.push(exception);
      return { status: 200, body: { event: serverRows[0], exception } };
    });
    const r = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', {
      title: '燃えるゴミ（祝日）',
    });
    expect(r.ok).toBe(true);
    const local = (await db.events.where('parentId').equals(s.id).toArray())[0];
    expect(local).toMatchObject({
      title: '燃えるゴミ（祝日）',
      recurrenceId: '2026-10-08T07:30',
      startAt: '2026-10-08T07:30:00+09:00',
      sync: 'pending',
    });
    const [item] = await db.outbox.toArray();
    expect(item?.body).toMatchObject({
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      exceptionId: local?.id,
    });
    expect(item?.baseVersion).toBe(3);
    online = true;
    await realSync();
    expect(calls.find((c) => c.method === 'PATCH')?.headers['if-match']).toBe('3');
    expect(await db.events.get(local?.id ?? '')).toMatchObject({
      title: '燃えるゴミ（祝日）',
      sync: 'synced',
    });
  });

  it('まだ送れていない例外行は、全件の取得でも消さない', async () => {
    const s = series();
    await db.events.put(s);
    const { sync: _s, ...plain } = s;
    const { store, realSync } = storeWith((c) => {
      if (c.path === '/api/me') return { status: 200, body: me };
      if (c.path.startsWith('/api/sync')) {
        return {
          status: 200,
          body: {
            cursor: 5,
            full: true,
            events: [plain],
            deletedEventIds: [],
            members,
            myReminderPrefs: [],
            me,
            unreadActivity: 0,
          },
        };
      }
      return { status: 503 };
    });
    await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', { title: '祝日' });
    await realSync();
    const local = await db.events.where('parentId').equals(s.id).toArray();
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ title: '祝日', sync: 'pending' });
  });

  it('この回だけ削除: 手元の exdates に足し、送る前なら元に戻せる', async () => {
    const s = series();
    await db.events.put(s);
    const { store } = storeWith(() => 'network');
    const d = await store.deleteOccurrence(s.id, '2026-10-08T07:30', 'this');
    expect(d.ok).toBe(true);
    expect((await db.events.get(s.id))?.exdates).toEqual(['2026-10-08T07:30']);
    const [item] = await db.outbox.toArray();
    expect(item?.path).toBe(`/api/events/${s.id}?scope=this&recurrenceId=2026-10-08T07%3A30`);
    await d.undo?.();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.events.get(s.id))?.exdates).toEqual([]);
  });

  it('これ以降: 範囲と回を付けて積む（元に戻す操作はない）', async () => {
    const s = series();
    await db.events.put(s);
    const { store } = storeWith(() => 'network');
    const d = await store.deleteOccurrence(s.id, '2026-10-15T07:30', 'following');
    expect(d).toMatchObject({ ok: true, undo: null });
    const u = await store.updateOccurrence(s.id, '2026-10-15T07:30', 'following', {
      title: '可燃ごみ',
    });
    expect(u.ok).toBe(true);
    const bodies = (await db.outbox.toArray()).map((o) => [o.method, o.path, o.body]);
    expect(bodies[1]).toEqual([
      'PATCH',
      `/api/events/${s.id}`,
      {
        scope: 'following',
        recurrenceId: '2026-10-15T07:30',
        // 新しいシリーズの ID は手元で振る（§24 D33。レビュー P3-spec-tests-08）
        exceptionId: expect.any(String),
        changes: { title: '可燃ごみ' },
      },
    ]);
    // 保存したあとの回は、新しいシリーズの同じ回
    expect(u.ok && u.target).toEqual({
      eventId: (bodies[1]?.[2] as { exceptionId?: string } | undefined)?.exceptionId,
      recurrenceId: '2026-10-15T07:30',
    });
  });
});

describe('繰り返しの回の送信待ち（Phase 3 のレビュー。§24 D34）', () => {
  const plain = ({ sync: _s, ...e }: LocalEvent): EventDTO => e;
  const series = () =>
    ev({
      title: '燃えるゴミ',
      memberIds: [M.papa],
      ownerId: M.papa,
      version: 3,
      startAt: '2026-10-05T07:30:00+09:00',
      endAt: '2026-10-05T08:00:00+09:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    });

  it('この回だけの送信待ちが 409: 競合の画面に出さず、送信待ちと手元の例外行を捨て、家族の版にして全件を取り直す（P3-web-01）', async () => {
    const s = series();
    await db.events.put(s);
    const theirs = { ...plain(s), version: 7, title: '燃えるゴミ（家族が変えた）' };
    const { store, realSync } = storeWith((c) => {
      if (c.path === '/api/me') return { status: 200, body: me };
      if (c.method === 'PATCH') {
        return {
          status: 409,
          body: {
            type: 'about:blank',
            title: '競合',
            status: 409,
            code: 'conflict',
            event: theirs,
          },
        };
      }
      return 'network';
    });
    const toasts: string[] = [];
    store.onToast((t) => toasts.push(t.message));
    const r = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', { title: '祝日' });
    expect(r.ok).toBe(true);
    const exId = (await db.events.where('parentId').equals(s.id).toArray())[0]?.id;
    expect(exId).toBeDefined();
    await realSync();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.conflicts.count()).toBe(0);
    expect(await db.events.get(exId as string)).toBeUndefined();
    expect((await db.events.get(s.id))?.title).toBe('燃えるゴミ（家族が変えた）');
    expect(await db.getMeta('cursor')).toBe(0);
    expect(toasts.some((t) => t.includes('家族が先に'))).toBe(true);
  });

  it('回がない 404（occurrence_not_found）では親を消さない（P3-web-08）', async () => {
    const s = series();
    await db.events.put(s);
    const { store, realSync } = storeWith((c) => {
      if (c.path === '/api/me') return { status: 200, body: me };
      if (c.method === 'PATCH') {
        return {
          status: 404,
          body: {
            type: 'about:blank',
            title: 'この回は見つかりません',
            status: 404,
            code: 'occurrence_not_found',
          },
        };
      }
      return 'network';
    });
    await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', { title: '祝日' });
    await realSync();
    expect(await db.events.get(s.id)).toBeDefined();
    expect(await db.events.where('parentId').equals(s.id).count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('新しく作った「この回だけ変更」の元に戻す: 送る前なら送信待ちと例外行を消す、送ったあとなら revert を送る（P3-web-05）', async () => {
    const s = series();
    await db.events.put(s);
    const { store } = storeWith(() => 'network');
    const r = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', { title: '祝日' });
    await r.undo?.();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.events.where('parentId').equals(s.id).count()).toBe(0);

    // 送ったあと（attempts が付いた）
    const r2 = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', { title: '祝日' });
    const item = (await db.outbox.toArray())[0];
    await db.outbox.update(item?.id as string, { attempts: 1 });
    await r2.undo?.();
    const bodies = (await db.outbox.toArray()).map((o) => o.body);
    expect(bodies[1]).toEqual({
      scope: 'this',
      recurrenceId: '2026-10-08T07:30',
      revert: true,
      changes: {},
    });
    expect(await db.events.where('parentId').equals(s.id).count()).toBe(0);
  });

  it('「すべて」: 件名だけなら元に戻せる（逆向きの変更を積む）。日時を変えたら元に戻せない（P3-web-07）', async () => {
    const s = series();
    await db.events.put(s);
    const { store } = storeWith(() => 'network');
    const r = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'all', { title: '資源ゴミ' });
    expect(r.ok && r.undo).toBeTypeOf('function');
    await r.undo?.();
    expect((await db.outbox.toArray()).map((o) => o.body)).toEqual([
      { scope: 'all', recurrenceId: '2026-10-08T07:30', changes: { title: '資源ゴミ' } },
      { scope: 'all', recurrenceId: '2026-10-08T07:30', changes: { title: '燃えるゴミ' } },
    ]);
    const moved = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'all', {
      startAt: '2026-10-08T08:00:00+09:00',
      endAt: '2026-10-08T08:30:00+09:00',
    });
    expect(moved.ok && moved.undo).toBeUndefined();
    expect(moved.ok && moved.target).toEqual({ eventId: s.id, recurrenceId: '2026-10-08T08:00' });
  });

  it('「この予定だけ」で公開・非公開や繰り返しは変えられない（保存しない。P3-web-04・11）', async () => {
    const s = series();
    await db.events.put(s);
    const { store } = storeWith(() => 'network');
    const a = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', {
      visibility: 'private',
    });
    expect(a.ok).toBe(false);
    const b = await store.updateOccurrence(s.id, '2026-10-08T07:30', 'this', {
      rrule: 'FREQ=DAILY',
    });
    expect(b.ok).toBe(false);
    expect(await db.outbox.count()).toBe(0);
  });

  it('最初の回の「これ以降を削除」はシリーズごとゴミ箱（元に戻せる。P3-web-12）', async () => {
    const s = series();
    await db.events.put(s);
    const { store } = storeWith(() => 'network');
    const d = await store.deleteOccurrence(s.id, '2026-10-05T07:30', 'following');
    expect(d.ok).toBe(true);
    expect(d.undo).toBeTypeOf('function');
    expect((await db.outbox.toArray()).map((o) => o.path)).toEqual([`/api/events/${s.id}`]);
  });
});
