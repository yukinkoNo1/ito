import { addDays, fromJst, memberMarkSchema, memberNameSchema, uuidv7 } from '@ito/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { events, members, pushSubscriptions } from '../src/db/schema';
import { createFeedToken } from '../src/services/feed-tokens';
import { insertRecord } from '../src/services/records';
import { MAX_SERIES_WITH_ENDED_PER_OWNER } from '../src/services/series-limit';
import { as, createEvent, IDS, LOGINS, seedFamily, syncAs, timed } from './family';
import {
  createTestContext,
  devEnv,
  send,
  type TestContext,
  TS_ORIGIN,
  tailscaleEnv,
  tsUser,
} from './helpers';

/**
 * 総点検（RUNBOOK 7.「総点検」）で見つけた攻撃の経路の再現テスト。docs/security-review.md の表の ID と同じ。
 * どれも直す前に失敗することを確かめてから直した
 */

let ctx: TestContext;
afterEach(() => ctx?.close());

const NOW = fromJst('2026-09-27', '14:18');

function prod(): TestContext {
  ctx = createTestContext(tailscaleEnv(), { now: NOW });
  seedFamily(ctx);
  // お母さんも管理者に（お父さんを無効化・降格できる人）
  ctx.database.db.update(members).set({ role: 'admin' }).where(eq(members.id, IDS.mama)).run();
  return ctx;
}

const APP = {
  'x-ito-client': '1',
  'content-type': 'application/json',
  origin: TS_ORIGIN,
  'sec-fetch-site': 'same-origin',
};

/** 本文をあとから送る要求（ヘッダと Content-Length だけ先に届き、本文は release() で届く） */
function held(method: string, path: string, headers: Record<string, string>, body: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await gate;
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const request = new Request(`http://${ctx.env.APP_HOST}${path}`, {
    method,
    headers: { host: ctx.env.APP_HOST, ...headers, 'content-length': String(bytes.byteLength) },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  const pending = Promise.resolve(ctx.app.request(request));
  return { pending, release };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('A1・A2 本文を待っているあいだに無効化・降格されたら、本文が届いても前の権限で動かない', () => {
  it('A1 無効化の前に開いた管理者の要求（自分を戻す・管理者を足す）は 403', async () => {
    prod();
    const self = held(
      'PATCH',
      `/api/members/${IDS.papa}`,
      { ...APP, ...tsUser(LOGINS.papa) },
      { disabled: false, role: 'admin' },
    );
    const add = held(
      'POST',
      '/api/members',
      { ...APP, ...tsUser(LOGINS.papa) },
      { login: 'papa-alt@example.com', name: 'べつの父', mark: 'べ', color: 'momo', role: 'admin' },
    );
    await tick();
    const disable = await send(ctx, 'PATCH', `/api/members/${IDS.papa}`, {
      headers: tsUser(LOGINS.mama),
      body: { disabled: true },
    });
    expect(disable.status).toBe(200);
    self.release();
    add.release();
    expect((await self.pending).status).toBe(403);
    expect((await add.pending).status).toBe(403);
    const papa = ctx.database.db.select().from(members).where(eq(members.id, IDS.papa)).get();
    expect(papa?.disabledAt).not.toBeNull();
    const alt = ctx.database.db
      .select()
      .from(members)
      .where(eq(members.login, 'papa-alt@example.com'))
      .get();
    expect(alt).toBeUndefined();
  });

  it('A1 降格の前に開いた要求で、自分を管理者に戻せない', async () => {
    prod();
    const self = held(
      'PATCH',
      `/api/members/${IDS.papa}`,
      { ...APP, ...tsUser(LOGINS.papa) },
      { role: 'admin' },
    );
    await tick();
    const demote = await send(ctx, 'PATCH', `/api/members/${IDS.papa}`, {
      headers: tsUser(LOGINS.mama),
      body: { role: 'member' },
    });
    expect(demote.status).toBe(200);
    self.release();
    expect((await self.pending).status).toBe(403);
    const papa = ctx.database.db.select().from(members).where(eq(members.id, IDS.papa)).get();
    expect(papa?.role).toBe('member');
  });

  it('A2 無効化の前に開いた購読の登録は、無効化のあとに終わっても購読を残さない（§18 T9）', async () => {
    prod();
    const sub = held(
      'POST',
      '/api/push/subscriptions',
      { ...APP, ...tsUser(LOGINS.yuki) },
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) },
      },
    );
    await tick();
    const disable = await send(ctx, 'PATCH', `/api/members/${IDS.yuki}`, {
      headers: tsUser(LOGINS.mama),
      body: { disabled: true },
    });
    expect(disable.status).toBe(200);
    sub.release();
    expect((await sub.pending).status).toBe(403);
    const rows = ctx.database.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.memberId, IDS.yuki))
      .all();
    expect(rows).toEqual([]);
  });
});

