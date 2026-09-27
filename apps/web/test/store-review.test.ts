import 'fake-indexeddb/auto';
import { type EventDTO, fakeClock, fromJst, type MeDTO, memberSettingsSchema } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fetcher } from '../src/data/api';
import { ItoDb } from '../src/data/db';
import { DataStore } from '../src/data/store';
import { ev, M, members } from './fixtures';

/** Phase 1 のレビューで見つかった PWA のデータ層の不具合（WD-01〜14）の再現テスト */

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'network';

function fakeFetch(handler: (c: Call) => Reply | Promise<Reply>): {
  fetcher: Fetcher;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (path, init) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const call: Call = {
      method: init.method ?? 'GET',
      path,
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const r = await handler(call);
    if (r === 'network') throw new TypeError('Failed to fetch');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers,
    });
  };
  return { fetcher, calls };
}

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
  db = new ItoDb(`review-${seq}`);
  await db.setMeta('me', me);
  await db.members.bulkPut(members);
});
afterEach(async () => {
  db.close();
  await db.delete();
});

function serverEvent(local: EventDTO, version: number, extra: Partial<EventDTO> = {}): EventDTO {
  const { sync: _s, ...rest } = local as EventDTO & { sync?: string };
  return { ...rest, version, ...extra };
}

/** 自動の同期を止めた DataStore（明示的に push・pull する）。realSync で本物の syncNow を呼べる */
function storeWith(handler: (c: Call) => Reply | Promise<Reply>) {
  const { fetcher, calls } = fakeFetch(handler);
  const store = new DataStore(db, clock, fetcher);
  const realSync = store.syncNow.bind(store);
  store.syncNow = async () => {};
  return { store, calls, realSync };
}

function syncBody(extra: Record<string, unknown> = {}) {
  return {
    cursor: 1,
    full: false,
    events: [],
    deletedEventIds: [],
    members,
    myReminderPrefs: [],
    me,
    unreadActivity: 0,
    ...extra,
  };
}

