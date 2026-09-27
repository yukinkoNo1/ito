import type { EventDTO } from '@ito/core';
import { fromJst } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changes, events } from '../src/db/schema';
import {
  allDay,
  as,
  createEvent,
  deleteEvent,
  IDS,
  patchEvent,
  seedFamily,
  syncAs,
  timed,
} from './family';
import { createTestContext, devEnv, send, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = createTestContext(devEnv(), { now: fromJst('2026-09-27', '14:18') });
  seedFamily(ctx);
});
afterEach(() => ctx.close());

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('予定の作成（§13）', () => {
  it('作った予定が、ほかの家族の同期に出る（2 人の開発ログイン）', async () => {
    const { res, event } = await createEvent(
      ctx,
      'mama',
      timed('2026-09-29', '10:00', '11:00', { title: '歯医者', memberIds: [IDS.mama] }),
    );
    expect(res.status).toBe(201);
    expect(event).toMatchObject({
      title: '歯医者',
      version: 1,
      ownerId: IDS.mama,
      busy: true,
      startAt: '2026-09-29T10:00:00+09:00',
    });
    const papaView = await syncAs(ctx, 'papa');
    expect(papaView.events.map((e) => e.title)).toContain('歯医者');
  });

  it('担当を省くと自分、全員なら memberIds は空', async () => {
    const a = await createEvent(ctx, 'haru', timed('2026-09-29', '10:00', null));
    expect(a.event.memberIds).toEqual([IDS.haru]);
    const b = await createEvent(
      ctx,
      'haru',
      timed('2026-09-29', '18:00', null, { forEveryone: true, memberIds: [IDS.papa] }),
    );
    expect(b.event).toMatchObject({ forEveryone: true, memberIds: [] });
  });

  it('busy の既定値（時刻あり=true、1 日の終日=false、複数日の終日=true）', async () => {
    expect((await createEvent(ctx, 'papa', timed('2026-09-29', '10:00', null))).event.busy).toBe(
      true,
    );
    expect((await createEvent(ctx, 'papa', allDay('2026-09-29', '2026-09-29'))).event.busy).toBe(
      false,
    );
    expect((await createEvent(ctx, 'papa', allDay('2026-09-28', '2026-09-30'))).event.busy).toBe(
      true,
    );
  });

  it('memberIds は作成順に並ぶ', async () => {
    const { event } = await createEvent(
      ctx,
      'papa',
      timed('2026-09-29', '10:00', null, { memberIds: [IDS.haru, IDS.papa, IDS.mama] }),
    );
    expect(event.memberIds).toEqual([IDS.papa, IDS.mama, IDS.haru]);
  });

  it.each([
    ['件名が空', { ...timed('2026-09-29', '10:00', null), title: '  ' }],
    ['終わりが始まりより前', timed('2026-09-29', '10:00', '09:00')],
    [
      '翌日 24:00 を超える時刻予定',
      { ...timed('2026-09-29', '10:00', null), endAt: '2026-10-01T00:30:00+09:00' },
    ],
    [
      '終日なのに時刻',
      { ...allDay('2026-09-29', '2026-09-29'), startAt: '2026-09-29T10:00:00+09:00' },
    ],
    ['終日の終わりが始まりより前', allDay('2026-09-29', '2026-09-28')],
    [
      '非公開なのにほかの人が担当',
      timed('2026-09-29', '10:00', null, { visibility: 'private', memberIds: [IDS.mama] }),
    ],
    ['知らないキー', { ...timed('2026-09-29', '10:00', null), color: 'red' }],
    [
      '家族にいない人',
      timed('2026-09-29', '10:00', null, { memberIds: ['0192f5a0-1c00-7000-8000-00000000ffff'] }),
    ],
    ['担当なし', timed('2026-09-29', '10:00', null, { memberIds: [] })],
    ['繰り返し（Phase 3 まで）', timed('2026-09-29', '10:00', null, { rrule: 'FREQ=WEEKLY' })],
    ['101 文字の件名', { ...timed('2026-09-29', '10:00', null), title: 'あ'.repeat(101) }],
  ])('%s は 422', async (_label, input) => {
    const { res } = await createEvent(ctx, 'papa', input);
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('翌日の 24:00 ちょうどまでは作れる', async () => {
    const { res } = await createEvent(ctx, 'papa', {
      ...timed('2026-09-29', '22:00', null),
      endAt: '2026-10-01T00:00:00+09:00',
    });
    expect(res.status).toBe(201);
  });

  it('非公開なら全員にはならない', async () => {
    const { event } = await createEvent(
      ctx,
      'yuki',
      timed('2026-09-29', '17:00', null, { visibility: 'private', forEveryone: true }),
    );
    expect(event).toMatchObject({
      visibility: 'private',
      forEveryone: false,
      memberIds: [IDS.yuki],
    });
  });

  it('Idempotency-Key がなければ 400、同じキーは同じ応答で 1 件だけ', async () => {
    const noKey = await send(ctx, 'POST', '/api/events', {
      headers: as('papa'),
      body: timed('2026-09-29', '10:00', null),
    });
    expect(noKey.status).toBe(400);
    const headers = { ...as('papa'), 'idempotency-key': 'same-key' };
    const first = await send(ctx, 'POST', '/api/events', {
      headers,
      body: timed('2026-09-29', '10:00', null),
    });
    const second = await send(ctx, 'POST', '/api/events', {
      headers,
      body: timed('2026-09-29', '10:00', null),
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(ctx.database.db.select().from(events).all()).toHaveLength(1);
  });

  it('同じキーでも人が違えば別の要求', async () => {
    const a = await send(ctx, 'POST', '/api/events', {
      headers: { ...as('papa'), 'idempotency-key': 'k' },
      body: timed('2026-09-29', '10:00', null),
    });
    const b = await send(ctx, 'POST', '/api/events', {
      headers: { ...as('mama'), 'idempotency-key': 'k' },
      body: timed('2026-09-29', '10:00', null),
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(ctx.database.db.select().from(events).all()).toHaveLength(2);
  });

  it('クライアントが振った id で作れる（オフライン作成）。使われている id は 422', async () => {
    const id = '0192f5b1-0000-7000-8000-00000000abcd';
    const a = await createEvent(ctx, 'papa', { ...timed('2026-09-29', '10:00', null), id });
    expect(a.event.id).toBe(id);
    const b = await createEvent(ctx, 'mama', { ...timed('2026-09-29', '11:00', null), id });
    expect(b.res.status).toBe(422);
  });

  it('1 メンバーの作成は 60 件/分まで（61 件目は 429 と Retry-After）', async () => {
    for (let i = 0; i < 60; i++) {
      const { res } = await createEvent(ctx, 'papa', timed('2026-09-29', '10:00', null));
      expect(res.status).toBe(201);
    }
    const { res } = await createEvent(ctx, 'papa', timed('2026-09-29', '10:00', null));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    // ほかの人は作れる
    expect((await createEvent(ctx, 'mama', timed('2026-09-29', '10:00', null))).res.status).toBe(
      201,
    );
    // 1 分たてば作れる
    ctx.clock.advance(61_000);
    expect((await createEvent(ctx, 'papa', timed('2026-09-29', '10:00', null))).res.status).toBe(
      201,
    );
  });
});

describe('更新・削除・楽観ロック（§12・§13）', () => {
  it('If-Match が合えば更新して version が上がる。古ければ 409 と最新版、なければ 428', async () => {
    const { event } = await createEvent(
      ctx,
      'mama',
      timed('2026-09-29', '08:00', null, { title: '会議' }),
    );
    const ok = await patchEvent(ctx, 'papa', event.id, 1, { startAt: '2026-09-29T07:00:00+09:00' });
    expect(ok.status).toBe(200);
    const updated = (await body<{ event: EventDTO }>(ok)).event;
    expect(updated).toMatchObject({
      version: 2,
      updatedBy: IDS.papa,
      startAt: '2026-09-29T07:00:00+09:00',
    });

    const stale = await patchEvent(ctx, 'mama', event.id, 1, { title: '会議（変更）' });
    expect(stale.status).toBe(409);
    const conflict = await body<{ code: string; event: EventDTO }>(stale);
    expect(conflict.code).toBe('conflict');
    expect(conflict.event).toMatchObject({ version: 2, title: '会議' });

    const none = await patchEvent(ctx, 'mama', event.id, null, { title: 'x' });
    expect(none.status).toBe(428);
    const bad = await patchEvent(
      ctx,
      'mama',
      event.id,
      null,
      { title: 'x' },
      { 'if-match': 'abc' },
    );
    expect(bad.status).toBe(422);
  });

  it('If-Match は "2" や W/"2" でもよい', async () => {
    const { event } = await createEvent(ctx, 'mama', timed('2026-09-29', '08:00', null));
    expect(
      (await patchEvent(ctx, 'mama', event.id, null, { title: 'a' }, { 'if-match': '"1"' })).status,
    ).toBe(200);
    expect(
      (await patchEvent(ctx, 'mama', event.id, null, { title: 'b' }, { 'if-match': 'W/"2"' }))
        .status,
    ).toBe(200);
  });

  it('更新の再送（同じ Idempotency-Key）は自分の変更と 409 にならない', async () => {
    const { event } = await createEvent(ctx, 'mama', timed('2026-09-29', '08:00', null));
    const extra = { 'idempotency-key': 'patch-1' };
    const first = await patchEvent(ctx, 'mama', event.id, 1, { title: 'A' }, extra);
    const retry = await patchEvent(ctx, 'mama', event.id, 1, { title: 'A' }, extra);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
  });

  it('終日 ↔ 時刻ありの切り替え', async () => {
    const { event } = await createEvent(ctx, 'papa', timed('2026-09-29', '08:00', null));
    const toAllDay = await patchEvent(ctx, 'papa', event.id, 1, {
      allDay: true,
      startDate: '2026-09-29',
      endDate: '2026-09-30',
    });
    expect(toAllDay.status).toBe(200);
    const e2 = (await body<{ event: EventDTO }>(toAllDay)).event;
    expect(e2).toMatchObject({ allDay: true, startDate: '2026-09-29', endDate: '2026-09-30' });
    expect(e2.startAt).toBeUndefined();
    const back = await patchEvent(ctx, 'papa', event.id, 2, {
      allDay: false,
      startAt: '2026-09-29T09:00:00+09:00',
    });
    expect(back.status).toBe(200);
    expect((await body<{ event: EventDTO }>(back)).event).toMatchObject({
      allDay: false,
      startAt: '2026-09-29T09:00:00+09:00',
      endAt: null,
    });
    // 時刻ありの予定に日付だけ送るのは 422
    expect((await patchEvent(ctx, 'papa', event.id, 3, { startDate: '2026-09-30' })).status).toBe(
      422,
    );
  });

  it('削除 → ゴミ箱 → 元に戻す。消した予定の更新・削除は 410、ない予定は 404', async () => {
    const { event } = await createEvent(
      ctx,
      'mama',
      timed('2026-09-29', '08:00', null, { title: '買い物' }),
    );
    const del = await deleteEvent(ctx, 'papa', event.id, 1);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ id: event.id, version: 2 });
    expect((await syncAs(ctx, 'mama')).events).toHaveLength(0);

    const trash = await body<{ items: { event: EventDTO; deletedBy: string }[] }>(
      await send(ctx, 'GET', '/api/trash', { headers: as('mama') }),
    );
    expect(trash.items).toHaveLength(1);
    expect(trash.items[0]).toMatchObject({ deletedBy: IDS.papa, event: { title: '買い物' } });

    expect((await patchEvent(ctx, 'mama', event.id, 2, { title: 'x' })).status).toBe(410);
    expect((await deleteEvent(ctx, 'mama', event.id, 2)).status).toBe(410);

    const restored = await send(ctx, 'POST', `/api/events/${event.id}/restore`, {
      headers: as('mama'),
    });
    expect(restored.status).toBe(200);
    expect((await body<{ event: EventDTO }>(restored)).event).toMatchObject({
      version: 3,
      title: '買い物',
    });
    expect((await syncAs(ctx, 'papa')).events.map((e) => e.id)).toEqual([event.id]);

    expect((await deleteEvent(ctx, 'mama', '0192f5b1-0000-7000-8000-0000000000ff', 1)).status).toBe(
      404,
    );
  });

  it('30 日を過ぎたゴミ箱の予定は出さず、戻せない', async () => {
    const { event } = await createEvent(ctx, 'mama', timed('2026-09-29', '08:00', null));
    await deleteEvent(ctx, 'mama', event.id, 1);
    ctx.clock.advance(31 * 24 * 60 * 60 * 1000);
    const trash = await body<{ items: unknown[] }>(
      await send(ctx, 'GET', '/api/trash', { headers: as('mama') }),
    );
    expect(trash.items).toHaveLength(0);
    expect(
      (await send(ctx, 'POST', `/api/events/${event.id}/restore`, { headers: as('mama') })).status,
    ).toBe(410);
  });

  it('公開・非公開を変えられるのは作った人だけ', async () => {
    const { event } = await createEvent(
      ctx,
      'mama',
      timed('2026-09-29', '08:00', null, { memberIds: [IDS.mama] }),
    );
    expect((await patchEvent(ctx, 'papa', event.id, 1, { visibility: 'private' })).status).toBe(
      403,
    );
    expect((await patchEvent(ctx, 'mama', event.id, 1, { visibility: 'private' })).status).toBe(
      200,
    );
  });
});

describe('他人の非公開（§10・§14。T5）', () => {
  async function secret() {
    const { event } = await createEvent(
      ctx,
      'yuki',
      timed('2026-09-29', '17:00', '18:00', {
        title: 'プレゼント選び',
        note: 'お母さんに',
        location: '駅前',
        visibility: 'private',
      }),
    );
    return event;
  }

  function expectMasked(e: EventDTO) {
    expect(e).toMatchObject({
      title: null,
      note: null,
      location: null,
      memberIds: [IDS.yuki],
      forEveryone: false,
      visibility: 'private',
      ownerId: IDS.yuki,
      createdBy: IDS.yuki,
      updatedBy: IDS.yuki,
      createdAt: null,
      updatedAt: null,
    });
    expect(JSON.stringify(e)).not.toMatch(/プレゼント|お母さんに|駅前/);
  }

  it('同期では「予定あり」の形だけ（持ち主には中身）', async () => {
    const event = await secret();
    const mamaView = await syncAs(ctx, 'mama');
    const seen = mamaView.events.find((e) => e.id === event.id) as EventDTO;
    expectMasked(seen);
    expect(seen.startAt).toBe('2026-09-29T17:00:00+09:00');
    const own = (await syncAs(ctx, 'yuki')).events.find((e) => e.id === event.id);
    expect(own?.title).toBe('プレゼント選び');
  });

  it('他人の非公開の更新・削除・復元は 409 ではなく 403（古い If-Match でも）', async () => {
    const event = await secret();
    await patchEvent(ctx, 'yuki', event.id, 1, { note: '変更' });
    const res = await patchEvent(ctx, 'mama', event.id, 1, { title: '見たい' });
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toMatch(/プレゼント|お母さんに|駅前/);
    expect((await deleteEvent(ctx, 'mama', event.id, 1)).status).toBe(403);
    expect((await patchEvent(ctx, 'mama', event.id, null, { title: 'x' })).status).toBe(403);
    await deleteEvent(ctx, 'yuki', event.id, 2);
    expect(
      (await send(ctx, 'POST', `/api/events/${event.id}/restore`, { headers: as('mama') })).status,
    ).toBe(403);
  });

  it('409 の本文は投影した最新版（持ち主が非公開にした予定）', async () => {
    const { event } = await createEvent(
      ctx,
      'yuki',
      timed('2026-09-29', '17:00', null, { title: '公開の予定' }),
    );
    await patchEvent(ctx, 'yuki', event.id, 1, { visibility: 'private', title: '内緒にした' });
    // mama は古い版で更新しようとする → 認可で 403（非公開になったので）
    const res = await patchEvent(ctx, 'mama', event.id, 1, { title: 'x' });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('内緒にした');
  });

  it('409 の本文でも他人の非公開は出ない（家族の予定の 409 の本文の形）', async () => {
    const { event } = await createEvent(
      ctx,
      'mama',
      timed('2026-09-29', '08:00', null, { title: '家族の予定' }),
    );
    await patchEvent(ctx, 'mama', event.id, 1, { title: '家族の予定2' });
    const res = await patchEvent(ctx, 'papa', event.id, 1, { title: 'x' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { event: EventDTO }).event.title).toBe('家族の予定2');
  });

  it('ゴミ箱に他人の非公開は出ない', async () => {
    const event = await secret();
    await deleteEvent(ctx, 'yuki', event.id, 1);
    const mamaTrash = await send(ctx, 'GET', '/api/trash', { headers: as('mama') });
    expect(await mamaTrash.text()).not.toMatch(/プレゼント|お母さんに|駅前/);
    const own = await body<{ items: unknown[] }>(
      await send(ctx, 'GET', '/api/trash', { headers: as('yuki') }),
    );
    expect(own.items).toHaveLength(1);
  });

  it('履歴では他人の非公開は出ない（持ち主には出る）', async () => {
    const event = await secret();
    await patchEvent(ctx, 'yuki', event.id, 1, { title: 'プレゼント選び2' });
    const mamaActivity = await send(ctx, 'GET', '/api/activity', { headers: as('mama') });
    const text = await mamaActivity.text();
    expect(text).not.toMatch(/プレゼント|お母さんに|駅前/);
    expect(JSON.parse(text).items).toHaveLength(0);
    const own = await body<{ items: unknown[] }>(
      await send(ctx, 'GET', '/api/activity', { headers: as('yuki') }),
    );
    expect(own.items).toHaveLength(2);
  });

  it('非公開の予定を件名を変えながら公開しても、ほかの家族の履歴に非公開だったときの件名・場所・メモは出ない', async () => {
    const event = await secret();
    const res = await patchEvent(ctx, 'yuki', event.id, 1, {
      visibility: 'family',
      title: '家族で買い物',
      location: null,
      note: null,
    });
    expect(res.status).toBe(200);
    const mamaActivity = await send(ctx, 'GET', '/api/activity', { headers: as('mama') });
    const text = await mamaActivity.text();
    expect(text).not.toMatch(/プレゼント|お母さんに|駅前/);
    const items = JSON.parse(text).items as { title: string; detail: string | null }[];
    expect(items.map((i) => [i.title, i.detail])).toEqual([['家族で買い物', '家族に公開した']]);
    // 持ち主には全部の差分が残る
    const own = await body<{ items: { detail: string | null }[] }>(
      await send(ctx, 'GET', '/api/activity', { headers: as('yuki') }),
    );
    expect(
      own.items.some((i) => i.detail?.includes('件名「プレゼント選び」→「家族で買い物」')),
    ).toBe(true);
  });

  it('家族の予定を非公開にしたら、それまでの履歴もほかの家族から見えなくなる', async () => {
    const { event } = await createEvent(
      ctx,
      'yuki',
      timed('2026-09-29', '17:00', null, { title: '誕生日の準備', memberIds: [IDS.yuki] }),
    );
    await patchEvent(ctx, 'yuki', event.id, 1, { title: '誕生日の準備2' });
    await patchEvent(ctx, 'yuki', event.id, 2, { visibility: 'private' });
    const mamaActivity = await send(ctx, 'GET', '/api/activity', { headers: as('mama') });
    const text = await mamaActivity.text();
    expect(text).not.toContain('誕生日の準備');
    expect((await syncAs(ctx, 'mama')).unreadActivity).toBe(0);
  });

  it('差分同期でも投影される', async () => {
    await createEvent(ctx, 'mama', timed('2026-09-28', '08:00', null));
    const start = (await syncAs(ctx, 'mama')).cursor;
    expect(start).toBeGreaterThan(0);
    const event = await secret();
    const diff = await syncAs(ctx, 'mama', start);
    expect(diff.full).toBe(false);
    expectMasked(diff.events.find((e) => e.id === event.id) as EventDTO);
  });
});

describe('履歴（§13 /api/activity）', () => {
  it('作成・更新・削除・復元が残り、差分は人が読める文字列。既読で未読数が 0 になる', async () => {
    const { event } = await createEvent(
      ctx,
      'mama',
      timed('2026-09-29', '08:00', '09:00', { title: '会議', memberIds: [IDS.mama] }),
    );
    await patchEvent(ctx, 'mama', event.id, 1, {
      startAt: '2026-09-29T07:00:00+09:00',
      memberIds: [IDS.mama, IDS.papa],
    });
    await deleteEvent(ctx, 'mama', event.id, 2);
    await send(ctx, 'POST', `/api/events/${event.id}/restore`, { headers: as('mama') });

    const page = await body<{
      items: { action: string; detail: string | null; unread: boolean; title: string }[];
    }>(await send(ctx, 'GET', '/api/activity', { headers: as('papa') }));
    expect(page.items.map((i) => i.action)).toEqual(['restore', 'delete', 'update', 'create']);
    expect(page.items[2]?.detail).toContain('開始 8:00 → 7:00');
    expect(page.items[2]?.detail).toContain('担当 お母さん → お父さん・お母さん');
    expect(page.items.every((i) => i.unread)).toBe(true);
    expect((await syncAs(ctx, 'papa')).unreadActivity).toBe(4);
    // 自分の変更は未読に数えない
    expect((await syncAs(ctx, 'mama')).unreadActivity).toBe(0);

    const read = await send(ctx, 'POST', '/api/activity/read', { headers: as('papa') });
    expect(await read.json()).toEqual({ unreadActivity: 0 });
    expect((await syncAs(ctx, 'papa')).unreadActivity).toBe(0);
  });

  it('50 件ずつ、before で続きを取る', async () => {
    for (let i = 0; i < 55; i++) {
      await createEvent(ctx, i % 2 ? 'mama' : 'haru', timed('2026-09-29', '08:00', null));
      ctx.clock.advance(10);
    }
    const first = await body<{ items: { id: string }[]; nextBefore: string | null }>(
      await send(ctx, 'GET', '/api/activity', { headers: as('papa') }),
    );
    expect(first.items).toHaveLength(50);
    expect(first.nextBefore).not.toBeNull();
    const second = await body<{ items: { id: string }[]; nextBefore: string | null }>(
      await send(ctx, 'GET', `/api/activity?before=${first.nextBefore}`, { headers: as('papa') }),
    );
    expect(second.items).toHaveLength(5);
    expect(second.nextBefore).toBeNull();
    expect((await send(ctx, 'GET', '/api/activity?limit=51', { headers: as('papa') })).status).toBe(
      422,
    );
  });
});

describe('差分同期（§12 /api/sync）', () => {
  it('cursor=0 は全件、そのあとは変わった予定と消した ID だけ', async () => {
    const a = await createEvent(ctx, 'mama', timed('2026-09-29', '08:00', null, { title: 'A' }));
    const b = await createEvent(ctx, 'mama', timed('2026-09-29', '09:00', null, { title: 'B' }));
    const first = await syncAs(ctx, 'papa');
    expect(first.full).toBe(true);
    expect(first.events).toHaveLength(2);
    expect(first.members.map((m) => m.name)).toEqual(['お父さん', 'お母さん', 'ゆき', 'はる']);

    await patchEvent(ctx, 'mama', a.event.id, 1, { title: 'A2' });
    await deleteEvent(ctx, 'mama', b.event.id, 1);
    const c = await createEvent(ctx, 'haru', timed('2026-09-30', '09:00', null, { title: 'C' }));
    const diff = await syncAs(ctx, 'papa', first.cursor);
    expect(diff.full).toBe(false);
    expect(diff.events.map((e) => e.title).sort()).toEqual(['A2', 'C']);
    expect(diff.deletedEventIds).toEqual([b.event.id]);
    expect(diff.cursor).toBeGreaterThan(first.cursor);

    const nothing = await syncAs(ctx, 'papa', diff.cursor);
    expect(nothing).toMatchObject({ full: false, events: [], deletedEventIds: [] });
    expect(c.event.title).toBe('C');
  });

  it('古すぎるカーソル（changes が消えている）と未来のカーソルは全件', async () => {
    await createEvent(ctx, 'mama', timed('2026-09-29', '08:00', null));
    const first = await syncAs(ctx, 'papa');
    await createEvent(ctx, 'mama', timed('2026-09-29', '09:00', null));
    await createEvent(ctx, 'mama', timed('2026-09-29', '10:00', null));
    // 掃除で古い changes が消えた
    ctx.database.db.delete(changes).run();
    await createEvent(ctx, 'mama', timed('2026-09-29', '11:00', null));
    const old = await syncAs(ctx, 'papa', first.cursor);
    expect(old.full).toBe(true);
    expect(old.events).toHaveLength(4);
    const future = await syncAs(ctx, 'papa', 999_999);
    expect(future.full).toBe(true);
  });

  it('cursor が数でなければ 422', async () => {
    expect((await send(ctx, 'GET', '/api/sync?cursor=abc', { headers: as('papa') })).status).toBe(
      422,
    );
    expect((await send(ctx, 'GET', '/api/sync?cursor=1&x=1', { headers: as('papa') })).status).toBe(
      422,
    );
  });
});
