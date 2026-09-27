import 'fake-indexeddb/auto';
import {
  type EventDTO,
  fakeClock,
  fromJst,
  type MeDTO,
  memberSettingsSchema,
  type SyncResponse,
} from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fetcher } from '../src/data/api';
import { ItoDb } from '../src/data/db';
import { backoffMs, DataStore } from '../src/data/store';
import { ev, M, members } from './fixtures';

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
  db = new ItoDb(`test-${seq}`);
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

/** 送信を 1 回だけ回す（syncNow は pull もするので、ここでは push だけ） */
async function push(store: DataStore) {
  return store.push();
}

function storeWith(handler: (c: Call) => Reply | Promise<Reply>) {
  const { fetcher, calls } = fakeFetch(handler);
  const store = new DataStore(db, clock, fetcher);
  // テストでは自動の同期を止める（明示的に push・pull する）
  store.syncNow = async () => {};
  return { store, calls };
}

describe('送信待ちを畳む（§12）', () => {
  it('作成＋更新 → 作成 1 件（中身は更新後）', async () => {
    const { store, calls } = storeWith((c) => ({
      status: 201,
      body: { event: { ...(c.body as object), version: 1 } },
    }));
    const created = await store.createEvent({
      title: 'A',
      allDay: false,
      startAt: '2026-09-29T10:00:00+09:00',
    });
    expect(created.ok).toBe(true);
    const id = created.ok ? created.value.id : '';
    await store.updateEvent(id, { title: 'B' });
    expect(await db.outbox.count()).toBe(1);
    const item = (await db.outbox.toArray())[0];
    expect(item?.kind).toBe('create');
    expect((item?.body as { title: string } | undefined)?.title).toBe('B');
    expect(calls).toHaveLength(0);
  });

  it('更新どうし → 1 件（最初の変更前との差分・If-Match は最初の版）', async () => {
    const base = ev({ title: '会議', memberIds: [M.papa], ownerId: M.papa, version: 3 });
    await db.events.put(base);
    const { store, calls } = storeWith((c) => ({
      status: 200,
      body: {
        event: {
          ...base,
          sync: undefined,
          version: 4,
          title: (c.body as { changes: { title?: string } }).changes.title ?? base.title,
          startAt: '2026-09-29T11:00:00+09:00',
        },
      },
    }));
    await store.updateEvent(base.id, { title: '会議2' });
    await store.updateEvent(base.id, { startAt: '2026-09-29T11:00:00+09:00' });
    const items = await db.outbox.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]?.body).toEqual({
      scope: 'all',
      changes: { title: '会議2', startAt: '2026-09-29T11:00:00+09:00' },
    });
    expect(await push(store)).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers['if-match']).toBe('3');
    expect(calls[0]?.headers['idempotency-key']).toBe(items[0]?.id);
    expect((await db.events.get(base.id))?.sync).toBe('synced');
  });

  it('削除 → それより前の未送信を捨てる。作成がまだなら、作成も削除も送らない', async () => {
    const { store, calls } = storeWith(() => ({ status: 200, body: {} }));
    const created = await store.createEvent({ title: 'A', allDay: true, startDate: '2026-09-29' });
    const id = created.ok ? created.value.id : '';
    await store.updateEvent(id, { title: 'B' });
    await store.deleteEvent(id);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.events.get(id)).toBeUndefined();
    await push(store);
    expect(calls).toHaveLength(0);
  });

  it('未送信の更新のあとの削除は、削除だけを最初の版の If-Match で送る', async () => {
    const base = ev({ title: '会議', memberIds: [M.papa], ownerId: M.papa, version: 5 });
    await db.events.put(base);
    const { store, calls } = storeWith(() => ({ status: 200, body: { id: base.id, version: 6 } }));
    await store.updateEvent(base.id, { title: 'x' });
    await store.deleteEvent(base.id);
    const items = await db.outbox.toArray();
    expect(items.map((i) => i.kind)).toEqual(['delete']);
    await push(store);
    expect(calls.map((c) => [c.method, c.headers['if-match']])).toEqual([['DELETE', '5']]);
  });

  it('送信中の変更には畳まず、成功したら後続の If-Match を新しい版に書き換える', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.put(base);
    let storeRef: DataStore | null = null;
    let first = true;
    const { store, calls } = storeWith(async (c) => {
      if (first) {
        first = false;
        // 送信中にもう 1 回編集する
        await storeRef?.updateEvent(base.id, { title: 'C' });
        return { status: 200, body: { event: { ...serverEvent(base, 2), title: 'B' } } };
      }
      return {
        status: 200,
        body: {
          event: {
            ...serverEvent(base, 3),
            title: (c.body as { changes: { title: string } }).changes.title,
          },
        },
      };
    });
    storeRef = store;
    await store.updateEvent(base.id, { title: 'B' });
    await push(store);
    expect(calls.map((c) => c.headers['if-match'])).toEqual(['1', '2']);
    expect(await db.events.get(base.id)).toMatchObject({ title: 'C', version: 3, sync: 'synced' });
  });
});

