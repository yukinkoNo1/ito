import 'fake-indexeddb/auto';
import {
  type EventDTO,
  fakeClock,
  fromJst,
  type MeDTO,
  memberSettingsSchema,
  toIsoJst,
} from '@ito/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResponse, Fetcher } from '../src/data/api';
import { ItoDb } from '../src/data/db';
import { DataStore } from '../src/data/store';
import { readDevice, writeDevice } from '../src/pwa/device';
import { homeNoticeKind } from '../src/pwa/home-notice';
import {
  base64UrlToBytes,
  checkPushSubscription,
  enablePush,
  forgetPublicKey,
  notificationPermission,
  PUSH_OPTED_OUT_KEY,
  PUSH_SUBSCRIPTION_KEY,
  type PushEnv,
  type PushSubscriptionLike,
  pushOptedOut,
  UNKNOWN_KEY,
  unsubscribePush,
} from '../src/pwa/push';
import { clickTarget, planNotification } from '../src/pwa/push-payload';
import { emptyDraft } from '../src/viewmodels/detail';
import { toDeviceVMs } from '../src/viewmodels/devices';
import {
  draftDefaults,
  followReminders,
  myReminders,
  type ReminderDraftState,
  sameOffsets,
  shouldWriteReminders,
} from '../src/viewmodels/reminders';
import { ev, M, members } from './fixtures';

/** Phase 4（通知）の PWA 側 */

describe('SW の push の中身（§15）', () => {
  it('ペイロードを通知の形にする（url は同一オリジンのパスだけ）', () => {
    const plan = planNotification({
      v: 1,
      kind: 'reminder',
      title: '歯医者',
      body: '今日 19:00〜',
      url: '/e/abc?r=2026-10-03T19%3A00',
      tag: 'rem:abc',
      badge: 2,
    });
    expect(plan).toEqual({
      title: '歯医者',
      options: {
        body: '今日 19:00〜',
        tag: 'rem:abc',
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: '/e/abc?r=2026-10-03T19%3A00' },
      },
      appBadge: 2,
    });
    expect(
      planNotification({ v: 1, title: 'x', url: 'https://evil.example.com/' }).options.data,
    ).toEqual({
      url: '/',
    });
  });

  it('読めない中身でも通知は必ず出す（中身は伏せる）', () => {
    for (const data of [null, 'text', { v: 2, title: '秘密' }, 42]) {
      const plan = planNotification(data);
      expect(plan.title).toBe('いと');
      expect(plan.options.body).toBe('予定の通知があります');
      expect(plan.options.data.url).toBe('/');
      expect(plan.appBadge).toBeNull();
    }
  });

  it('通知を押したときの移動先は同じオリジンの URL', () => {
    const origin = 'https://ito.example.ts.net';
    expect(clickTarget({ url: '/activity' }, origin)).toBe(`${origin}/activity`);
    expect(clickTarget({ url: '//evil.example.com' }, origin)).toBe(`${origin}/`);
    expect(clickTarget({ url: 'javascript:alert(1)' }, origin)).toBe(`${origin}/`);
    expect(clickTarget(null, origin)).toBe(`${origin}/`);
  });
});

/** 偽の Notification・pushManager・API */
function fakeEnv(opts: {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  existing?: boolean;
  status?: number;
  /** 公開鍵の応答（既定は鍵あり。null＝家のサーバーに鍵がない、'error'＝通信の失敗） */
  publicKey?: string | null | 'error';
}) {
  const log: string[] = [];
  let permission = opts.permission ?? 'default';
  let current: PushSubscriptionLike | null = opts.existing ? sub('old') : null;
  function sub(name: string): PushSubscriptionLike {
    return {
      endpoint: `https://push.example.com/${name}`,
      toJSON: () => ({
        endpoint: `https://push.example.com/${name}`,
        keys: { p256dh: 'p', auth: 'a' },
      }),
      unsubscribe: async () => {
        log.push('unsubscribe');
        current = null;
        return true;
      },
    };
  }
  const requests: { method: string; path: string; body: unknown }[] = [];
  const env: PushEnv = {
    notification: {
      get permission() {
        return permission;
      },
      async requestPermission() {
        log.push('requestPermission');
        permission = opts.answer ?? 'granted';
        return permission;
      },
    },
    async getRegistration() {
      log.push('getRegistration');
      return {
        pushManager: {
          async getSubscription() {
            log.push('getSubscription');
            return current;
          },
          async subscribe(o) {
            log.push(`subscribe:${o.applicationServerKey.length}`);
            current = sub('new');
            return current;
          },
        },
      };
    },
    async request(method, path, o = {}) {
      requests.push({ method, path, body: o.body });
      if (path === '/api/push/public-key') {
        if (opts.publicKey === 'error') throw new TypeError('Failed to fetch');
        return {
          status: 200,
          body: { publicKey: opts.publicKey === undefined ? KEY : opts.publicKey },
          headers: new Headers(),
        } as ApiResponse;
      }
      return {
        status: opts.status ?? 200,
        body: { id: 'sub-1' },
        headers: new Headers(),
      } as ApiResponse;
    },
  };
  return { env, log, requests };
}

