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
  changesForScope,
  changesStart,
  lostCounts,
  occurrenceEvent,
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

  it('消える件数: これ以降はその回以降、すべては開始が変わるときだけ、削除のすべては 0', () => {
    expect(
      lostCounts(master, [exception], '2026-10-15T07:00', { action: 'edit', startsChange: false }),
    ).toEqual({
      following: 2,
      all: 0,
    });
    expect(
      lostCounts(master, [exception], '2026-10-15T07:00', { action: 'edit', startsChange: true }),
    ).toEqual({
      following: 2,
      all: 3,
    });
    expect(
      lostCounts(master, [exception], '2026-10-15T07:00', { action: 'delete', startsChange: true })
        .all,
    ).toBe(0);
  });

  it('回の今の中身（例外行があればそれ、なければ親をその回に）と、開始が変わるか', () => {
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
    if (!synth) throw new Error('回がない');
    const input = draftToInput(eventToDraft(synth));
    expect(changesStart(synth, input)).toBe(false);
    expect(changesStart(synth, { ...input, startAt: '2026-10-15T08:00:00+09:00' })).toBe(true);
  });

  it('送る変更: この回だけは rrule を外す。これ以降・すべては繰り返しが同じなら送らない', () => {
    const input = {
      title: 'x',
      allDay: false,
      startAt: '2026-10-15T07:00:00+09:00',
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
    };
    expect('rrule' in changesForScope(master, input, 'this')).toBe(false);
    expect('rrule' in changesForScope(master, input, 'all')).toBe(false);
    expect(
      changesForScope(master, { ...input, rrule: 'FREQ=WEEKLY;BYDAY=FR' }, 'following').rrule,
    ).toBe('FREQ=WEEKLY;BYDAY=FR');
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
      { scope: 'following', recurrenceId: '2026-10-15T07:30', changes: { title: '可燃ごみ' } },
    ]);
  });
});