describe('A3・A4 /api/* の GET もアプリからの要求だけ（クロスサイトから重い全件同期を何度も作らせない・圧縮の長さを測らせない）', () => {
  it('X-Ito-Client のない GET・クロスサイトの GET は 403 csrf。アプリからの GET は 200', async () => {
    prod();
    for (const path of ['/api/sync?cursor=0', '/api/me', '/api/activity', '/api/trash']) {
      const noHeader = await send(ctx, 'GET', path, {
        headers: { ...tsUser(LOGINS.papa), 'x-ito-client': '', 'accept-encoding': 'gzip' },
      });
      expect([path, noHeader.status]).toEqual([path, 403]);
      expect(((await noHeader.json()) as { code: string }).code).toBe('csrf');
      const crossSite = await send(ctx, 'GET', path, {
        headers: {
          ...tsUser(LOGINS.papa),
          'x-ito-client': '1',
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'no-cors',
        },
      });
      expect([path, crossSite.status]).toEqual([path, 403]);
      const ok = await send(ctx, 'GET', path, {
        headers: { ...tsUser(LOGINS.papa), 'x-ito-client': '1', 'sec-fetch-site': 'same-origin' },
      });
      expect([path, ok.status]).toEqual([path, 200]);
    }
  });
});

describe('A7・A8・A9 非公開の繰り返しを公開・非公開にするときの漏れ', () => {
  it('A7 非公開の繰り返しを「これ以降」で件名・場所を変えながら公開しても、ほかの家族の履歴に非公開だったときの件名・場所は出ない', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const { event } = await createEvent(
      ctx,
      'yuki',
      timed('2026-10-01', '17:00', '18:00', {
        title: '心療内科',
        location: '駅前メンタルクリニック',
        rrule: 'FREQ=WEEKLY;BYDAY=TH',
        memberIds: [IDS.yuki],
        visibility: 'private',
      }),
    );
    const res = await send(ctx, 'PATCH', `/api/events/${event.id}`, {
      headers: { ...as('yuki'), 'if-match': String(event.version) },
      body: {
        scope: 'following',
        recurrenceId: '2026-10-15T17:00',
        exceptionId: uuidv7(NOW),
        changes: { visibility: 'family', title: '通院', location: null },
      },
    });
    expect(res.status).toBe(200);
    const family = await (await send(ctx, 'GET', '/api/activity', { headers: as('mama') })).text();
    expect(family).not.toMatch(/心療内科|駅前メンタルクリニック/);
    // 持ち主には全部の差分が残る
    const own = await (await send(ctx, 'GET', '/api/activity', { headers: as('yuki') })).text();
    expect(own).toMatch(/心療内科/);
  });

  it('A8 非公開のときに消した「この回だけ変更」は、公開したあとに家族が戻しても中身を出さない', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const { event } = await createEvent(
      ctx,
      'yuki',
      timed('2026-10-01', '19:00', '20:00', {
        title: 'カウンセリング',
        rrule: 'FREQ=DAILY;COUNT=5',
        memberIds: [IDS.yuki],
        visibility: 'private',
      }),
    );
    let res = await send(ctx, 'PATCH', `/api/events/${event.id}`, {
      headers: { ...as('yuki'), 'if-match': '1' },
      body: {
        scope: 'this',
        recurrenceId: '2026-10-02T19:00',
        exceptionId: uuidv7(NOW + 1),
        changes: { title: 'カウンセリング（離婚の相談）', note: '弁護士の紹介状' },
      },
    });
    expect(res.status).toBe(200);
    res = await send(
      ctx,
      'DELETE',
      `/api/events/${event.id}?scope=this&recurrenceId=2026-10-02T19:00`,
      { headers: { ...as('yuki'), 'if-match': '2' } },
    );
    expect(res.status).toBe(200);
    res = await send(ctx, 'PATCH', `/api/events/${event.id}`, {
      headers: { ...as('yuki'), 'if-match': '3' },
      body: { scope: 'all', changes: { visibility: 'family', title: '用事' } },
    });
    expect(res.status).toBe(200);
    res = await send(ctx, 'POST', `/api/events/${event.id}/restore?recurrenceId=2026-10-02T19:00`, {
      headers: as('mama'),
    });
    expect([200, 403, 404]).toContain(res.status);
    const sync = JSON.stringify(await syncAs(ctx, 'mama'));
    expect(sync).not.toMatch(/離婚の相談|弁護士の紹介状/);
  });

  it('A9 家族の繰り返しを「これ以降」で非公開にしたら、その回以降についての履歴もほかの家族から見えなくなる', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const { event } = await createEvent(
      ctx,
      'mama',
      timed('2026-10-01', '19:00', '20:00', {
        title: '習い事',
        rrule: 'FREQ=WEEKLY;BYDAY=TH',
        memberIds: [IDS.mama],
      }),
    );
    let res = await send(ctx, 'PATCH', `/api/events/${event.id}`, {
      headers: { ...as('mama'), 'if-match': '1' },
      body: {
        scope: 'this',
        recurrenceId: '2026-10-15T19:00',
        exceptionId: uuidv7(NOW + 2),
        changes: { title: '心療内科', location: '駅前クリニック' },
      },
    });
    expect(res.status).toBe(200);
    res = await send(ctx, 'PATCH', `/api/events/${event.id}`, {
      headers: { ...as('mama'), 'if-match': '2' },
      body: {
        scope: 'following',
        recurrenceId: '2026-10-15T19:00',
        exceptionId: uuidv7(NOW + 3),
        changes: { visibility: 'private', title: '用事' },
      },
    });
    expect(res.status).toBe(200);
    const family = await (await send(ctx, 'GET', '/api/activity', { headers: as('papa') })).text();
    expect(family).not.toMatch(/心療内科|駅前クリニック/);
  });
});