// 65 バイトの公開鍵の形（見本）
const KEY = `B${'A'.repeat(86)}`;
const READY = { status: 'ready', key: KEY } as const;

describe('購読（§15）', () => {
  // 端末の保存（localStorage）の代わり
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetPublicKey();
  });

  it('ボタンを押したあと最初に待つのは requestPermission。購読してサーバーに登録し、ID を端末に保存する', async () => {
    const { env, log, requests } = fakeEnv({});
    expect(await enablePush(READY, env)).toBe('enabled');
    expect(log[0]).toBe('requestPermission');
    expect(log).toContain('subscribe:65');
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/push/subscriptions',
        body: {
          endpoint: 'https://push.example.com/new',
          keys: { p256dh: 'p', auth: 'a' },
          label: expect.any(String),
        },
      },
    ]);
    expect(readDevice(PUSH_SUBSCRIPTION_KEY)).toBe('sub-1');
  });

  it('許可されなければ購読しない。家のサーバーに鍵がなければ unavailable', async () => {
    const denied = fakeEnv({ answer: 'denied' });
    expect(await enablePush(READY, denied.env)).toBe('denied');
    expect(denied.log).toEqual(['requestPermission']);
    const noKey = fakeEnv({});
    expect(await enablePush({ status: 'disabled' }, noKey.env)).toBe('unavailable');
    expect(noKey.requests).toEqual([]);
  });

  it('画面を開いたときに鍵が取れていなければ、許可のあとで取り直す。取れなければ failed（鍵なしと分ける）', async () => {
    const retry = fakeEnv({});
    expect(await enablePush(UNKNOWN_KEY, retry.env)).toBe('enabled');
    expect(retry.log[0]).toBe('requestPermission');
    expect(retry.requests.map((r) => r.path)).toEqual([
      '/api/push/public-key',
      '/api/push/subscriptions',
    ]);
    forgetPublicKey();
    const offline = fakeEnv({ publicKey: 'error' });
    expect(await enablePush(UNKNOWN_KEY, offline.env)).toBe('failed');
    const disabled = fakeEnv({ publicKey: null });
    expect(await enablePush(UNKNOWN_KEY, disabled.env)).toBe('unavailable');
    expect(disabled.log).not.toContain('subscribe:65');
  });

  it('ログアウト・この端末の削除のあとは、起動・前面復帰で購読し直さない。「通知をオンにする」でだけ戻る', async () => {
    writeDevice(PUSH_SUBSCRIPTION_KEY, 'sub-9');
    const stopped = fakeEnv({ permission: 'granted', existing: true });
    await unsubscribePush(stopped.env);
    expect(pushOptedOut()).toBe(true);
    stopped.log.length = 0;
    stopped.requests.length = 0;
    await checkPushSubscription(stopped.env);
    expect(stopped.log).toEqual([]);
    expect(stopped.requests).toEqual([]);
    // 許可は残っていても、状態は「通知をオンにする」に戻る
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('PushManager', class {});
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 15)', maxTouchPoints: 5 });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(notificationPermission()).toBe('default');
    // ホームでは案内しない（設定からオンにできる）
    expect(homeNoticeKind()).toBeNull();
    expect(await enablePush(READY, stopped.env)).toBe('enabled');
    expect(readDevice(PUSH_OPTED_OUT_KEY)).toBeNull();
    expect(notificationPermission()).toBe('granted');
    stopped.requests.length = 0;
    await checkPushSubscription(stopped.env);
    expect(stopped.requests.map((r) => r.path)).toEqual(['/api/push/subscriptions']);
  });

  it('購読を確かめているあいだに止めたら、サーバーに登録しない', async () => {
    const racing = fakeEnv({ permission: 'granted' });
    const original = racing.env.request;
    racing.env.request = async (method, path, o) => {
      // 公開鍵を取っているあいだにログアウトした
      if (path === '/api/push/public-key') writeDevice(PUSH_OPTED_OUT_KEY, '1');
      return original(method, path, o);
    };
    await checkPushSubscription(racing.env);
    expect(racing.requests.map((r) => r.path)).toEqual(['/api/push/public-key']);
  });

  it('起動・前面復帰: 購読があれば upsert、なくて許可済みなら購読し直す、許可がなければ何もしない', async () => {
    const has = fakeEnv({ permission: 'granted', existing: true });
    await checkPushSubscription(has.env);
    expect(has.log).not.toContain('subscribe:65');
    expect(has.requests.map((r) => r.path)).toEqual(['/api/push/subscriptions']);

    const lost = fakeEnv({ permission: 'granted' });
    await checkPushSubscription(lost.env);
    expect(lost.log).toContain('subscribe:65');
    expect(lost.requests.map((r) => r.path)).toEqual([
      '/api/push/public-key',
      '/api/push/subscriptions',
    ]);

    const none = fakeEnv({ permission: 'default' });
    await checkPushSubscription(none.env);
    expect(none.log).toEqual([]);
    expect(none.requests).toEqual([]);
  });

  it('この端末の購読をやめる: サーバーの購読を消してから unsubscribe', async () => {
    writeDevice(PUSH_SUBSCRIPTION_KEY, 'sub-9');
    const { env, log, requests } = fakeEnv({ permission: 'granted', existing: true });
    await unsubscribePush(env);
    expect(requests.map((r) => [r.method, r.path])).toEqual([
      ['DELETE', '/api/push/subscriptions/sub-9'],
    ]);
    expect(log).toContain('unsubscribe');
    expect(readDevice(PUSH_SUBSCRIPTION_KEY)).toBeNull();
  });

  it('base64url の公開鍵をバイト列にする', () => {
    expect(base64UrlToBytes('AQID').length).toBe(3);
    expect([...base64UrlToBytes('_-8')]).toEqual([255, 239]);
  });
});