describe('応答ごとの扱い（§12 の表）', () => {
  async function twoPendingUpdates() {
    const a = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    const b = ev({ title: 'B', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    await db.events.bulkPut([a, b]);
    return { a, b };
  }

  it('409 はその予定を競合にして outbox から外し、後続は止めない', async () => {
    const { a, b } = await twoPendingUpdates();
    const theirs = { ...serverEvent(a, 2), title: '家族の変更' };
    const { store, calls } = storeWith((c) =>
      c.path.includes(a.id)
        ? { status: 409, body: { code: 'conflict', status: 409, event: theirs } }
        : { status: 200, body: { event: { ...serverEvent(b, 2), title: 'B2' } } },
    );
    await store.updateEvent(a.id, { title: 'A2' });
    await store.updateEvent(b.id, { title: 'B2' });
    expect(await push(store)).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(await db.outbox.count()).toBe(0);
    const conflict = await db.conflicts.get(a.id);
    expect(conflict).toMatchObject({
      theirs: { title: '家族の変更' },
      mine: { title: 'A2' },
      changes: { title: 'A2' },
    });
    expect((await db.events.get(a.id))?.sync).toBe('conflict');
    expect(await db.events.get(b.id)).toMatchObject({ title: 'B2', sync: 'synced' });
  });

  it('404・410 は手元から消し、「この予定は削除されていました」', async () => {
    const { a } = await twoPendingUpdates();
    const { store } = storeWith(() => ({ status: 410, body: { code: 'gone', status: 410 } }));
    const toasts: string[] = [];
    store.onToast((t) => toasts.push(t.message));
    await store.updateEvent(a.id, { title: 'x' });
    await push(store);
    expect(await db.events.get(a.id)).toBeUndefined();
    expect(toasts).toEqual(['この予定は削除されていました']);
  });

  it('422・403 forbidden は snapshot で手元を元に戻して知らせる', async () => {
    const { a } = await twoPendingUpdates();
    const { store } = storeWith(() => ({
      status: 422,
      body: { code: 'validation', status: 422, detail: '件名を入れてください' },
    }));
    const toasts: string[] = [];
    store.onToast((t) => toasts.push(t.message));
    await store.updateEvent(a.id, { title: 'x' });
    expect((await db.events.get(a.id))?.title).toBe('x');
    await push(store);
    expect(await db.events.get(a.id)).toMatchObject({ title: 'A', sync: 'synced' });
    expect(toasts[0]).toContain('保存できませんでした');
    // 作成が拒否されたら手元から消える
    const { store: s2 } = storeWith(() => ({
      status: 403,
      body: { code: 'forbidden', status: 403 },
    }));
    const created = await s2.createEvent({ title: 'n', allDay: true, startDate: '2026-09-29' });
    await s2.push();
    expect(await db.events.get(created.ok ? created.value.id : '')).toBeUndefined();
  });

  it('401 no_identity・403 not_member は同期を止め、outbox は残す（理由を出す）', async () => {
    const { a } = await twoPendingUpdates();
    const { store } = storeWith(() => ({
      status: 403,
      body: { code: 'not_member', status: 403, login: 'x@example.com' },
    }));
    await store.updateEvent(a.id, { title: 'x' });
    expect(await push(store)).toBe('blocked');
    expect(store.getState()).toMatchObject({
      status: 'error',
      block: { kind: 'not_member', login: 'x@example.com' },
    });
    expect(await db.outbox.count()).toBe(1);
    const { store: s2 } = storeWith(() => ({
      status: 401,
      body: { code: 'no_identity', status: 401 },
    }));
    expect(await s2.push()).toBe('blocked');
    expect(s2.getState().block).toEqual({ kind: 'no_identity' });
  });

  it('426 はアプリが古い: outbox を残したまま「更新」を促す', async () => {
    const { a } = await twoPendingUpdates();
    const { store } = storeWith(() => ({
      status: 426,
      body: { code: 'client_outdated', status: 426 },
    }));
    await store.updateEvent(a.id, { title: 'x' });
    expect(await push(store)).toBe('blocked');
    expect(store.getState().block).toEqual({ kind: 'client_outdated' });
    expect(await db.outbox.count()).toBe(1);
    expect((await db.events.get(a.id))?.title).toBe('x');
  });

  it('429 は Retry-After に従う', async () => {
    const { a } = await twoPendingUpdates();
    const { store } = storeWith(() => ({
      status: 429,
      body: { code: 'rate_limited', status: 429 },
      headers: { 'Retry-After': '30' },
    }));
    await store.updateEvent(a.id, { title: 'x' });
    expect(await push(store)).toBe('waiting');
    expect((await db.outbox.toArray())[0]?.nextAttemptAt).toBe(clock.now() + 30_000);
  });

  it('通信エラー・5xx は指数バックオフ（最大 1 時間）で再送。待っている間は送らない', async () => {
    const { a } = await twoPendingUpdates();
    let reply: Reply = 'network';
    const { store, calls } = storeWith(() => reply);
    await store.updateEvent(a.id, { title: 'x' });
    expect(await push(store)).toBe('network');
    let item = (await db.outbox.toArray())[0];
    expect(item).toMatchObject({ attempts: 1, nextAttemptAt: clock.now() + 1000 });
    // 待っている間は送らない
    expect(await push(store)).toBe('waiting');
    expect(calls).toHaveLength(1);
    clock.advance(1000);
    reply = { status: 503, body: { code: 'internal', status: 503 } };
    expect(await push(store)).toBe('waiting');
    item = (await db.outbox.toArray())[0];
    expect(item).toMatchObject({ attempts: 2, nextAttemptAt: clock.now() + 2000 });
    expect(backoffMs(30)).toBe(60 * 60 * 1000);
    clock.advance(2000);
    reply = { status: 200, body: { event: { ...serverEvent(a, 2), title: 'x' } } };
    expect(await push(store)).toBe('ok');
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('取得（pull）', () => {
  function syncBody(extra: Partial<SyncResponse>): SyncResponse {
    return {
      cursor: 10,
      full: true,
      events: [],
      deletedEventIds: [],
      members,
      myReminderPrefs: [],
      me,
      unreadActivity: 2,
      ...extra,
    };
  }

  it('全件同期は、送信待ちのない予定をサーバーの内容で置き換え、応答にない予定は消す（送信待ちは残す）', async () => {
    const keep = ev({ title: '送信待ち', memberIds: [M.papa], ownerId: M.papa });
    const gone = ev({ title: '消えた' });
    const stale = ev({ title: '古い' });
    await db.events.bulkPut([keep, gone, stale]);
    const { store } = storeWith((c) =>
      c.path.startsWith('/api/sync')
        ? {
            status: 200,
            body: syncBody({ events: [{ ...serverEvent(stale, 2), title: '新しい' }] }),
          }
        : 'network',
    );
    await store.updateEvent(keep.id, { title: '送信待ち2' });
    expect(await store.pull()).toBe('ok');
    const all = await db.events.toArray();
    expect(all.map((e) => e.title).sort()).toEqual(['送信待ち2', '新しい'].sort());
    expect(await db.getMeta('cursor')).toBe(10);
    expect(await db.getMeta('unreadActivity')).toBe(2);
  });

  it('差分は置き換えと削除だけ。応答の形が違えば取り込まない', async () => {
    const a = ev({ title: 'A' });
    const b = ev({ title: 'B' });
    await db.events.bulkPut([a, b]);
    const { store } = storeWith(() => ({
      status: 200,
      body: syncBody({
        full: false,
        events: [{ ...serverEvent(a, 2), title: 'A2' }],
        deletedEventIds: [b.id],
      }),
    }));
    await store.pull();
    expect((await db.events.toArray()).map((e) => e.title)).toEqual(['A2']);
    const { store: bad } = storeWith(() => ({ status: 200, body: { cursor: 'x' } }));
    expect(await bad.pull()).toBe('blocked');
    expect((await db.events.toArray()).map((e) => e.title)).toEqual(['A2']);
  });
});

describe('元に戻す・競合の解決', () => {
  it('まだ送っていない削除の「元に戻す」は、何も送らずに手元を戻す', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa });
    await db.events.put(base);
    const { store, calls } = storeWith(() => ({ status: 200, body: {} }));
    const { undo } = await store.deleteEvent(base.id);
    await undo();
    expect(await db.outbox.count()).toBe(0);
    expect((await db.events.get(base.id))?.title).toBe('A');
    await push(store);
    expect(calls).toHaveLength(0);
  });

  it('送ったあとの削除の「元に戻す」は、復元を送る', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa });
    await db.events.put(base);
    const { store, calls } = storeWith((c) =>
      c.method === 'DELETE'
        ? { status: 200, body: { id: base.id, version: 2 } }
        : { status: 200, body: { event: serverEvent(base, 3) } },
    );
    const { undo } = await store.deleteEvent(base.id);
    await push(store);
    await undo();
    await push(store);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /api/events/${base.id}`,
      `POST /api/events/${base.id}/restore`,
    ]);
    expect(await db.events.get(base.id)).toMatchObject({ version: 3, sync: 'synced' });
  });

  it('競合の 3 通りの解決（家族の変更を採用・自分の変更で上書き・両方残す）', async () => {
    const base = ev({ title: 'A', memberIds: [M.papa], ownerId: M.papa, version: 1 });
    const theirs = { ...serverEvent(base, 2), title: '家族' };
    for (const choice of ['theirs', 'mine', 'both'] as const) {
      await db.events.clear();
      await db.conflicts.clear();
      await db.outbox.clear();
      await db.events.put(base);
      const { store } = storeWith(() => ({
        status: 409,
        body: { code: 'conflict', status: 409, event: theirs },
      }));
      await store.updateEvent(base.id, { title: '自分' });
      await store.push();
      await store.resolveConflict(base.id, choice);
      const events = await db.events.toArray();
      const outbox = await db.outbox.toArray();
      if (choice === 'theirs') {
        expect(events.map((e) => [e.title, e.sync])).toEqual([['家族', 'synced']]);
        expect(outbox).toHaveLength(0);
      } else if (choice === 'mine') {
        expect(events.map((e) => [e.title, e.sync])).toEqual([['自分', 'pending']]);
        expect(outbox.map((o) => [o.kind, o.baseVersion, o.body])).toEqual([
          ['update', 2, { scope: 'all', changes: { title: '自分' } }],
        ]);
      } else {
        expect(events.map((e) => e.title).sort()).toEqual(['家族', '自分']);
        expect(outbox.map((o) => o.kind)).toEqual(['create']);
      }
      expect(await db.conflicts.count()).toBe(0);
    }
  });

  it('他人の非公開は手元でも変えられない', async () => {
    const secret = ev({ title: null, visibility: 'private', ownerId: M.yuki, memberIds: [M.yuki] });
    await db.events.put(secret);
    const { store } = storeWith(() => ({ status: 200 }));
    expect((await store.updateEvent(secret.id, { title: 'x' })).ok).toBe(false);
    expect((await store.deleteEvent(secret.id)).ok).toBe(false);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('オフラインで禁止する操作（§12）', async () => {
  const { offlineRestriction } = await import('../src/data/offline');
  it('繰り返しの「これ以降」「すべて」はオフラインでは不可。「この回だけ」と繰り返しなしは可', () => {
    expect(offlineRestriction({ online: false, recurring: true, scope: 'following' }).allowed).toBe(
      false,
    );
    expect(offlineRestriction({ online: false, recurring: true, scope: 'all' }).allowed).toBe(
      false,
    );
    expect(offlineRestriction({ online: false, recurring: true, scope: 'this' }).allowed).toBe(
      true,
    );
    expect(offlineRestriction({ online: false, recurring: false, scope: 'all' }).allowed).toBe(
      true,
    );
    expect(offlineRestriction({ online: true, recurring: true, scope: 'all' }).allowed).toBe(true);
  });
});