describe('Phase 1 のレビューの指摘（PWA のデータ層）', () => {
  it('WD-01: 応答が失われた（送ったかもしれない）送信待ちには畳まず、新しい送信待ちとして送る', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.put(base);
    let n = 0;
    const { store, calls } = storeWith((c) => {
      n++;
      if (n === 1) return 'network'; // サーバーには届いたが応答が失われた、とみなす
      const title = (c.body as { changes: { title: string } }).changes.title;
      return { status: 200, body: { event: { ...serverEvent(base, n), title } } };
    });
    await store.updateEvent(base.id, { title: 'B' });
    expect(await store.push()).toBe('network');
    await store.updateEvent(base.id, { title: 'C' });
    expect(await db.outbox.count()).toBe(2);
    clock.advance(5000);
    await store.push();
    expect(calls.map((c) => (c.body as { changes: { title: string } }).changes.title)).toEqual([
      'B',
      'B',
      'C',
    ]);
    expect(calls[2]?.headers['if-match']).toBe('2');
    expect(await db.events.get(base.id)).toMatchObject({ title: 'C', sync: 'synced' });
  });

  it('WD-01: 送ったかもしれない作成のあとの削除は、削除を送る', async () => {
    let posts = 0;
    const { store, calls } = storeWith((c) => {
      if (c.method === 'POST') {
        posts++;
        if (posts === 1) return 'network';
        return {
          status: 201,
          body: {
            event: {
              ...(c.body as object),
              version: 1,
              exdates: [],
              parentId: null,
              recurrenceId: null,
              ownerId: M.papa,
              createdBy: M.papa,
              updatedBy: M.papa,
              createdAt: null,
              updatedAt: null,
            },
          },
        };
      }
      return { status: 200, body: { id: 'x', version: 2 } };
    });
    const created = await store.createEvent({ title: 'A', allDay: true, startDate: '2026-09-29' });
    const id = created.ok ? created.value.id : '';
    expect(await store.push()).toBe('network');
    await store.deleteEvent(id);
    clock.advance(5000);
    await store.push();
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'DELETE']);
    expect(calls[2]?.headers['if-match']).toBe('1');
  });

  it('WD-02: 先頭の送信待ちが待ち（5xx のあと）でも取得はして、つながらないとは言わない', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.put(base);
    const { store, calls, realSync } = storeWith((c) => {
      if (c.path.startsWith('/api/sync'))
        return { status: 200, body: syncBody({ full: true, events: [serverEvent(base, 1)] }) };
      if (c.path === '/api/me') return { status: 200, body: me };
      return { status: 503, body: { code: 'internal', status: 503 } };
    });
    await store.updateEvent(base.id, { title: 'B' });
    await realSync();
    expect(calls.some((c) => c.path.startsWith('/api/sync'))).toBe(true);
    expect(store.getState().status).toBe('synced');
    expect(await db.outbox.count()).toBe(1);
  });

  it('WD-03: 別の人としてつながったら、前の人の予定・送信待ちを消して全件から取り直す', async () => {
    const secret = ev({
      title: '前の人の内緒',
      visibility: 'private',
      memberIds: [M.papa],
      ownerId: M.papa,
    });
    await db.events.put(secret);
    await db.setMeta('cursor', 50);
    const other: MeDTO = { ...me, id: M.mama, name: 'お母さん' };
    const { store, calls, realSync } = storeWith((c) => {
      if (c.path === '/api/me') return { status: 200, body: other };
      if (c.path.startsWith('/api/sync'))
        return { status: 200, body: syncBody({ cursor: 60, full: true, me: other }) };
      return { status: 500 };
    });
    await store.updateEvent(secret.id, { title: '送信待ち' });
    await realSync();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    expect(await db.events.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(calls.find((c) => c.path.startsWith('/api/sync'))?.path).toBe('/api/sync?cursor=0');
    expect((await db.getMeta<MeDTO>('me'))?.id).toBe(M.mama);
  });

  it('WD-04: 競合中の予定も、取得で家族の側の最新（と削除）を取り込む', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.put(base);
    const theirs1 = { ...serverEvent(base, 2), title: '家族1' };
    const theirs2 = { ...serverEvent(base, 3), title: '家族2' };
    let body: unknown = syncBody({ cursor: 2, events: [theirs2] });
    const { store } = storeWith((c) =>
      c.path.startsWith('/api/sync')
        ? { status: 200, body }
        : { status: 409, body: { code: 'conflict', status: 409, event: theirs1 } },
    );
    await store.updateEvent(base.id, { title: '自分' });
    await store.push();
    await store.pull();
    expect((await db.conflicts.get(base.id))?.theirs.title).toBe('家族2');
    body = syncBody({ cursor: 3, deletedEventIds: [base.id] });
    await store.pull();
    expect((await db.conflicts.get(base.id))?.theirsDeleted).toBe(true);
    await store.resolveConflict(base.id, 'theirs');
    expect(await db.events.get(base.id)).toBeUndefined();
  });

  it('WD-05: 競合中の予定を編集して送れたら、競合の記録を消す', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.put(base);
    const theirs = { ...serverEvent(base, 2), title: '家族' };
    let conflictNow = true;
    const { store } = storeWith(() =>
      conflictNow
        ? { status: 409, body: { code: 'conflict', status: 409, event: theirs } }
        : { status: 200, body: { event: { ...serverEvent(base, 3), title: 'もう一度' } } },
    );
    await store.updateEvent(base.id, { title: '自分' });
    await store.push();
    conflictNow = false;
    await store.updateEvent(base.id, { title: 'もう一度' });
    await store.push();
    expect(await db.conflicts.count()).toBe(0);
    expect(await db.events.get(base.id)).toMatchObject({ title: 'もう一度', sync: 'synced' });
  });

  it('WD-14: 中身の変わらない編集は送らない。保存のあとの「元に戻す」で畳んで元に戻れば送信待ちを消す', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.put(base);
    const { store } = storeWith(() => ({ status: 200 }));
    await store.updateEvent(base.id, { title: 'A' });
    expect(await db.outbox.count()).toBe(0);
    const r = await store.updateEvent(base.id, { title: 'B' });
    expect(await db.outbox.count()).toBe(1);
    await r.undo?.();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.events.get(base.id)).toMatchObject({ title: 'A', sync: 'synced' });
  });

  it('WD-13: 同期中に retryNow で呼ばれたら、次の回でバックオフを解いて送る', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.put(base);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let phase = 0;
    const { store, calls, realSync } = storeWith(async (c) => {
      if (c.path === '/api/me') return { status: 200, body: me };
      if (c.path.startsWith('/api/sync')) {
        if (phase === 0) await gate;
        return { status: 200, body: syncBody() };
      }
      return phase === 0
        ? { status: 503 }
        : { status: 200, body: { event: { ...serverEvent(base, 2), title: 'B' } } };
    });
    await store.updateEvent(base.id, { title: 'B' });
    const first = realSync();
    // 1 回目の同期が取得の途中で止まっているあいだに、retryNow で呼ぶ
    await new Promise((r) => setTimeout(r, 20));
    phase = 1;
    const second = realSync({ retryNow: true });
    release();
    await first;
    await second;
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
    expect(await db.outbox.count()).toBe(0);
  });
});