describe('端末の一覧・自分への通知の VM', () => {
  it('最後に届いた日（今日・M/D・未確認）', () => {
    const now = fromJst('2026-10-03', '12:00');
    expect(
      toDeviceVMs(
        [
          {
            id: 'a',
            label: 'iPhone',
            lastOkAt: toIsoJst(fromJst('2026-10-03', '07:00')),
            createdAt: '',
            isThisDevice: true,
          },
          {
            id: 'b',
            label: 'Android',
            lastOkAt: toIsoJst(fromJst('2026-09-20', '07:00')),
            createdAt: '',
            isThisDevice: false,
          },
          { id: 'c', label: 'パソコン', lastOkAt: null, createdAt: '', isThisDevice: false },
        ],
        now,
      ).map((d) => d.lastUsedLabel),
    ).toEqual(['今日', '9/20', '未確認']);
  });

  const settings = { timedDefaults: [-30], allDayDefaults: [-240] };

  it('本人の行 → 既定値（担当者）→ なし。他人の非公開には候補を出さない', () => {
    const e = ev({ memberIds: [M.papa], ownerId: M.papa });
    expect(myReminders(e, e.id, M.papa, [], settings)).toEqual({
      myReminders: [-30],
      reminderOptions: [0, -10, -30, -60, -1440],
    });
    expect(
      myReminders(e, e.id, M.papa, [{ eventId: e.id, offsets: [-15] }], settings).myReminders,
    ).toEqual([-15]);
    expect(myReminders(e, e.id, M.mama, [], settings).myReminders).toEqual([]);
    const priv = ev({ memberIds: [M.mama], ownerId: M.mama, visibility: 'private' });
    expect(myReminders(priv, priv.id, M.papa, [], settings)).toEqual({
      myReminders: [],
      reminderOptions: [],
    });
  });

  it('書く画面: 終日⇔時刻ありを切り替えたら、前の種類の通知（触った値・本人の行）をやめて既定値に戻す', () => {
    const timedDraft = { ...emptyDraft('2026-10-03', M.papa, '10:00'), myReminders: [-10] };
    const allDayDraft = { ...timedDraft, allDay: true, startTime: null, endTime: null };
    const touched: ReminderDraftState = {
      touched: true,
      pref: undefined,
      prefAllDay: false,
      defaults: settings,
    };
    // 触った「10分前」は、終日にしたら使わない（前日 23:50 になってしまう）
    expect(followReminders(timedDraft, allDayDraft, touched, M.papa)).toEqual({
      myReminders: [-240],
      touched: false,
    });
    // 同じ種類のままなら、触った値を残す
    expect(followReminders(timedDraft, { ...timedDraft, title: 'x' }, touched, M.papa)).toEqual({
      myReminders: [-10],
      touched: true,
    });
    // 直すとき: 本人の行（時刻ありの [-15]）は終日では使わず、戻したら使う。保存では古い行を書き換える
    const editing: ReminderDraftState = {
      touched: false,
      pref: [-15],
      prefAllDay: false,
      defaults: settings,
    };
    const toAllDay = followReminders(timedDraft, allDayDraft, editing, M.papa);
    expect(toAllDay).toEqual({ myReminders: [-240], touched: false });
    expect(shouldWriteReminders({ ...allDayDraft, ...toAllDay }, editing)).toBe(true);
    const back = followReminders(allDayDraft, timedDraft, editing, M.papa);
    expect(back).toEqual({ myReminders: [-15], touched: false });
    expect(shouldWriteReminders({ ...timedDraft, ...back }, editing)).toBe(false);
    // 書く（行なし）で触らなければ行を作らない
    expect(shouldWriteReminders(timedDraft, { ...editing, pref: undefined, touched: false })).toBe(
      false,
    );
  });

  it('書く画面の既定値は担当・終日に合わせる', () => {
    const d = emptyDraft('2026-10-03', M.papa, '10:00');
    expect(draftDefaults(d, M.papa, settings)).toEqual([-30]);
    expect(draftDefaults({ ...d, allDay: true }, M.papa, settings)).toEqual([-240]);
    expect(draftDefaults({ ...d, memberIds: [M.mama] }, M.papa, settings)).toEqual([]);
    expect(draftDefaults({ ...d, memberIds: [], forEveryone: true }, M.papa, settings)).toEqual([
      -30,
    ]);
    expect(sameOffsets([-30, 0], [0, -30])).toBe(true);
  });
});