describe('A10・A11 表示用フィード', () => {
  it('A10 続いた認証の失敗の件数は、そのあと失敗がなくても次の要求のときまでに WARN に出る', async () => {
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    seedFamily(ctx);
    const { token } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
    for (let i = 0; i < 50; i++) {
      await send(ctx, 'GET', '/api/feed/display', {
        csrf: false,
        headers: { authorization: `Bearer ito_feed_${'A'.repeat(43)}` },
      });
      ctx.clock.advance(100);
    }
    ctx.clock.advance(61_000);
    const ok = await send(ctx, 'GET', '/api/feed/display', {
      csrf: false,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.status).toBe(200);
    const total = ctx.logs.lines
      .flatMap((l) => l.split(String.fromCharCode(10)))
      .filter((l) => l.includes('feed auth failed'))
      .reduce((n, l) => n + ((JSON.parse(l) as { failures: number }).failures ?? 0), 0);
    expect(total).toBe(50);
  });

  it('A11 FEED_ALLOW_USER_DEVICES=false なら、空の Tailscale-User-Login やほかの ID ヘッダが付いた要求も 403', async () => {
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    seedFamily(ctx);
    const { token } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
    const cases: [string, string][] = [
      ['tailscale-user-login', ''],
      ['tailscale-user-login', '   '],
      ['tailscale-user-name', 'Papa'],
      ['tailscale-user-profile-pic', 'https://x.example.com/p.png'],
    ];
    for (const [name, value] of cases) {
      const headers = new Headers();
      headers.set('host', ctx.env.APP_HOST);
      headers.set('authorization', `Bearer ${token}`);
      headers.set(name, value);
      const res = await ctx.app.request(`http://${ctx.env.APP_HOST}/api/feed/display`, { headers });
      expect([name, value, res.status]).toEqual([name, value, 403]);
    }
  });
});

describe('A6 名前・略称・呼び名の見えない文字', () => {
  // 見えない文字はソースに直接書かず、コードポイントで組み立てる
  const c = (...cps: number[]) => String.fromCodePoint(...cps);
  const HIDDEN = [
    `お母さん${c(0x200b)}`, // ゼロ幅スペース
    `${c(0x202e)}んさ母お`, // 右から左への上書き
    `お母${c(0x07)}さん`, // 制御文字
    `${c(0x2066)}お母さん${c(0x2069)}`, // 双方向の分離
    `お母${c(0xad)}さん`, // ソフトハイフン
    `お母${c(0xfeff)}さん`,
    c(0x200b),
  ];

  it('見えない文字・制御文字を含む名前・略称・呼び名は 422（/api/me・家族の管理）。ほかの家族と同じに見える名前にできない', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    for (const name of HIDDEN) {
      const me = await send(ctx, 'PATCH', '/api/me', { headers: as('haru'), body: { name } });
      expect([name, me.status]).toEqual([name, 422]);
      const admin = await send(ctx, 'PATCH', `/api/members/${IDS.haru}`, {
        headers: as('papa'),
        body: { name },
      });
      expect([name, admin.status]).toEqual([name, 422]);
      const aliases = await send(ctx, 'PATCH', '/api/me', {
        headers: as('haru'),
        body: { aliases: [name] },
      });
      expect([name, aliases.status]).toEqual([name, 422]);
    }
    for (const mark of [c(0x200b), c(0x202e), c(0x07)]) {
      const res = await send(ctx, 'PATCH', '/api/me', { headers: as('haru'), body: { mark } });
      expect([mark, res.status]).toEqual([mark, 422]);
    }
    const res = await send(ctx, 'POST', '/api/members', {
      headers: as('papa'),
      body: { login: 'new@example.com', name: `お父さん${c(0x200b)}`, mark: 'あ', color: 'momo' },
    });
    expect(res.status).toBe(422);
    const { members: list } = (await (
      await send(ctx, 'GET', '/api/members', { headers: as('papa') })
    ).json()) as { members: { name: string }[] };
    expect(list.map((m) => m.name).sort()).toEqual(['お父さん', 'お母さん', 'はる', 'ゆき'].sort());
  });

  it('絵文字の組み立て（ZWJ・肌の色・異体字セレクタ・旗）と漢字の異体字（IVS）の名前・略称は使える', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const technologist = c(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb);
    const heart = c(0x2764, 0xfe0f);
    const rainbow = c(0x1f3f3, 0xfe0f, 0x200d, 0x1f308);
    const scotland = c(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f);
    const keycap = c(0x31, 0xfe0f, 0x20e3);
    for (const [name, mark] of [
      [`はる${c(0x1f469, 0x200d, 0x1f4bb)}`, technologist],
      [`はる${heart}`, heart],
      [`はる${scotland}`, rainbow],
      [`${c(0x845b, 0xe0100)}城`, keycap],
    ]) {
      const res = await send(ctx, 'PATCH', '/api/me', {
        headers: as('haru'),
        body: { name, mark },
      });
      expect([name, mark, res.status]).toEqual([name, mark, 200]);
    }
  });

  it('自動登録の名前（Tailscale の表示名）からは見えない文字を除く', async () => {
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    const raw = `${c(0x202e)}おと${c(0x200b)}うさん${c(0x07)}`;
    const encoded = `=?utf-8?B?${Buffer.from(raw).toString('base64')}?=`;
    const res = await send(ctx, 'GET', '/api/me', {
      headers: tsUser('admin@example.com', encoded),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe('おとうさん');
  });
});

describe('B3 予定の書き込みの回数と、取り消した回の数', () => {
  async function dailySeries(who: 'papa' | 'mama') {
    const { res, event } = await createEvent(ctx, who, {
      title: '毎日',
      allDay: true,
      startDate: '2026-10-01',
      rrule: 'FREQ=DAILY',
      memberIds: [IDS[who]],
    });
    expect(res.status).toBe(201);
    return event;
  }

  it('「この回だけ変更」（例外行を作る）も 1 人 1 分に 120 件まで。超えたら 429 で行を作らない', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const s = await dailySeries('papa');
    let version = s.version;
    const patchThis = (i: number) =>
      send(ctx, 'PATCH', `/api/events/${s.id}`, {
        headers: { ...as('papa'), 'if-match': String(version), 'idempotency-key': `b3-${i}` },
        body: {
          scope: 'this',
          recurrenceId: addDays('2026-10-02', i),
          exceptionId: uuidv7(NOW + i),
          changes: { title: `変更 ${i}` },
        },
      });
    for (let i = 0; i < 120; i++) {
      const res = await patchThis(i);
      expect([i, res.status]).toEqual([i, 200]);
      version = ((await res.json()) as { event: { version: number } }).event.version;
    }
    const over = await patchThis(120);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
    const exceptions = ctx.database.db.select().from(events).where(eq(events.parentId, s.id)).all();
    expect(exceptions).toHaveLength(120);
    // ほかの家族は数えない
    const other = await dailySeries('mama');
    const res = await send(
      ctx,
      'DELETE',
      `/api/events/${other.id}?scope=this&recurrenceId=2026-10-03`,
      {
        headers: { ...as('mama'), 'if-match': String(other.version), 'idempotency-key': 'b3-mama' },
      },
    );
    expect(res.status).toBe(200);
  });

  it('「この回だけ削除」で取り消せる回は 1 つの繰り返しで 1000 回まで（超えたら 422）', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const s = await dailySeries('papa');
    const past = Array.from({ length: 999 }, (_, i) => addDays('2026-10-02', i));
    ctx.database.db
      .update(events)
      .set({ exdates: JSON.stringify(past) })
      .where(eq(events.id, s.id))
      .run();
    const del = (rid: string, version: number, key: string) =>
      send(ctx, 'DELETE', `/api/events/${s.id}?scope=this&recurrenceId=${rid}`, {
        headers: { ...as('papa'), 'if-match': String(version), 'idempotency-key': key },
      });
    const ok = await del('2029-12-01', s.version, 'b3-del-1');
    expect(ok.status).toBe(200);
    const next = ((await ok.json()) as { event: { version: number; exdates: string[] } }).event;
    expect(next.exdates).toHaveLength(1000);
    const over = await del('2029-12-02', next.version, 'b3-del-2');
    expect(over.status).toBe(422);
  });
});

