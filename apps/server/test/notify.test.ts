import { type EventDTO, fromJst, type PushPayload } from '@ito/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { notificationLog, pendingNotices, pushSubscriptions } from '../src/db/schema';
import type { PushOptions, PushResult, PushSender, PushTarget } from '../src/services/push-sender';
import { createScheduler, type Scheduler } from '../src/services/scheduler';
import { allDay, as, createEvent, IDS, patchEvent, seedFamily, timed, type Who } from './family';
import { createTestContext, devEnv, send, type TestContext } from './helpers';

/** 記録するだけの送信（RUNBOOK Phase 4）。next で endpoint ごとの結果を決める */
class FakeSender implements PushSender {
  sent: { endpoint: string; payload: PushPayload; options: PushOptions }[] = [];
  next: (endpoint: string) => PushResult = () => ({ kind: 'ok' });
  async send(target: PushTarget, payload: PushPayload, options: PushOptions): Promise<PushResult> {
    this.sent.push({ endpoint: target.endpoint, payload, options });
    return this.next(target.endpoint);
  }
  to(who: Who) {
    return this.sent.filter((s) => s.endpoint === endpointOf(who));
  }
  clear() {
    this.sent = [];
  }
}

const endpointOf = (who: Who) => `https://push.example.com/send/${who}`;
const P256DH = `B${'A'.repeat(86)}`;
const AUTH = 'AAAAAAAAAAAAAAAAAAAAAA';

let ctx: TestContext;
let sender: FakeSender;
let scheduler: Scheduler;

const PUBLIC_KEY = `B${'x'.repeat(86)}`;

function at(date: string, time: string) {
  ctx.clock.set(fromJst(date, time));
}