describe('自分への通知の保存（送信待ちとは別。§15）', () => {
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
    db = new ItoDb(`phase4-${seq}`);
    await db.setMeta('me', me);
    await db.members.bulkPut(members);
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it('手元にすぐ反映し、予定の作成を送れてから PUT する。取得で上書きしない', async () => {
    let online = false;
    const calls: { method: string; path: string; body: unknown }[] = [];
    const serverEvents: EventDTO[] = [];
    const fetcher: Fetcher = async (path, init) => {
      const call = {
        method: init.method ?? 'GET',
        path,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      if (!online) throw new TypeError('Failed to fetch');
      if (path === '/api/me') return Response.json(me);
      if (path.startsWith('/api/sync')) {
        return Response.json({
          cursor: 1,
          full: true,
          events: serverEvents,
          deletedEventIds: [],
          members,
          // サーバーにはまだない（PUT の前の取得）
          myReminderPrefs: [],
          me,
          unreadActivity: 0,
        });
      }
      if (call.method === 'POST' && path === '/api/events') {
        const body = call.body as EventDTO;
        const created = { ...ev({ id: body.id, title: body.title ?? '' }) } as EventDTO;
        serverEvents.push(created);
        return Response.json({ event: created }, { status: 201 });
      }
      if (call.method === 'PUT') return Response.json({ eventId: 'x', offsets: [0] });
      return new Response(null, { status: 404 });
    };
    const store = new DataStore(db, clock, fetcher);
    const made = await store.createEvent({
      title: '歯医者',
      allDay: false,
      startAt: '2026-10-03T19:00:00+09:00',
    });
    if (!made.ok) throw new Error('作れない');
    await store.setMyReminders(made.value.id, [0, -60]);
    expect(await db.getMeta('myReminderPrefs')).toEqual([
      { eventId: made.value.id, offsets: [-60, 0] },
    ]);
    // オフラインのあいだは送らない
    await store.syncNow();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    online = true;
    await store.syncNow();
    const order = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
    expect(order).toEqual(['POST /api/events', `PUT /api/events/${made.value.id}/reminders`]);
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ offsets: [-60, 0] });
    // 送れたので待ちから外れ、次の取得（サーバーの行）で上書きされる
    expect(await db.getMeta('pendingReminderPrefs')).toEqual({});
  });

  it('送れていない自分への通知があるうちは、取得（サーバーの古い行）で上書きしない', async () => {
    const e = ev({ title: '歯医者', memberIds: [M.papa], ownerId: M.papa });
    await db.events.put(e);
    // サーバーには前の行（30 分前）がある。PUT は 5xx が続く
    const server = new Map<string, number[]>([[e.id, [-30]]]);
    let putStatus = 503;
    const fetcher: Fetcher = async (path, init) => {
      const method = init.method ?? 'GET';
      if (path === '/api/me') return Response.json(me);
      if (path.startsWith('/api/sync')) {
        return Response.json({
          cursor: 1,
          full: true,
          events: [e],
          deletedEventIds: [],
          members,
          myReminderPrefs: [...server].map(([eventId, offsets]) => ({ eventId, offsets })),
          me,
          unreadActivity: 0,
        });
      }
      if (method === 'PUT') {
        if (putStatus !== 200) return new Response(null, { status: putStatus });
        const body = JSON.parse(String(init.body)) as { offsets: number[] };
        server.set(e.id, body.offsets);
        return Response.json({ eventId: e.id, offsets: body.offsets });
      }
      return new Response(null, { status: 404 });
    };
    const store = new DataStore(db, clock, fetcher);
    await store.setMyReminders(e.id, [0]);
    await store.syncNow();
    await store.syncNow();
    expect(await db.getMeta('myReminderPrefs')).toEqual([{ eventId: e.id, offsets: [0] }]);
    expect(await db.getMeta('pendingReminderPrefs')).toEqual({ [e.id]: [0] });
    // 送れたら待ちから外れ、サーバーの行（送った値）と同じになる
    putStatus = 200;
    await store.syncNow({ retryNow: true });
    expect(await db.getMeta('pendingReminderPrefs')).toEqual({});
    expect(await db.getMeta('myReminderPrefs')).toEqual([{ eventId: e.id, offsets: [0] }]);
    expect(server.get(e.id)).toEqual([0]);
  });
});