describe('B5 結合文字を大量に付けた「1 文字」', () => {
  it('名前・略称・呼び名・件名に数千の結合文字を付けても 422（AI の指示文・同期・フィードを膨らませない）', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const acute = (n: number) => String.fromCodePoint(0x301).repeat(n);
    const me = await send(ctx, 'PATCH', '/api/me', {
      headers: as('yuki'),
      body: {
        name: `ゆ${acute(2000)}`,
        mark: `x${acute(2000)}`,
        aliases: Array.from({ length: 10 }, () => `a${acute(1000)}`),
      },
    });
    expect(me.status).toBe(422);
    for (const body of [
      { name: `ゆ${acute(2000)}` },
      { mark: `x${acute(100)}` },
      { aliases: [`a${acute(100)}`] },
    ]) {
      const res = await send(ctx, 'PATCH', '/api/me', { headers: as('yuki'), body });
      expect([Object.keys(body)[0], res.status]).toEqual([Object.keys(body)[0], 422]);
    }
    const { res } = await createEvent(ctx, 'yuki', {
      title: `あ${acute(1000)}`,
      allDay: true,
      startDate: '2026-10-01',
      memberIds: [IDS.yuki],
    });
    expect(res.status).toBe(422);
  });
});

/*
 * 総点検の修正のレビュー（docs/security-review.md の C1〜C10）の再現テスト。どれも直す前に失敗することを確かめてから直した
 */
