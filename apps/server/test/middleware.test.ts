import { afterEach, describe, expect, it } from 'vitest';
import { members } from '../src/db/schema';
import { SECURITY_HEADERS } from '../src/middleware/security-headers';
import { autoRegisterAdmin, listActiveMembers } from '../src/services/members';
import { createTestContext, devEnv, send, type TestContext, tailscaleEnv, tsUser } from './helpers';

let ctx: TestContext;
afterEach(() => ctx?.close());

function addMember(c: TestContext, login: string, name: string, color: string, disabled = false) {
  const now = c.clock.now();
  c.database.db
    .insert(members)
    .values({
      id: `0192f5a0-1c00-7000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`,
      login,
      name,
      mark: name.slice(0, 1),
      color,
      aliases: '[]',
      role: 'member',
      settings: '{}',
      activityReadAt: 0,
      createdAt: now,
      updatedAt: now,
      disabledAt: disabled ? now : null,
    })
    .run();
}

describe('identity（SPEC §14）', () => {
  it('ID ヘッダなしは 401 no_identity（problem+json）', async () => {
    ctx = createTestContext(tailscaleEnv());
    const res = await send(ctx, 'GET', '/api/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe('no_identity');
    expect(body.status).toBe(401);
    expect(typeof body.title).toBe('string');
  });

  it('未登録は 403 not_member', async () => {
    ctx = createTestContext(tailscaleEnv());
    const res = await send(ctx, 'GET', '/api/me', { headers: tsUser('stranger@example.com') });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_member');
  });

  it('無効化したメンバーは 403 not_member', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'gone@example.com', 'いなくなった人', 'fuji', true);
    const res = await send(ctx, 'GET', '/api/me', { headers: tsUser('gone@example.com') });
    expect(res.status).toBe(403);
  });

  it('登録済みのメンバーは 200（ログインは小文字化して照合）', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const res = await send(ctx, 'GET', '/api/me', { headers: tsUser('  Mama@Example.com ') });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { name: string }).name).toBe('お母さん');
  });

  it('ADMIN_LOGINS のログインは初回アクセスで管理者として自動登録（RFC 2047 の名前をデコード）', async () => {
    ctx = createTestContext(tailscaleEnv());
    // "お父さん" を UTF-8 の B エンコードで
    const encoded = `=?utf-8?B?${Buffer.from('お父さん').toString('base64')}?=`;
    const res = await send(ctx, 'GET', '/api/me', {
      headers: tsUser('admin@example.com', encoded),
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as { name: string; role: string; color: string; mark: string };
    expect(me).toMatchObject({ name: 'お父さん', role: 'admin', color: 'yamabuki', mark: 'お' });
  });

  it('自動登録で名前がぶつかったら末尾に 2 を付け、色は未使用の最初の色', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'someone@example.com', 'admin', 'yamabuki');
    const res = await send(ctx, 'GET', '/api/me', { headers: tsUser('admin@example.com') });
    expect(res.status).toBe(200);
    const me = (await res.json()) as { name: string; color: string };
    expect(me.name).toBe('admin2');
    expect(me.color).toBe('wakakusa');
  });

  it('自動登録の名前は 20 文字に収める', () => {
    ctx = createTestContext(tailscaleEnv());
    const long = 'あ'.repeat(25);
    addMember(ctx, 'x@example.com', 'あ'.repeat(20), 'yamabuki');
    const row = autoRegisterAdmin(ctx.database.db, ctx.clock, 6, 'admin@example.com', long);
    expect(row?.name).toBe(`${'あ'.repeat(19)}2`);
  });

  it('切り詰めたあとの名前の前後に空白を残さない', () => {
    ctx = createTestContext(tailscaleEnv());
    const row = autoRegisterAdmin(
      ctx.database.db,
      ctx.clock,
      6,
      'admin@example.com',
      `${'あ'.repeat(19)} い`,
    );
    expect(row?.name).toBe('あ'.repeat(19));
  });

  it('上限（MAX_MEMBERS）に達していたら自動登録しない', async () => {
    ctx = createTestContext(tailscaleEnv({ MAX_MEMBERS: '1' }));
    addMember(ctx, 'someone@example.com', 'だれか', 'yamabuki');
    const res = await send(ctx, 'GET', '/api/me', { headers: tsUser('admin@example.com') });
    expect(res.status).toBe(403);
    expect(listActiveMembers(ctx.database.db)).toHaveLength(1);
  });

  it('本番では X-Dev-Login を無視する', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const res = await send(ctx, 'GET', '/api/me', {
      headers: { 'x-dev-login': 'mama@example.com' },
    });
    expect(res.status).toBe(401);
  });

  it('開発モードでは X-Dev-Login で本人を切り替えられ、なければ DEV_LOGIN', async () => {
    ctx = createTestContext(devEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const asMama = await send(ctx, 'GET', '/api/me', {
      headers: { 'x-dev-login': 'mama@example.com' },
    });
    expect(((await asMama.json()) as { name: string }).name).toBe('お母さん');
    const asDefault = await send(ctx, 'GET', '/api/me');
    expect(asDefault.status).toBe(200);
    expect(((await asDefault.json()) as { role: string }).role).toBe('admin');
  });

  it('開発モードでは Tailscale-User-Login を使わない', async () => {
    ctx = createTestContext(devEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const res = await send(ctx, 'GET', '/api/me', { headers: tsUser('mama@example.com') });
    expect(((await res.json()) as { role: string }).role).toBe('admin');
  });
});