describe('ホームの案内（F-23 のうち通知）と通知の許可の状態（§15）', () => {
  function stubBrowser(opts: {
    standalone: boolean;
    ios?: boolean;
    permission?: NotificationPermission | null;
    dismissed?: string[];
  }) {
    const store = new Map<string, string>((opts.dismissed ?? []).map((k) => [`ito.${k}`, '1']));
    vi.stubGlobal('localStorage', {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({
        matches: opts.standalone && q === '(display-mode: standalone)',
      }),
    });
    vi.stubGlobal('navigator', {
      userAgent: opts.ios
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
        : 'Mozilla/5.0 (Linux; Android 15)',
      maxTouchPoints: 5,
    });
    if (opts.permission === null) {
      vi.stubGlobal('Notification', undefined);
    } else {
      vi.stubGlobal('Notification', { permission: opts.permission ?? 'default' });
      vi.stubGlobal('PushManager', class {});
    }
  }
  afterEach(() => vi.unstubAllGlobals());

  it('ホーム画面に未追加なら「ホーム画面に追加」、閉じたら出さない', () => {
    stubBrowser({ standalone: false });
    expect(homeNoticeKind()).toBe('install');
    stubBrowser({ standalone: false, dismissed: ['notice.install.dismissed'] });
    expect(homeNoticeKind()).toBeNull();
  });

  it('ホーム画面から開いていて許可がまだなら「通知をオンにする」。許可したあと・閉じたあとは出さない', () => {
    stubBrowser({ standalone: true });
    expect(homeNoticeKind()).toBe('notifications');
    stubBrowser({ standalone: true, permission: 'granted' });
    expect(homeNoticeKind()).toBeNull();
    stubBrowser({ standalone: true, dismissed: ['notice.notifications.dismissed'] });
    expect(homeNoticeKind()).toBeNull();
  });

  it('iPhone でホーム画面に未追加なら needs-install（通知の代わりに S-12 へ）。使えない端末は unsupported', () => {
    stubBrowser({ standalone: false, ios: true });
    expect(notificationPermission()).toBe('needs-install');
    stubBrowser({ standalone: true, ios: true, permission: 'granted' });
    expect(notificationPermission()).toBe('granted');
    stubBrowser({ standalone: true, permission: null });
    expect(notificationPermission()).toBe('unsupported');
  });
});