async function subscribe(who: Who, label = 'iPhone') {
  const res = await send(ctx, 'POST', '/api/push/subscriptions', {
    headers: as(who),
    body: { endpoint: endpointOf(who), keys: { p256dh: P256DH, auth: AUTH }, label },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

async function setNotifications(who: Who, notifications: Record<string, unknown>) {
  const res = await send(ctx, 'PATCH', '/api/me', {
    headers: as(who),
    body: { settings: { notifications } },
  });
  expect(res.status).toBe(200);
}

async function setReminders(who: Who, eventId: string, offsets: number[]) {
  const res = await send(ctx, 'PUT', `/api/events/${eventId}/reminders`, {
    headers: as(who),
    body: { offsets },
  });
  expect(res.status).toBe(200);
}

async function make(who: Who, body: Record<string, unknown>): Promise<EventDTO> {
  const { res, event } = await createEvent(ctx, who, body);
  expect(res.status).toBe(201);
  return event;
}

beforeEach(async () => {
  sender = new FakeSender();
  ctx = createTestContext(devEnv(), {
    now: fromJst('2026-09-27', '14:18'),
    push: { publicKey: PUBLIC_KEY, sender },
  });
  seedFamily(ctx);
  scheduler = createScheduler({
    db: ctx.database.db,
    clock: ctx.clock,
    sender,
    logger: ctx.logger,
  });
  // 家族の変更通知はこのファイルの多くのテストでは見ない（見るテストで設定し直す）
  for (const who of ['papa', 'mama', 'yuki', 'haru'] as const) {
    await setNotifications(who, {
      familyChanges: 'off',
      morningDigest: { enabled: false, time: '07:00' },
    });
    await subscribe(who);
  }
});
afterEach(async () => {
  await scheduler.stop();
  ctx.close();
});

describe('予定の通知（§15・§21 通知）', () => {
  it('開始時（offset 0）に送る。TTL は開始までの秒数（最低 60 秒）・urgency high', async () => {
    const e = await make('papa', timed('2026-09-28', '10:00', '11:00', { title: '歯医者' }));
    await setReminders('papa', e.id, [0]);
    at('2026-09-28', '09:59');
    await scheduler.tick();
    expect(sender.to('papa')).toEqual([]);
    at('2026-09-28', '10:00');
    await scheduler.tick();
    const [s] = sender.to('papa');
    expect(s?.payload).toMatchObject({
      v: 1,
      kind: 'reminder',
      title: '歯医者',
      url: `/e/${e.id}`,
      tag: `rem:${e.id}`,
    });
    expect(s?.payload.body).toContain('今日 10:00〜11:00');
    expect(s?.options).toEqual({ TTL: 60, urgency: 'high' });
    // 既定の -30 は、本人の行（[0]）があるので送らない
    expect(sender.sent).toHaveLength(1);
  });

  it('既定値（担当者に -30）は、開始までの秒数を TTL にする', async () => {
    await make('papa', timed('2026-09-28', '10:00', null, { title: '会議' }));
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(sender.to('papa').map((s) => s.options)).toEqual([{ TTL: 1800, urgency: 'high' }]);
    // 担当でない人には送らない
    expect(sender.to('mama')).toEqual([]);
  });

  it('終日の前日 20:00（-240・既定）と当日 7:00（+420）が送られる', async () => {
    const e = await make('mama', allDay('2026-09-29', '2026-09-29', { title: '健康診断' }));
    // 担当外の父は自分で当日 7:00 を付ける
    await setReminders('papa', e.id, [420]);
    at('2026-09-28', '20:00');
    await scheduler.tick();
    expect(sender.to('mama').map((s) => s.payload.body)).toEqual([
      '明日（終日）（前日 20:00の通知）',
    ]);
    expect(sender.to('papa')).toEqual([]);
    at('2026-09-29', '07:00');
    await scheduler.tick();
    expect(sender.to('papa').map((s) => s.payload.body)).toEqual([
      '今日（終日）（当日 7:00の通知）',
    ]);
    expect(sender.to('mama')).toHaveLength(1);
  });

  it('同じ回は二度送らない（次の実行・10 分以内のずれでも）', async () => {
    await make('papa', timed('2026-09-28', '10:00', null));
    at('2026-09-28', '09:30');
    await scheduler.tick();
    await scheduler.tick();
    at('2026-09-28', '09:35');
    await scheduler.tick();
    expect(sender.to('papa')).toHaveLength(1);
  });

  it('予定を動かしたら新しい時刻で送る', async () => {
    const e = await make('papa', timed('2026-09-28', '10:00', null));
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(sender.to('papa')).toHaveLength(1);
    const res = await patchEvent(ctx, 'papa', e.id, e.version, {
      startAt: '2026-09-28T11:00:00+09:00',
    });
    expect(res.status).toBe(200);
    at('2026-09-28', '10:30');
    await scheduler.tick();
    expect(sender.to('papa')).toHaveLength(2);
    expect(sender.to('papa')[1]?.payload.body).toContain('11:00');
  });

  it('5xx のあとは 10 分以内なら次の実行で再送し、log は届いてから書く', async () => {
    await make('papa', timed('2026-09-28', '10:00', null));
    sender.next = () => ({ kind: 'retry', status: 503 });
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(logKeys()).toEqual([]);
    at('2026-09-28', '09:31');
    await scheduler.tick();
    sender.next = () => ({ kind: 'ok' });
    at('2026-09-28', '09:32');
    await scheduler.tick();
    expect(sender.to('papa')).toHaveLength(3);
    expect(logKeys()).toHaveLength(1);
    // 届いたら失敗の数は 0 に戻る
    expect(subscriptionOf('papa')?.failCount).toBe(0);
    at('2026-09-28', '09:33');
    await scheduler.tick();
    expect(sender.to('papa')).toHaveLength(3);
  });

  it('5xx が続いて 10 分を過ぎたら諦める', async () => {
    await make('papa', timed('2026-09-28', '10:00', null));
    sender.next = () => ({ kind: 'retry', status: 500 });
    at('2026-09-28', '09:30');
    await scheduler.tick();
    // 次の実行までに 10 分が過ぎた（再起動など）
    sender.next = () => ({ kind: 'ok' });
    at('2026-09-28', '09:40');
    await scheduler.tick();
    expect(sender.to('papa')).toHaveLength(1);
    expect(logKeys()).toEqual([]);
  });

  it('再起動しても、10 分以内のものは送り、それより古いものは送らない', async () => {
    await make('papa', timed('2026-09-28', '10:00', null, { title: 'A' }));
    await make('papa', timed('2026-09-28', '10:15', null, { title: 'B' }));
    // 9:30（A の通知）と 9:45（B の通知）のあいだ止まっていて、9:50 に動き出した
    at('2026-09-28', '09:50');
    await scheduler.tick();
    expect(sender.to('papa').map((s) => s.payload.title)).toEqual(['B']);
  });

  it('404/410 は購読を消して log を書く（再送しない）', async () => {
    await make('papa', timed('2026-09-28', '10:00', null));
    sender.next = () => ({ kind: 'gone', status: 410 });
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(subscriptionOf('papa')).toBeUndefined();
    expect(logKeys()).toHaveLength(1);
  });

  it('失敗が 5 回を超えた購読には送らず、ログに残す', async () => {
    ctx.database.db
      .update(pushSubscriptions)
      .set({ failCount: 6 })
      .where(eq(pushSubscriptions.memberId, IDS.papa))
      .run();
    await make('papa', timed('2026-09-28', '10:00', null));
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(sender.to('papa')).toEqual([]);
    // 登録し直すと（起動・前面復帰の upsert）、また送る
    await subscribe('papa');
    at('2026-09-28', '09:31');
    await scheduler.tick();
    expect(sender.to('papa')).toHaveLength(1);
  });

  it('繰り返しは回ごとに送り、取り消した回には送らず、この回だけ変更した回は動かした時刻で送る', async () => {
    const e = await make(
      'papa',
      timed('2026-09-28', '07:30', null, { title: '燃えるゴミ', rrule: 'FREQ=DAILY;COUNT=5' }),
    );
    // 9/29 の回を取り消し、9/30 の回を 8:00 に
    let res = await send(
      ctx,
      'DELETE',
      `/api/events/${e.id}?scope=this&recurrenceId=2026-09-29T07:30`,
      { headers: { ...as('papa'), 'if-match': String(e.version) } },
    );
    expect(res.status).toBe(200);
    res = await send(ctx, 'PATCH', `/api/events/${e.id}`, {
      headers: { ...as('papa'), 'if-match': String(e.version + 1) },
      body: {
        scope: 'this',
        recurrenceId: '2026-09-30T07:30',
        changes: { startAt: '2026-09-30T08:00:00+09:00' },
      },
    });
    expect(res.status).toBe(200);
    for (const [d, t] of [
      ['2026-09-28', '07:00'],
      ['2026-09-29', '07:00'],
      ['2026-09-30', '07:00'],
      ['2026-09-30', '07:30'],
    ] as const) {
      at(d, t);
      await scheduler.tick();
    }
    expect(sender.to('papa').map((s) => [s.payload.tag, s.payload.url])).toEqual([
      [`rem:${e.id}@2026-09-28T07:30`, `/e/${e.id}?r=2026-09-28T07%3A30`],
      [`rem:${e.id}@2026-09-30T07:30`, `/e/${e.id}?r=2026-09-30T07%3A30`],
    ]);
    expect(sender.to('papa')[1]?.payload.body).toContain('8:00');
  });

  it('非公開: 持ち主には件名で送り、ほかの家族には通知を付けられない', async () => {
    const e = await make(
      'haru',
      timed('2026-09-28', '10:00', null, { title: 'プレゼント選び', visibility: 'private' }),
    );
    const res = await send(ctx, 'PUT', `/api/events/${e.id}/reminders`, {
      headers: as('papa'),
      body: { offsets: [0] },
    });
    expect(res.status).toBe(403);
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(sender.to('haru').map((s) => s.payload.title)).toEqual(['プレゼント選び']);
    expect(sender.sent).toHaveLength(1);
  });

  it('ロック画面に予定名を出さない設定なら「いと」「予定の通知があります」', async () => {
    await setNotifications('papa', { showDetailsOnLockScreen: false });
    await make('papa', timed('2026-09-28', '10:00', null, { title: '歯医者' }));
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(sender.to('papa')[0]?.payload).toMatchObject({
      title: 'いと',
      body: '予定の通知があります',
    });
  });

  it('無効化したメンバーには送らない（購読も消える）', async () => {
    await make('papa', timed('2026-09-28', '10:00', null, { forEveryone: true }));
    const res = await send(ctx, 'PATCH', `/api/members/${IDS.mama}`, {
      headers: as('papa'),
      body: { disabled: true },
    });
    expect(res.status).toBe(200);
    expect(subscriptionOf('mama')).toBeUndefined();
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(sender.to('mama')).toEqual([]);
    expect(sender.to('papa')).toHaveLength(1);
  });

  it('ログに予定名・endpoint を出さない', async () => {
    await make('papa', timed('2026-09-28', '10:00', null, { title: '秘密の歯医者' }));
    at('2026-09-28', '09:30');
    await scheduler.tick();
    expect(sender.sent).toHaveLength(1);
    expect(ctx.logs.text).not.toContain('秘密の歯医者');
    expect(ctx.logs.text).not.toContain('push.example.com');
    expect(ctx.logs.text).toContain('"kind":"reminder"');
  });
});

describe('朝のまとめ・前夜の予告', () => {
  it('朝のまとめと前夜の予告が両方届く（件数と先頭 3 件、TTL 6 時間・normal）', async () => {
    await setNotifications('mama', {
      morningDigest: { enabled: true, time: '07:00' },
      eveningPreview: { enabled: true, time: '21:00' },
    });
    await make('papa', timed('2026-09-28', '19:00', null, { title: '夕食', forEveryone: true }));
    await make('papa', timed('2026-09-28', '08:00', null, { title: '会議' }));
    await make(
      'haru',
      timed('2026-09-28', '10:00', null, { title: '内緒', visibility: 'private' }),
    );
    await make('papa', allDay('2026-09-28', '2026-09-28', { title: '父の日' }));
    await make('papa', timed('2026-09-29', '09:00', null, { title: '明日の予定' }));
    at('2026-09-28', '07:00');
    await scheduler.tick();
    const morning = sender.to('mama');
    expect(morning.map((s) => s.payload)).toEqual([
      {
        v: 1,
        kind: 'digest',
        title: '今日の予定 4件',
        body: '終日 父の日\n8:00 会議\n10:00 予定あり\nほか 1件',
        url: '/',
        tag: 'digest:morning',
        badge: expect.any(Number),
      },
    ]);
    expect(morning[0]?.options).toEqual({ TTL: 21600, urgency: 'normal' });
    at('2026-09-28', '21:00');
    await scheduler.tick();
    expect(sender.to('mama').map((s) => [s.payload.title, s.payload.body])).toEqual([
      ['今日の予定 4件', '終日 父の日\n8:00 会議\n10:00 予定あり\nほか 1件'],
      ['明日の予定 1件', '9:00 明日の予定'],
    ]);
    // 同じ日は二度送らない
    at('2026-09-28', '21:05');
    await scheduler.tick();
    expect(sender.to('mama')).toHaveLength(2);
  });

  it('予定がない日は送らない。時刻を少し過ぎて動き出しても 10 分以内なら送る', async () => {
    await setNotifications('mama', { morningDigest: { enabled: true, time: '07:00' } });
    at('2026-09-28', '07:00');
    await scheduler.tick();
    expect(sender.to('mama')).toEqual([]);
    await make('papa', timed('2026-09-28', '12:00', null, { title: '昼' }));
    at('2026-09-28', '07:09');
    await scheduler.tick();
    expect(sender.to('mama').map((s) => s.payload.title)).toEqual(['今日の予定 1件']);
  });

  it('持ち主は自分の非公開の件名をまとめで見られる', async () => {
    await setNotifications('haru', { morningDigest: { enabled: true, time: '06:30' } });
    await make(
      'haru',
      timed('2026-09-28', '10:00', null, { title: '内緒', visibility: 'private' }),
    );
    at('2026-09-28', '06:30');
    await scheduler.tick();
    expect(sender.to('haru').map((s) => s.payload.body)).toEqual(['10:00 内緒']);
  });
});

describe('家族の変更（2 分まとめ・静かな時間）', () => {
  it('最後の変更から 2 分待って 1 通にまとめる。自分の変更では送らない', async () => {
    await setNotifications('papa', { familyChanges: 'all' });
    await setNotifications('mama', { familyChanges: 'all' });
    at('2026-09-28', '10:00');
    const e = await make('mama', timed('2026-09-29', '10:00', null, { title: '歯医者' }));
    at('2026-09-28', '10:01');
    await scheduler.tick();
    expect(sender.sent).toEqual([]);
    // 追加してすぐ直した（同じ予定は 1 件にまとめ、「追加しました」のまま）
    const res = await patchEvent(ctx, 'mama', e.id, e.version, { title: '歯医者（駅前）' });
    expect(res.status).toBe(200);
    await make('mama', timed('2026-09-30', '10:00', null, { title: '美容院' }));
    at('2026-09-28', '10:02');
    await scheduler.tick();
    expect(sender.sent).toEqual([]);
    at('2026-09-28', '10:03');
    await scheduler.tick();
    expect(sender.to('papa').map((s) => s.payload)).toEqual([
      {
        v: 1,
        kind: 'change',
        title: '家族の予定の変更 2件',
        body: 'お母さんが「歯医者（駅前）」を追加しました\nお母さんが「美容院」を追加しました',
        url: '/activity',
        tag: 'change',
        // バッジは未読の履歴の数（追加・変更・追加の 3 件）
        badge: 3,
      },
    ]);
    expect(sender.to('papa')[0]?.options).toEqual({ TTL: 21600, urgency: 'normal' });
    expect(sender.to('mama')).toEqual([]);
    at('2026-09-28', '10:10');
    await scheduler.tick();
    expect(sender.sent).toHaveLength(1);
  });

  it('静かな時間は送らずに待ち、明けたら 1 通にまとめて送る', async () => {
    await setNotifications('papa', { familyChanges: 'all' });
    at('2026-09-28', '22:30');
    const e = await make('mama', timed('2026-09-29', '10:00', null, { title: '歯医者' }));
    at('2026-09-28', '23:00');
    await scheduler.tick();
    at('2026-09-29', '06:59');
    await scheduler.tick();
    expect(sender.sent).toEqual([]);
    at('2026-09-29', '07:00');
    await scheduler.tick();
    expect(sender.to('papa').map((s) => [s.payload.title, s.payload.url])).toEqual([
      ['家族の予定の変更', `/e/${e.id}`],
    ]);
  });

  it('mine は自分が担当（全員の予定を含む）の予定だけ、off は送らない。他人の非公開は「予定あり」', async () => {
    await setNotifications('papa', { familyChanges: 'mine' });
    await setNotifications('yuki', { familyChanges: 'off' });
    await setNotifications('haru', { familyChanges: 'all' });
    at('2026-09-28', '10:00');
    await make('mama', timed('2026-09-29', '10:00', null, { title: 'お母さんだけ' }));
    await make(
      'mama',
      timed('2026-09-29', '11:00', null, { title: 'みんなで', forEveryone: true }),
    );
    await make(
      'mama',
      timed('2026-09-29', '12:00', null, { title: '内緒', visibility: 'private' }),
    );
    at('2026-09-28', '10:05');
    await scheduler.tick();
    expect(sender.to('papa').map((s) => s.payload.body)).toEqual([
      'お母さんが「みんなで」を追加しました',
    ]);
    expect(sender.to('yuki')).toEqual([]);
    expect(sender.to('haru').map((s) => s.payload.body)).toEqual([
      'お母さんが「お母さんだけ」を追加しました\nお母さんが「みんなで」を追加しました\nお母さんが「予定あり」を追加しました',
    ]);
    // まとめ待ちは送ったら片づく
    const left = ctx.database.db.select().from(pendingNotices).all();
    expect(left.every((n) => n.flushedAt !== null)).toBe(true);
  });
});

describe('購読の API（§13）', () => {
  it('endpoint で upsert し、一覧は endpoint を返さず、この端末に印を付ける', async () => {
    const id = await subscribe('papa', 'iPhone');
    expect(await subscribe('papa', 'iPhone')).toBe(id);
    const res = await send(ctx, 'GET', `/api/push/subscriptions?current=${id}`, {
      headers: as('papa'),
    });
    const body = (await res.json()) as { devices: Record<string, unknown>[] };
    expect(body.devices).toEqual([
      {
        id,
        label: 'iPhone',
        lastOkAt: null,
        createdAt: expect.any(String),
        isThisDevice: true,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('push.example.com');
  });

  it('https 以外の endpoint・知らない項目は 422', async () => {
    for (const body of [
      { endpoint: 'http://push.example.com/x', keys: { p256dh: P256DH, auth: AUTH } },
      { endpoint: 'javascript:alert(1)', keys: { p256dh: P256DH, auth: AUTH } },
      { endpoint: endpointOf('papa'), keys: { p256dh: P256DH, auth: AUTH }, extra: 1 },
    ]) {
      const res = await send(ctx, 'POST', '/api/push/subscriptions', { headers: as('papa'), body });
      expect(res.status).toBe(422);
    }
  });

  it('同じ端末を別の家族が使い始めたら、持ち主を付け替える', async () => {
    const res = await send(ctx, 'POST', '/api/push/subscriptions', {
      headers: as('mama'),
      body: { endpoint: endpointOf('papa'), keys: { p256dh: P256DH, auth: AUTH } },
    });
    expect(res.status).toBe(200);
    expect(subscriptionOf('papa')?.memberId).toBe(IDS.mama);
  });

  it('削除は本人と管理者だけ（他人は 403）。管理者はその人の全端末を止められ、無効化でも消える', async () => {
    const mamaSub = subscriptionOf('mama')?.id as string;
    let res = await send(ctx, 'DELETE', `/api/push/subscriptions/${mamaSub}`, {
      headers: as('yuki'),
    });
    expect(res.status).toBe(403);
    res = await send(ctx, 'DELETE', `/api/push/subscriptions/${mamaSub}`, { headers: as('papa') });
    expect(res.status).toBe(204);
    await subscribe('mama');
    res = await send(ctx, 'DELETE', `/api/members/${IDS.mama}/push-subscriptions`, {
      headers: as('yuki'),
    });
    expect(res.status).toBe(403);
    res = await send(ctx, 'GET', '/api/members', { headers: as('papa') });
    const before = (await res.json()) as { members: { id: string; deviceCount: number }[] };
    expect(before.members.find((m) => m.id === IDS.mama)?.deviceCount).toBe(1);
    res = await send(ctx, 'DELETE', `/api/members/${IDS.mama}/push-subscriptions`, {
      headers: as('papa'),
    });
    expect(await res.json()).toEqual({ removed: 1 });
    expect(subscriptionOf('mama')).toBeUndefined();
    // 自分の端末は自分で消せる
    const own = subscriptionOf('yuki')?.id as string;
    res = await send(ctx, 'DELETE', `/api/push/subscriptions/${own}`, { headers: as('yuki') });
    expect(res.status).toBe(204);
  });

  it('公開鍵とテスト通知（自分の全端末に。TTL 10 分・high）', async () => {
    let res = await send(ctx, 'GET', '/api/push/public-key', { headers: as('papa') });
    expect(await res.json()).toEqual({ publicKey: PUBLIC_KEY });
    res = await send(ctx, 'POST', '/api/push/test', { headers: as('papa') });
    expect(await res.json()).toEqual({ result: 'sent' });
    expect(sender.to('papa').map((s) => [s.payload.kind, s.options])).toEqual([
      ['test', { TTL: 600, urgency: 'high' }],
    ]);
    // 押し続けても 5 回/分まで
    for (let i = 0; i < 4; i++) await send(ctx, 'POST', '/api/push/test', { headers: as('papa') });
    res = await send(ctx, 'POST', '/api/push/test', { headers: as('papa') });
    expect(res.status).toBe(429);
  });

  it('VAPID の鍵がなければ、公開鍵は null・テスト通知は unavailable（画面を開くたびに 4xx にしない）', async () => {
    const plain = createTestContext(devEnv());
    seedFamily(plain);
    try {
      let res = await send(plain, 'GET', '/api/push/public-key', { headers: as('papa') });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ publicKey: null });
      res = await send(plain, 'POST', '/api/push/test', { headers: as('papa') });
      expect(await res.json()).toEqual({ result: 'unavailable' });
    } finally {
      plain.close();
    }
  });
});

function logKeys(): string[] {
  return ctx.database.db
    .select()
    .from(notificationLog)
    .all()
    .map((r) => r.key);
}

function subscriptionOf(who: Who) {
  return ctx.database.db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpointOf(who)))
    .get();
}