describe('CSRF（SPEC §14）', () => {
  function authed() {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    return tsUser('mama@example.com');
  }

  it('X-Ito-Client がなければ 403', async () => {
    const h = authed();
    const res = await send(ctx, 'POST', '/api/me', { headers: { ...h, 'x-ito-client': '' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('csrf');
  });

  it('Content-Type が application/json でなければ 403', async () => {
    const h = authed();
    const headers = { ...h, 'content-type': 'text/plain' };
    const res = await send(ctx, 'POST', '/api/me', { headers });
    expect(res.status).toBe(403);
  });

  it('Origin が APP_ORIGIN と一致しなければ 403（なしも 403）', async () => {
    const h = authed();
    expect(
      (await send(ctx, 'POST', '/api/me', { headers: { ...h, origin: 'https://evil.example' } }))
        .status,
    ).toBe(403);
    expect((await send(ctx, 'POST', '/api/me', { headers: { ...h, origin: '' } })).status).toBe(
      403,
    );
  });

  it('Sec-Fetch-Site: cross-site は 403（same-site も 403）', async () => {
    const h = authed();
    expect(
      (await send(ctx, 'PATCH', '/api/me', { headers: { ...h, 'sec-fetch-site': 'cross-site' } }))
        .status,
    ).toBe(403);
    expect(
      (await send(ctx, 'DELETE', '/api/me', { headers: { ...h, 'sec-fetch-site': 'same-site' } }))
        .status,
    ).toBe(403);
  });

  it('すべてそろえば CSRF の検査を通る（ルートがないので 404）', async () => {
    const h = authed();
    const res = await send(ctx, 'POST', '/api/me', { headers: h });
    expect(res.status).toBe(404);
  });

  it('Sec-Fetch-Site がなければ（古いブラウザ）Origin だけで判定する', async () => {
    const h = authed();
    const res = await send(ctx, 'POST', '/api/me', { headers: { ...h, 'sec-fetch-site': '' } });
    expect(res.status).toBe(404);
  });

  it('CSRF の検査は identity より先（ID ヘッダがあっても 403）', async () => {
    const h = authed();
    const res = await send(ctx, 'POST', '/api/me', { csrf: false, headers: h });
    expect(res.status).toBe(403);
  });

  it('GET には CSRF の検査を掛けない（クロスサイトの Origin・Sec-Fetch-Site でも 200）', async () => {
    const h = authed();
    const res = await send(ctx, 'GET', '/api/me', {
      headers: { ...h, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.status).toBe(200);
  });

  it('ホーム画面・通知から開くとき（Sec-Fetch-Site: none、Origin なし）の GET も通る', async () => {
    const h = authed();
    const res = await send(ctx, 'GET', '/api/me', { headers: { ...h, 'sec-fetch-site': 'none' } });
    expect(res.status).toBe(200);
  });

  it('対応しないプロトコル版は 426 client_outdated', async () => {
    const h = authed();
    const res = await send(ctx, 'POST', '/api/me', { headers: { ...h, 'x-ito-client': '0' } });
    expect(res.status).toBe(426);
    expect(((await res.json()) as { code: string }).code).toBe('client_outdated');
  });
});

describe('Host 検査・/healthz（SPEC §14）', () => {
  it('Host が APP_ORIGIN と一致しなければ 421（API・静的配信とも）', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const api = await send(ctx, 'GET', '/api/me', {
      host: 'evil.example',
      headers: tsUser('mama@example.com'),
    });
    expect(api.status).toBe(421);
    const page = await send(ctx, 'GET', '/', { host: '100.64.0.1:8787' });
    expect(page.status).toBe(421);
  });

  it('Host は大文字小文字を区別しない', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const res = await send(ctx, 'GET', '/api/me', {
      host: 'ITO.example.TS.net',
      headers: tsUser('mama@example.com'),
    });
    expect(res.status).toBe(200);
  });

  it('/healthz は Host に関係なく 200', async () => {
    ctx = createTestContext(tailscaleEnv());
    for (const host of ['127.0.0.1:8787', 'evil.example', 'ito.example.ts.net']) {
      const res = await send(ctx, 'GET', '/healthz', { host });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
  });

  it('Host の例外は /healthz ちょうどだけ（/healthz/ や /healthz/x は 421）', async () => {
    ctx = createTestContext(tailscaleEnv());
    expect((await send(ctx, 'GET', '/healthz/', { host: 'evil.example' })).status).toBe(421);
    expect((await send(ctx, 'GET', '/healthz/x', { host: 'evil.example' })).status).toBe(421);
    expect((await send(ctx, 'GET', '/healthzz', { host: 'evil.example' })).status).toBe(421);
  });
});

describe('ヘッダ・本文の上限', () => {
  it('セキュリティヘッダは全応答（200・401・404・421・エラー）に付く', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const responses = [
      await send(ctx, 'GET', '/healthz'),
      await send(ctx, 'GET', '/api/me', { headers: tsUser('mama@example.com') }),
      await send(ctx, 'GET', '/api/me'),
      await send(ctx, 'GET', '/api/nothing', { headers: tsUser('mama@example.com') }),
      await send(ctx, 'GET', '/', { host: 'evil.example' }),
      await send(ctx, 'POST', '/api/me', { csrf: false, headers: tsUser('mama@example.com') }),
    ];
    for (const res of responses) {
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    }
  });

  it('API の応答は Cache-Control: no-store（エラーも）', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    expect(
      (await send(ctx, 'GET', '/api/me', { headers: tsUser('mama@example.com') })).headers.get(
        'cache-control',
      ),
    ).toBe('no-store');
    expect((await send(ctx, 'GET', '/api/me')).headers.get('cache-control')).toBe('no-store');
    expect((await send(ctx, 'GET', '/healthz')).headers.get('cache-control')).toBe('no-store');
    // Host 不一致（421）と本文の上限（413）の API 応答にも付く
    const misdirected = await send(ctx, 'GET', '/api/me', {
      host: 'evil.example',
      headers: tsUser('mama@example.com'),
    });
    expect(misdirected.status).toBe(421);
    expect(misdirected.headers.get('cache-control')).toBe('no-store');
    const big = JSON.stringify({ text: 'x'.repeat(33 * 1024) });
    const tooLarge = await send(ctx, 'POST', '/api/me', {
      headers: tsUser('mama@example.com'),
      body: big,
    });
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.headers.get('cache-control')).toBe('no-store');
  });

  it('identity と CSRF は /api/feed/* に掛けない（境目: /api/feedx・/api/feed-x には掛ける）', async () => {
    ctx = createTestContext(tailscaleEnv());
    // /api/feed/* は ID ヘッダも CSRF のヘッダもなしで identity・CSRF に止められない
    const feed = await send(ctx, 'GET', '/api/feed/display');
    expect(((await feed.json()) as { code: string }).code).not.toBe('no_identity');
    const feedPost = await send(ctx, 'POST', '/api/feed/display', { csrf: false });
    expect(((await feedPost.json()) as { code: string }).code).not.toBe('csrf');
    for (const p of ['/api/feedx', '/api/feed-x', '/api/feeds/display']) {
      const res = await send(ctx, 'GET', p);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('no_identity');
    }
    // /api/feed/* でも Host 検査とセキュリティヘッダは掛かる
    const misdirected = await send(ctx, 'GET', '/api/feed/display', { host: 'evil.example' });
    expect(misdirected.status).toBe(421);
    expect(misdirected.headers.get('content-security-policy')).toBe(
      SECURITY_HEADERS['Content-Security-Policy'],
    );
  });

  it('本文が 32KB を超えたら 413', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const big = JSON.stringify({ text: 'x'.repeat(33 * 1024) });
    const res = await send(ctx, 'POST', '/api/me', {
      headers: tsUser('mama@example.com'),
      body: big,
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('payload_too_large');
  });

  it('知らない API は 404 problem+json（index.html にならない）', async () => {
    ctx = createTestContext(tailscaleEnv());
    addMember(ctx, 'mama@example.com', 'お母さん', 'wakatake');
    const res = await send(ctx, 'GET', '/api/unknown', { headers: tsUser('mama@example.com') });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});