describe('C5 表示用フィードの認証の失敗は、失敗が止んだあとも 1 分ほどで件数を WARN に出す（タイマーを掛け直す）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('0 秒・10 秒・65 秒・66 秒に失敗して 10 分静かなら、WARN の件数の合計は 4', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    seedFamily(ctx);
    let t = 0;
    const until = async (ms: number) => {
      while (t < ms) {
        t += 1000;
        ctx.clock.advance(1000);
        vi.advanceTimersByTime(1000);
      }
    };
    const fail = () =>
      send(ctx, 'GET', '/api/feed/display', {
        csrf: false,
        headers: { authorization: `Bearer ito_feed_${'B'.repeat(43)}` },
      });
    for (const at of [0, 10_000, 65_000, 66_000]) {
      await until(at);
      expect((await fail()).status).toBe(401);
    }
    await until(66_000 + 10 * 60_000);
    const total = ctx.logs.lines
      .flatMap((l) => l.split(String.fromCharCode(10)))
      .filter((l) => l.includes('feed auth failed'))
      .reduce((n, l) => n + ((JSON.parse(l) as { failures: number }).failures ?? 0), 0);
    expect(total).toBe(4);
  });
});

describe('C7 本文が途中で切れた要求は 400（500 と ERROR のログにしない）', () => {
  it('本文を 10 バイト送ったところで切れても、500 にならず unhandled error を出さない', async () => {
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    seedFamily(ctx);
    for (const who of [{}, tsUser(LOGINS.papa)]) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"title":"'));
          controller.error(new Error('aborted'));
        },
      });
      const request = new Request(`http://${ctx.env.APP_HOST}/api/events`, {
        method: 'POST',
        headers: { host: ctx.env.APP_HOST, ...APP, ...who, 'content-length': '100' },
        body: stream,
        duplex: 'half',
      } as RequestInit);
      const res = await ctx.app.request(request);
      expect(res.status).toBe(400);
    }
    expect(ctx.logs.lines.join('')).not.toContain('unhandled error');
  });
});

describe('C9 見た目を変えない文字（異体字セレクタ・ZWJ・タグ）を足しても、ほかの家族と同じ名前にできない', () => {
  const c = (...cps: number[]) => String.fromCodePoint(...cps);

  it('お母さんに異体字セレクタを足した名前・絵文字に FE0F や ZWJ・タグを足した名前は 409 name_taken', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    for (const name of [
      `お母${c(0xfe00)}さん`,
      `お母${c(0xe0100)}さん`,
      `お母${c(0xfe0f)}さん`,
      `お母${c(0xfe0e)}さん`,
      `お母${c(0xe01ef)}さん`,
    ]) {
      const res = await send(ctx, 'PATCH', '/api/me', { headers: as('haru'), body: { name } });
      expect([name, res.status]).toEqual([name, 409]);
    }
    // 家族の管理から足すときも同じ
    const add = await send(ctx, 'POST', '/api/members', {
      headers: as('papa'),
      body: { login: 'new@example.com', name: `お父${c(0xfe01)}さん`, mark: 'あ', color: 'momo' },
    });
    expect(add.status).toBe(409);
    const grin = c(0x1f600);
    const flag = c(0x1f3f4);
    expect(
      (await send(ctx, 'PATCH', '/api/me', { headers: as('mama'), body: { name: `ママ${grin}` } }))
        .status,
    ).toBe(200);
    expect(
      (await send(ctx, 'PATCH', '/api/me', { headers: as('papa'), body: { name: `パパ${flag}` } }))
        .status,
    ).toBe(200);
    for (const name of [
      `ママ${grin}${c(0xfe0f)}`,
      `ママ${grin}${c(0xfe0e)}`,
      `パパ${flag}${c(0xe0078, 0xe007f)}`,
    ]) {
      const res = await send(ctx, 'PATCH', '/api/me', { headers: as('haru'), body: { name } });
      expect([name, res.status]).toEqual([name, 409]);
    }
  });

  it('自動登録の名前も、見た目が同じ名前なら末尾に番号を付ける', async () => {
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    seedFamily(ctx);
    const raw = `お母${c(0xfe00)}さん`;
    const res = await send(ctx, 'GET', '/api/me', {
      headers: tsUser('admin@example.com', `=?utf-8?B?${Buffer.from(raw).toString('base64')}?=`),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toMatch(/2$/);
  });
});

describe('C10 自動登録の名前・略称にも長さの上限を当てる（B5）', () => {
  it('Tailscale の表示名に結合文字を大量に付けても、名前・略称は入力と同じ決まりに収まる', async () => {
    const acute = (n: number) => String.fromCodePoint(0x301).repeat(n);
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);
    for (const raw of [`ゆ${acute(2000)}き`, `ゆ${acute(100)}`, family.repeat(8), acute(50)]) {
      ctx = createTestContext(tailscaleEnv(), { now: NOW });
      const res = await send(ctx, 'GET', '/api/me', {
        headers: tsUser('admin@example.com', `=?utf-8?B?${Buffer.from(raw).toString('base64')}?=`),
      });
      expect(res.status).toBe(200);
      const me = (await res.json()) as { name: string; mark: string };
      expect([raw.length, memberNameSchema.safeParse(me.name).success]).toEqual([raw.length, true]);
      expect([raw.length, memberMarkSchema.safeParse(me.mark).success]).toEqual([raw.length, true]);
      ctx.close();
    }
  });
});

