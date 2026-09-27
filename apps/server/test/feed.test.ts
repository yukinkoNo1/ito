import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type DisplayFeedV1, displayFeedV1Schema, fromJst } from '@ito/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { feedTokens } from '../src/db/schema';
import { createFeedToken, hashFeedToken } from '../src/services/feed-tokens';
import { allDay, as, createEvent, deleteEvent, IDS, seedFamily, timed, type Who } from './family';
import { createTestContext, devEnv, send, type TestContext, tailscaleEnv, tsUser } from './helpers';

const EXAMPLE_PATH = fileURLToPath(
  new URL('../../../docs/contracts/display-feed.v1.example.json', import.meta.url),
);
const NOW = fromJst('2026-09-29', '07:30');

let ctx: TestContext;
afterEach(() => ctx?.close());

function setup(env = devEnv()) {
  ctx = createTestContext(env, { now: NOW });
  seedFamily(ctx);
  const { token, row } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
  return { token, tokenId: row.id };
}

function feed(
  token: string | null,
  query = '?days=3',
  headers: Record<string, string> = {},
  method = 'GET',
) {
  return send(ctx, method, `/api/feed/display${query}`, {
    csrf: false,
    headers: { ...(token !== null ? { authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

async function feedJson(
  token: string,
  query = '?days=3',
  headers: Record<string, string> = {},
): Promise<DisplayFeedV1> {
  const res = await feed(token, query, headers);
  expect(res.status).toBe(200);
  return displayFeedV1Schema.parse(await res.json());
}

/** 例のファイル（§13.1）と同じ予定を入れる。朝練（繰り返し）は Phase 3 */
async function seedExample() {
  const ev = (n: number) => `0192f5b1-0000-7000-8000-00000000e00${n}`;
  const add = async (who: Who, body: Record<string, unknown>) => {
    const { res } = await createEvent(ctx, who, body);
    expect(res.status).toBe(201);
  };
  await add('papa', {
    ...allDay('2026-09-28', '2026-09-30'),
    id: ev(1),
    title: '出張（東京）',
    memberIds: [IDS.papa],
  });
  await add('mama', {
    ...timed('2026-09-29', '10:00', '11:00'),
    id: ev(2),
    title: '歯医者',
    memberIds: [IDS.mama],
    location: '駅前歯科',
    note: 'メモ',
  });
  await add('yuki', {
    ...timed('2026-09-29', '17:00', null),
    id: ev(3),
    title: 'プレゼント選び',
    visibility: 'private',
  });
  await add('yuki', {
    ...timed('2026-09-29', '19:00', '22:00'),
    id: ev(4),
    title: 'バイト',
    memberIds: [IDS.yuki],
  });
  await add('mama', {
    ...allDay('2026-09-30', '2026-09-30'),
    id: ev(5),
    title: '町内会の当番',
    memberIds: [IDS.yuki, IDS.mama],
    busy: false,
  });
  await add('papa', {
    ...timed('2026-10-01', '18:00', '20:00'),
    id: ev(7),
    title: '焼肉',
    forEveryone: true,
  });
  await add('papa', {
    ...timed('2026-10-01', '22:00', null),
    endAt: '2026-10-02T01:00:00+09:00',
    id: ev(8),
    title: '夜釣り',
    memberIds: [IDS.papa],
  });
}

describe('表示用フィード（§13.1・§21）', () => {
  it('例のファイルと一致する（パースした値で比べる。Phase 1 は朝練を除く）', async () => {
    const { token } = setup();
    await seedExample();
    const got = await feedJson(token);
    const example = displayFeedV1Schema.parse(JSON.parse(readFileSync(EXAMPLE_PATH, 'utf8')));
    const withoutRecurring = {
      ...example,
      occurrences: example.occurrences.filter((o) => !o.key.includes('@')),
    };
    expect(got).toEqual(withoutRecurring);
  });

  it('場所・メモ・作成者・更新日時・rrule・version は出さない。本文は 20KB 未満', async () => {
    const { token } = setup();
    await seedExample();
    const res = await feed(token);
    const text = await res.text();
    expect(text).not.toMatch(/駅前歯科|メモ|プレゼント選び|createdBy|updatedAt|rrule|"version":2/);
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(20 * 1024);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  describe('認証（連携キー）', () => {
    it('キーなし・形が違う・知らない・止めた・scope 違いは、どれも同じ 401', async () => {
      const { token, tokenId } = setup();
      const other = createFeedToken(ctx.database.db, ctx.clock, 'べつのアプリ');
      ctx.database.db
        .update(feedTokens)
        .set({ scope: 'personal' })
        .where(eq(feedTokens.id, other.row.id))
        .run();
      const revoked = createFeedToken(ctx.database.db, ctx.clock, '止めたキー');
      ctx.database.db
        .update(feedTokens)
        .set({ revokedAt: NOW })
        .where(eq(feedTokens.id, revoked.row.id))
        .run();

      const variants: (Record<string, string> | null)[] = [
        {},
        { authorization: 'Basic abc' },
        { authorization: 'Bearer abc' },
        { authorization: `Bearer ito_feed_${'A'.repeat(43)}` },
        { authorization: `Bearer ${token}x` },
        { authorization: `Bearer ${revoked.token}` },
        { authorization: `Bearer ${other.token}` },
      ];
      const bodies = new Set<string>();
      for (const headers of variants) {
        const res = await send(ctx, 'GET', '/api/feed/display', {
          csrf: false,
          headers: headers ?? {},
        });
        expect(res.status).toBe(401);
        expect(res.headers.get('etag')).toBeNull();
        bodies.add(await res.text());
      }
      expect(bodies.size).toBe(1);
      expect(JSON.parse([...bodies][0] as string).code).toBe('feed_unauthorized');
      expect(tokenId).toBeTruthy();
    });

    it('止めたキーは次の要求から 401', async () => {
      const { token, tokenId } = setup();
      expect((await feed(token)).status).toBe(200);
      ctx.database.db
        .update(feedTokens)
        .set({ revokedAt: NOW })
        .where(eq(feedTokens.id, tokenId))
        .run();
      expect((await feed(token)).status).toBe(401);
    });

    it('正しい ETag を付けても、キーが通らなければ 304 にならない', async () => {
      const { token } = setup();
      const first = await feed(token);
      const etag = first.headers.get('etag') as string;
      const res = await feed(null, '?days=3', { 'if-none-match': etag });
      expect(res.status).toBe(401);
      expect(res.headers.get('etag')).toBeNull();
    });

    it('連携キーでほかの API は使えない（ID ヘッダなしなら 401 no_identity のまま）', async () => {
      ctx = createTestContext(tailscaleEnv(), { now: NOW });
      seedFamily(ctx);
      const { token } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
      for (const path of ['/api/me', '/api/sync', '/api/activity', '/api/trash', '/api/members']) {
        const res = await send(ctx, 'GET', path, { headers: { authorization: `Bearer ${token}` } });
        expect(res.status).toBe(401);
        expect(((await res.json()) as { code: string }).code).toBe('no_identity');
      }
      const post = await send(ctx, 'POST', '/api/events', {
        headers: { authorization: `Bearer ${token}`, 'idempotency-key': 'x' },
        body: timed('2026-09-29', '10:00', null),
      });
      expect(post.status).toBe(401);
    });

    it('/api/feed/* には identity を掛けない（ID ヘッダだけでは 401 feed_unauthorized）', async () => {
      ctx = createTestContext(tailscaleEnv(), { now: NOW });
      seedFamily(ctx);
      const res = await send(ctx, 'GET', '/api/feed/display', {
        headers: tsUser('papa@example.com'),
      });
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('feed_unauthorized');
    });

    it('知らないフィードのパスは、キーが通るまで 401、通れば 404', async () => {
      const { token } = setup();
      expect((await send(ctx, 'GET', '/api/feed/other', { csrf: false })).status).toBe(401);
      expect(
        (
          await send(ctx, 'GET', '/api/feed/other', {
            csrf: false,
            headers: { authorization: `Bearer ${token}` },
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('人の端末からの要求（FEED_ALLOW_USER_DEVICES）', () => {
    it('false（既定）なら ID ヘッダ付きは 403 feed_user_device', async () => {
      ctx = createTestContext(tailscaleEnv(), { now: NOW });
      seedFamily(ctx);
      const { token } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
      const res = await send(ctx, 'GET', '/api/feed/display', {
        headers: { authorization: `Bearer ${token}`, ...tsUser('papa@example.com') },
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('feed_user_device');
    });

    it('true なら 200。非公開の持ち主の ID でも title: null、feed-token list 用に時刻を残し、WARN を 1 時間に 1 回', async () => {
      ctx = createTestContext(tailscaleEnv({ FEED_ALLOW_USER_DEVICES: 'true' }), { now: NOW });
      seedFamily(ctx);
      const { token, row } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
      // ゆきの非公開を DB に入れる（tailscale モードなので API は ID ヘッダで）
      const created = await send(ctx, 'POST', '/api/events', {
        headers: { ...tsUser('yuki@example.com'), 'idempotency-key': 'y1' },
        body: { ...timed('2026-09-29', '17:00', null), title: '内緒', visibility: 'private' },
      });
      expect(created.status).toBe(201);
      const res = await send(ctx, 'GET', '/api/feed/display', {
        headers: { authorization: `Bearer ${token}`, ...tsUser('yuki@example.com') },
      });
      expect(res.status).toBe(200);
      const body = displayFeedV1Schema.parse(await res.json());
      expect(body.occurrences).toHaveLength(1);
      expect(body.occurrences[0]).toMatchObject({
        title: null,
        private: true,
        memberIds: [IDS.yuki],
      });
      const stored = ctx.database.db
        .select()
        .from(feedTokens)
        .where(eq(feedTokens.id, row.id))
        .get();
      expect(stored?.lastUserDeviceAt).toBe(NOW);
      await send(ctx, 'GET', '/api/feed/display', {
        headers: { authorization: `Bearer ${token}`, ...tsUser('yuki@example.com') },
      });
      expect(ctx.logs.text.match(/feed used from a user device/g)).toHaveLength(1);
    });

    it('開発モードでは X-Dev-Login 付きを人の端末とみなす（DEV_LOGIN の既定の本人は数えない）', async () => {
      const { token } = setup();
      expect((await feed(token)).status).toBe(200);
      expect((await feed(token, '?days=3', as('mama'))).status).toBe(403);
    });
  });

  describe('メソッドとパラメータ', () => {
    it('GET・HEAD 以外は CSRF の 403 ではなく 405', async () => {
      const { token } = setup();
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        const withCsrf = await send(ctx, method, '/api/feed/display', {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(withCsrf.status).toBe(405);
        expect(withCsrf.headers.get('allow')).toBe('GET, HEAD');
        const bare = await feed(null, '', {}, method);
        expect(bare.status).toBe(405);
      }
    });

    it('HEAD は本文なしで ETag を返す', async () => {
      const { token } = setup();
      const get = await feed(token);
      const head = await feed(token, '?days=3', {}, 'HEAD');
      expect(head.status).toBe(200);
      expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
      expect(await head.text()).toBe('');
    });

    it.each([
      '?days=0',
      '?days=4',
      '?days=abc',
      '?days=1.5',
      '?days=',
      '?days=01',
      '?days=1&days=2',
      '?days=1&x=1',
      '?foo=1',
    ])('%s は 400 invalid_query', async (query) => {
      const { token } = setup();
      const res = await feed(token, query);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('invalid_query');
    });

    it('days の既定は 3。範囲は JST の [今日, 今日+days)', async () => {
      const { token } = setup();
      expect((await feedJson(token, '')).range).toEqual({ from: '2026-09-29', to: '2026-10-02' });
      expect((await feedJson(token, '?days=1')).range).toEqual({
        from: '2026-09-29',
        to: '2026-09-30',
      });
      // 23:59 はまだ同じ日、0:00 で翌日（サーバーのタイムゾーンに依存しない）
      ctx.clock.set(fromJst('2026-09-29', '23:59'));
      expect((await feedJson(token, '?days=1')).range.from).toBe('2026-09-29');
      ctx.clock.set(fromJst('2026-09-30', '00:00'));
      expect((await feedJson(token, '?days=1')).range.from).toBe('2026-09-30');
    });
  });

  describe('範囲にかかる回の選び方', () => {
    it('前日から続く終日・日付をまたぐ時刻予定は入り、ちょうど 0:00 に終わる予定・範囲の前の終了なしは入らない', async () => {
      const { token } = setup();
      const add = async (title: string, body: Record<string, unknown>) =>
        createEvent(ctx, 'papa', { ...body, title, memberIds: [IDS.papa] });
      await add('昨日で終わる終日', allDay('2026-09-28', '2026-09-28'));
      await add('昨日から続く終日', allDay('2026-09-28', '2026-09-29'));
      await add('夜中をまたぐ', {
        ...timed('2026-09-28', '22:00', null),
        endAt: '2026-09-29T01:00:00+09:00',
      });
      await add('ちょうど0時に終わる', {
        ...timed('2026-09-28', '23:00', null),
        endAt: '2026-09-29T00:00:00+09:00',
      });
      await add('昨日の終了なし', timed('2026-09-28', '20:00', null));
      await add('今日0時の終了なし', timed('2026-09-29', '00:00', null));
      await add('範囲の終わりをまたぐ', {
        ...timed('2026-10-01', '23:00', null),
        endAt: '2026-10-02T01:00:00+09:00',
      });
      await add('範囲の外（10/2 0時）', timed('2026-10-02', '00:00', null));
      await add('範囲の外（10/2 終日）', allDay('2026-10-02', '2026-10-02'));
      const titles = (await feedJson(token)).occurrences.map((o) => o.title);
      expect(titles).toEqual([
        '昨日から続く終日',
        '夜中をまたぐ',
        '今日0時の終了なし',
        '範囲の終わりをまたぐ',
      ]);
    });

    it('同じ開始なら終日が先、次に終わりの早い順（終了なしは開始と同じ）、次に key', async () => {
      const { token } = setup();
      const ids = ['0192f5b1-0000-7000-8000-0000000000a2', '0192f5b1-0000-7000-8000-0000000000a1'];
      await createEvent(ctx, 'papa', {
        ...timed('2026-09-29', '00:00', '02:00'),
        title: '長い',
        id: '0192f5b1-0000-7000-8000-0000000000a3',
      });
      await createEvent(ctx, 'papa', {
        ...timed('2026-09-29', '00:00', null),
        title: 'B',
        id: ids[0],
      });
      await createEvent(ctx, 'papa', {
        ...timed('2026-09-29', '00:00', null),
        title: 'A',
        id: ids[1],
      });
      await createEvent(ctx, 'papa', { ...allDay('2026-09-29', '2026-09-29'), title: '終日' });
      const titles = (await feedJson(token, '?days=1')).occurrences.map((o) => o.title);
      expect(titles).toEqual(['終日', 'A', 'B', '長い']);
    });

    it('ゴミ箱の予定は出さない', async () => {
      const { token } = setup();
      const { event } = await createEvent(ctx, 'papa', {
        ...timed('2026-09-29', '10:00', null),
        title: '消す',
      });
      await deleteEvent(ctx, 'papa', event.id, 1);
      expect((await feedJson(token)).occurrences).toHaveLength(0);
    });

    it('無効化したメンバーの ID は除き、担当が全員無効化した回は出さない（全員の予定は出す）', async () => {
      const { token } = setup();
      await createEvent(ctx, 'papa', {
        ...timed('2026-09-29', '10:00', null),
        title: 'はるだけ',
        memberIds: [IDS.haru],
      });
      await createEvent(ctx, 'papa', {
        ...timed('2026-09-29', '11:00', null),
        title: '母とはる',
        memberIds: [IDS.haru, IDS.mama],
      });
      await createEvent(ctx, 'haru', {
        ...timed('2026-09-29', '12:00', null),
        title: 'みんな',
        forEveryone: true,
      });
      await createEvent(ctx, 'haru', {
        ...timed('2026-09-29', '13:00', null),
        title: 'はるの内緒',
        visibility: 'private',
      });
      await send(ctx, 'PATCH', `/api/members/${IDS.haru}`, {
        headers: as('papa'),
        body: { disabled: true },
      });
      const body = await feedJson(token);
      expect(body.members.map((m) => m.name)).toEqual(['お父さん', 'お母さん', 'ゆき']);
      expect(body.occurrences.map((o) => [o.title, o.memberIds])).toEqual([
        ['母とはる', [IDS.mama]],
        ['みんな', []],
      ]);
    });

    it('members は作成順、memberIds は members と同じ順で重複なし', async () => {
      const { token } = setup();
      await createEvent(ctx, 'papa', {
        ...timed('2026-09-29', '10:00', null),
        memberIds: [IDS.haru, IDS.papa, IDS.yuki],
      });
      const body = await feedJson(token);
      expect(body.members.map((m) => m.id)).toEqual([IDS.papa, IDS.mama, IDS.yuki, IDS.haru]);
      expect(body.occurrences[0]?.memberIds).toEqual([IDS.papa, IDS.yuki, IDS.haru]);
    });

    it('範囲内の祝日（振替休日・国民の休日を含む）を日付の順で', async () => {
      const { token } = setup();
      ctx.clock.set(fromJst('2026-09-21', '09:00'));
      expect((await feedJson(token)).holidays).toEqual([
        { date: '2026-09-21', name: '敬老の日' },
        { date: '2026-09-22', name: '休日' }, // holiday_jp の名前（国民の休日）
        { date: '2026-09-23', name: '秋分の日' },
      ]);
      ctx.clock.set(fromJst('2026-10-11', '09:00'));
      expect((await feedJson(token)).holidays).toEqual([
        { date: '2026-10-12', name: 'スポーツの日' },
      ]);
    });
  });

  describe('ETag と 304', () => {
    it('同じデータで同じ本文と ETag、If-None-Match で 304（同じ ETag）、日付が変わると ETag が変わる', async () => {
      const { token } = setup();
      await seedExample();
      const a = await feed(token);
      const b = await feed(token);
      const etag = a.headers.get('etag') as string;
      expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(b.headers.get('etag')).toBe(etag);
      expect(await a.text()).toBe(await b.text());
      const notModified = await feed(token, '?days=3', { 'if-none-match': etag });
      expect(notModified.status).toBe(304);
      expect(notModified.headers.get('etag')).toBe(etag);
      expect(await notModified.text()).toBe('');
      ctx.clock.set(fromJst('2026-09-30', '07:30'));
      expect((await feed(token)).headers.get('etag')).not.toBe(etag);
    });

    it('予定が変わると ETag が変わる', async () => {
      const { token } = setup();
      const before = (await feed(token)).headers.get('etag');
      await createEvent(ctx, 'papa', { ...timed('2026-09-29', '10:00', null), title: '追加' });
      expect((await feed(token)).headers.get('etag')).not.toBe(before);
    });
  });

  describe('回数制限と最終利用時刻', () => {
    it('キーなしの要求をいくら送っても、正しいキーは 429 にならない。キーごとに 120 回/分', async () => {
      const { token } = setup();
      for (let i = 0; i < 300; i++) expect((await feed(null)).status).toBe(401);
      for (let i = 0; i < 120; i++) expect((await feed(token)).status).toBe(200);
      const limited = await feed(token);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
      // ほかのキーは数えない
      const other = createFeedToken(ctx.database.db, ctx.clock, 'べつ');
      expect((await feed(other.token)).status).toBe(200);
      ctx.clock.advance(61_000);
      expect((await feed(token)).status).toBe(200);
    });

    it('認証の失敗のログは 1 分に 1 回まで', async () => {
      setup();
      for (let i = 0; i < 50; i++) await feed(null);
      expect(ctx.logs.text.match(/feed auth failed/g)).toHaveLength(1);
    });

    it('last_used_at は 5 分に 1 回まで書く', async () => {
      const { token, tokenId } = setup();
      const read = () =>
        ctx.database.db.select().from(feedTokens).where(eq(feedTokens.id, tokenId)).get()
          ?.lastUsedAt;
      await feed(token);
      expect(read()).toBe(NOW);
      ctx.clock.advance(60_000);
      await feed(token);
      expect(read()).toBe(NOW);
      ctx.clock.advance(4 * 60_000);
      await feed(token);
      expect(read()).toBe(NOW + 5 * 60_000);
    });
  });

  it('連携キーの平文はログ・DB・エラー応答に出ない', async () => {
    const { token } = setup();
    await feed(token);
    await feed(`${token}x`);
    await send(ctx, 'GET', '/api/me', { headers: { authorization: `Bearer ${token}` } });
    expect(ctx.logs.text).not.toContain(token);
    const dump = JSON.stringify(ctx.database.db.select().from(feedTokens).all());
    expect(dump).not.toContain(token);
    expect(dump).toContain(hashFeedToken(token));
  });
});