describe('C6 /api の GET は X-Ito-Client が要る（設置後の確認・開発の確認で送るもの）', () => {
  it('本番の設定: X-Ito-Client だけで ID ヘッダがなければ 401 no_identity（タグの端末）。X-Ito-Client がなければ 403 csrf', async () => {
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    seedFamily(ctx);
    const tagDevice = await send(ctx, 'GET', '/api/me', {
      csrf: false,
      headers: { 'x-ito-client': '1' },
    });
    expect(tagDevice.status).toBe(401);
    expect(((await tagDevice.json()) as { code: string }).code).toBe('no_identity');
    const plain = await send(ctx, 'GET', '/api/me', { csrf: false });
    expect(plain.status).toBe(403);
  });

  it('開発の設定: X-Ito-Client だけで /api/me が 200（scripts/check-dev.mjs が送るもの）', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    const res = await send(ctx, 'GET', '/api/me', {
      csrf: false,
      headers: { 'x-ito-client': '1' },
    });
    expect(res.status).toBe(200);
  });
});

describe('総点検のレビュー（2 回目）D6: 時計が戻っても、失敗の WARN のタイマーは 1 分より長く・短く回り続けない', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('時計が 30 日戻ったあとの失敗も 1 分以内に WARN に出し、タイマーの待ちは 1〜60 秒に収める', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const delays: number[] = [];
    const original = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return original(fn, ms);
    }) as typeof setTimeout);
    ctx = createTestContext(tailscaleEnv(), { now: NOW });
    seedFamily(ctx);
    const fail = () =>
      send(ctx, 'GET', '/api/feed/display', {
        csrf: false,
        headers: { authorization: `Bearer ito_feed_${'C'.repeat(43)}` },
      });
    expect((await fail()).status).toBe(401);
    ctx.clock.set(NOW - 30 * 24 * 60 * 60 * 1000);
    expect((await fail()).status).toBe(401);
    expect((await fail()).status).toBe(401);
    for (let i = 0; i < 70; i++) {
      ctx.clock.advance(1000);
      vi.advanceTimersByTime(1000);
    }
    const total = ctx.logs.lines
      .flatMap((l) => l.split(String.fromCharCode(10)))
      .filter((l) => l.includes('feed auth failed'))
      .reduce((n, l) => n + ((JSON.parse(l) as { failures: number }).failures ?? 0), 0);
    expect(total).toBe(3);
    expect(delays.every((ms) => ms >= 1000 && ms <= 60_000)).toBe(true);
  });
});

describe('総点検のレビュー（4 回目 F1・F2・5 回目 G1）: 繰り返しの予定は持ち主ごとに 100 件まで（展開で覚えるものを上回らない。ほかの人を締め出さない）', () => {
  let seeded = 0;
  function seedSeries(
    n: number,
    deleted = 0,
    who: 'papa' | 'mama' | 'yuki' = 'papa',
    privately = false,
    rrule = 'FREQ=WEEKLY',
    from = '2026-01-01',
  ) {
    const owner = IDS[who];
    for (let i = 0; i < n + deleted; i++) {
      const at = fromJst(addDays(from, i % 300), '09:00');
      const gone = i >= n;
      insertRecord(ctx.database.db, {
        id: uuidv7(NOW + 50_000 + seeded++),
        version: 1,
        title: `繰り返し ${i}`,
        note: null,
        location: null,
        allDay: false,
        startAt: at,
        endAt: null,
        startDate: null,
        endDate: null,
        rrule,
        exdates: [],
        parentId: null,
        recurrenceId: null,
        memberIds: [owner],
        forEveryone: false,
        busy: true,
        visibility: privately ? 'private' : 'family',
        ownerId: owner,
        createdBy: owner,
        updatedBy: owner,
        deletedBy: gone ? owner : null,
        createdAt: NOW - 1000,
        updatedAt: NOW - 1000,
        deletedAt: gone ? NOW - 1000 : null,
      });
    }
  }

  it('持ち主の繰り返しが 100 件あるとき、その人の繰り返しを作る・繰り返しにする・「これ以降」で分ける・ゴミ箱から戻すのは 409 series_limit。繰り返しでない予定は作れる', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    seedSeries(99, 1, 'mama');
    const one = await createEvent(ctx, 'mama', {
      title: '100 件目',
      allDay: true,
      startDate: '2026-10-01',
      rrule: 'FREQ=MONTHLY',
      memberIds: [IDS.mama],
    });
    expect(one.res.status).toBe(201);
    const over = await createEvent(ctx, 'mama', {
      title: '101 件目',
      allDay: true,
      startDate: '2026-10-01',
      rrule: 'FREQ=MONTHLY',
      memberIds: [IDS.mama],
    });
    expect(over.res.status).toBe(409);
    expect(((await over.res.json()) as { code: string }).code).toBe('series_limit');
    const plain = await createEvent(ctx, 'mama', {
      title: '1 回だけ',
      allDay: true,
      startDate: '2026-10-02',
      memberIds: [IDS.mama],
    });
    expect(plain.res.status).toBe(201);
    const toSeries = await send(ctx, 'PATCH', `/api/events/${plain.event.id}`, {
      headers: {
        ...as('mama'),
        'if-match': String(plain.event.version),
        'idempotency-key': 'f1-1',
      },
      body: { scope: 'all', changes: { rrule: 'FREQ=WEEKLY' } },
    });
    expect(toSeries.status).toBe(409);
    const split = await send(ctx, 'PATCH', `/api/events/${one.event.id}`, {
      headers: { ...as('mama'), 'if-match': String(one.event.version), 'idempotency-key': 'f1-2' },
      body: {
        scope: 'following',
        recurrenceId: '2026-12-01',
        exceptionId: uuidv7(NOW + 99),
        changes: { title: '12 月から' },
      },
    });
    expect(split.status).toBe(409);
    // 「これ以降」で繰り返しを外す（新しい行は繰り返しでない）ならシリーズは増えないので、上限でも変えられる
    const unrepeat = await send(ctx, 'PATCH', `/api/events/${one.event.id}`, {
      headers: { ...as('mama'), 'if-match': String(one.event.version), 'idempotency-key': 'f1-4' },
      body: {
        scope: 'following',
        recurrenceId: '2026-12-01',
        exceptionId: uuidv7(NOW + 98),
        changes: { rrule: null },
      },
    });
    expect(unrepeat.status).toBe(200);
    const trashed = ctx.database.db
      .select()
      .from(events)
      .all()
      .find((e) => e.deletedAt !== null && e.rrule !== null);
    if (!trashed) throw new Error('ゴミ箱の繰り返しがない');
    const restored = await send(ctx, 'POST', `/api/events/${trashed.id}/restore`, {
      headers: { ...as('papa'), 'idempotency-key': 'f1-3' },
      body: {},
    });
    expect(restored.status).toBe(409);
    // ほかの人は自分の繰り返しを作れる
    const others = await createEvent(ctx, 'papa', {
      title: 'お父さんの繰り返し',
      allDay: true,
      startDate: '2026-10-01',
      rrule: 'FREQ=MONTHLY',
      memberIds: [IDS.papa],
    });
    expect(others.res.status).toBe(201);
  });

  it('G1 ほかの人が非公開の繰り返しで自分の上限を埋めても（その人を無効にしても）、自分の繰り返しは作れる', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    seedSeries(100, 0, 'yuki', true);
    const yukis = await createEvent(ctx, 'yuki', {
      title: 'ゆきの 101 件目',
      allDay: true,
      startDate: '2026-10-05',
      rrule: 'FREQ=WEEKLY',
      memberIds: [IDS.yuki],
      visibility: 'private',
    });
    expect(yukis.res.status).toBe(409);
    const disabled = await send(ctx, 'PATCH', `/api/members/${IDS.yuki}`, {
      headers: as('papa'),
      body: { disabled: true },
    });
    expect(disabled.status).toBe(200);
    const mine = await createEvent(ctx, 'mama', {
      title: '習い事',
      allDay: true,
      startDate: '2026-10-05',
      rrule: 'FREQ=WEEKLY',
      memberIds: [IDS.mama],
    });
    expect(mine.res.status).toBe(201);
  });

  it('H2 終わった繰り返し（UNTIL が過ぎた・COUNT を使い切った）は 100 件に数えない。ほかの人の「これ以降」も通る。終わっていないものは数える', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    seedSeries(60, 0, 'mama', false, 'FREQ=WEEKLY;UNTIL=20250101T235959', '2024-01-01');
    seedSeries(39, 0, 'mama', false, 'FREQ=MONTHLY;COUNT=3', '2024-01-01');
    seedSeries(1, 0, 'mama');
    const made = await createEvent(ctx, 'mama', {
      title: '習い事',
      allDay: true,
      startDate: '2026-10-05',
      rrule: 'FREQ=WEEKLY',
      memberIds: [IDS.mama],
    });
    expect(made.res.status).toBe(201);
    const split = await send(ctx, 'PATCH', `/api/events/${made.event.id}`, {
      headers: {
        ...as('papa'),
        'if-match': String(made.event.version),
        'idempotency-key': 'h2-1',
      },
      body: {
        scope: 'following',
        recurrenceId: '2026-10-19',
        exceptionId: uuidv7(NOW + 97),
        changes: { title: '習い事（後半）' },
      },
    });
    expect(split.status).toBe(200);
    // 終わっていない繰り返し（まだ回の残る前の部分を含む）は数える: 3 件＋97 件で 100 件
    seedSeries(97, 0, 'mama');
    const over = await createEvent(ctx, 'mama', {
      title: '101 件目',
      allDay: true,
      startDate: '2026-10-06',
      rrule: 'FREQ=WEEKLY',
      memberIds: [IDS.mama],
    });
    expect(over.res.status).toBe(409);
    expect(((await over.res.json()) as { code: string }).code).toBe('series_limit');
  });

  it('H2 終わったものを含めた繰り返しは 1 人 400 件まで（展開で覚えるものを家族 8 人でも上回らない）', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    seedSeries(400, 0, 'yuki', false, 'FREQ=WEEKLY;UNTIL=20250101T235959', '2024-01-01');
    const over = await createEvent(ctx, 'yuki', {
      title: '新しい繰り返し',
      allDay: true,
      startDate: '2026-10-05',
      rrule: 'FREQ=WEEKLY',
      memberIds: [IDS.yuki],
    });
    expect(over.res.status).toBe(409);
    const body = (await over.res.json()) as { code: string; detail: string };
    expect(body.code).toBe('series_limit');
    expect(body.detail).toContain('終わったもの');
    expect(MAX_SERIES_WITH_ENDED_PER_OWNER * 8).toBeLessThan(4000);
  });

  it('H2 終わっていないものが 100 件のとき、終わった繰り返しの終わりを消して終わっていないものにするのは 409。終わったまま・今のままの変更と、終わったものを作る・戻すのは通る', async () => {
    ctx = createTestContext(devEnv(), { now: NOW });
    seedFamily(ctx);
    seedSeries(100, 0, 'mama');
    seedSeries(1, 1, 'mama', false, 'FREQ=WEEKLY;UNTIL=20250101T235959', '2024-01-01');
    const rows = ctx.database.db.select().from(events).all();
    const ended = rows.find((e) => e.rrule?.includes('UNTIL') && e.deletedAt === null);
    const trashedEnded = rows.find((e) => e.rrule?.includes('UNTIL') && e.deletedAt !== null);
    const active = rows.find((e) => e.rrule === 'FREQ=WEEKLY' && e.deletedAt === null);
    if (!ended || !trashedEnded || !active) throw new Error('行がない');
    const patch = (id: string, version: number, key: string, changes: Record<string, unknown>) =>
      send(ctx, 'PATCH', `/api/events/${id}`, {
        headers: { ...as('papa'), 'if-match': String(version), 'idempotency-key': key },
        body: { scope: 'all', changes },
      });
    // 終わりを消すと終わっていないシリーズが 1 つ増える
    const revived = await patch(ended.id, ended.version, 'h2-r1', { rrule: 'FREQ=WEEKLY' });
    expect(revived.status).toBe(409);
    expect(((await revived.json()) as { code: string }).code).toBe('series_limit');
    // 終わったままの変更・終わっていないシリーズの変更は数を増やさない
    expect((await patch(ended.id, ended.version, 'h2-r2', { title: '昔の習い事' })).status).toBe(
      200,
    );
    expect((await patch(active.id, active.version, 'h2-r3', { title: '今の習い事' })).status).toBe(
      200,
    );
    // 終わった繰り返しを作る・ゴミ箱から戻すのは、終わっていないものを増やさない
    const past = await createEvent(ctx, 'mama', {
      title: '去年の合宿',
      allDay: true,
      startDate: '2025-08-01',
      rrule: 'FREQ=DAILY;UNTIL=20250803',
      memberIds: [IDS.mama],
    });
    expect(past.res.status).toBe(201);
    const restored = await send(ctx, 'POST', `/api/events/${trashedEnded.id}/restore`, {
      headers: { ...as('mama'), 'idempotency-key': 'h2-r4' },
      body: {},
    });
    expect(restored.status).toBe(200);
  });
});
