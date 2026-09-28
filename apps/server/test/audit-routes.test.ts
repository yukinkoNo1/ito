import { fromJst } from '@ito/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFeedToken } from '../src/services/feed-tokens';
import {
  createTestContext,
  send,
  type TestContext,
  TS_ORIGIN,
  tailscaleEnv,
  tsUser,
} from './helpers';

/**
 * 総点検（RUNBOOK 7.「総点検」）: ルートの一覧から機械的に確かめる。
 * - 状態を変える /api/* のルート（/api/feed/* を除く）は、どれも CSRF の検査（X-Ito-Client・Content-Type・Origin・
 *   Sec-Fetch-Site）を通らなければ 403 csrf（§14・§18 T3）
 * - /api/* のルート（/api/feed/* を除く）は、ID ヘッダがなければ 401 no_identity。連携キーを付けても同じ（§13.1）
 * - /api/feed/* は ID ヘッダだけでは 401（連携キーだけで認証）
 * 本番と同じ設定（AUTH_MODE=tailscale）で確かめる
 */

const ADMIN = 'admin@example.com';
const UUID = '0192f5a0-1c00-7000-8000-00000000abcd';

let ctx: TestContext;
beforeEach(async () => {
  ctx = createTestContext(tailscaleEnv(), { now: fromJst('2026-09-27', '14:18') });
  // 管理者を自動登録させる
  const res = await send(ctx, 'GET', '/api/me', { headers: tsUser(ADMIN) });
  expect(res.status).toBe(200);
});
afterEach(() => ctx.close());

function apiRoutes() {
  const seen = new Set<string>();
  const out: { method: string; path: string }[] = [];
  for (const r of ctx.app.routes) {
    if (!r.path.startsWith('/api/') || r.method === 'ALL') continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, path: r.path.replace(/:[A-Za-z]+/g, UUID) });
  }
  return out;
}

const isFeed = (path: string) => path === '/api/feed' || path.startsWith('/api/feed/');
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

describe('ルートの一覧から確かめる（総点検）', () => {
  it('ルートの一覧が取れる（確かめる対象がある）', () => {
    const routes = apiRoutes();
    expect(routes.filter((r) => STATE_CHANGING.has(r.method)).length).toBeGreaterThan(10);
    expect(routes.some((r) => r.path === '/api/export')).toBe(true);
  });

  it('状態を変えるルートは、どれも CSRF の検査を通らなければ 403 csrf（ID ヘッダがあっても）', async () => {
    const good = {
      'x-ito-client': '1',
      'content-type': 'application/json',
      origin: TS_ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...tsUser(ADMIN),
    };
    const broken: [string, Record<string, string>][] = [
      ['X-Ito-Client なし', { 'x-ito-client': '' }],
      ['Content-Type が text/plain', { 'content-type': 'text/plain' }],
      ['Origin が違う', { origin: 'https://evil.example.com' }],
      ['Origin なし', { origin: '' }],
      ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
      ['Sec-Fetch-Site: same-site', { 'sec-fetch-site': 'same-site' }],
    ];
    const checked: string[] = [];
    for (const r of apiRoutes()) {
      if (!STATE_CHANGING.has(r.method) || isFeed(r.path)) continue;
      for (const [label, over] of broken) {
        const res = await send(ctx, r.method, r.path, {
          csrf: false,
          headers: { ...good, ...over },
          body: '{}',
        });
        const body = (await res.json()) as { code?: string };
        expect([r.method, r.path, label, res.status, body.code]).toEqual([
          r.method,
          r.path,
          label,
          403,
          'csrf',
        ]);
      }
      checked.push(`${r.method} ${r.path}`);
    }
    expect(checked.length).toBeGreaterThan(10);
  });

  it('/api/*（/api/feed/* を除く）は、ID ヘッダがなければ 401 no_identity（連携キーを付けても）', async () => {
    const { token } = createFeedToken(ctx.database.db, ctx.clock, 'いえボード');
    for (const r of apiRoutes()) {
      if (isFeed(r.path)) continue;
      const auths: Record<string, string>[] = [{}, { authorization: `Bearer ${token}` }];
      for (const auth of auths) {
        const res = await send(ctx, r.method, r.path, {
          headers: {
            ...auth,
            'x-ito-client': '1',
            'content-type': 'application/json',
            origin: TS_ORIGIN,
            'sec-fetch-site': 'same-origin',
          },
          body: STATE_CHANGING.has(r.method) ? '{}' : undefined,
          csrf: false,
        });
        const body = (await res.json()) as { code?: string };
        expect([r.method, r.path, res.status, body.code]).toEqual([
          r.method,
          r.path,
          401,
          'no_identity',
        ]);
        // 応答に連携キーの平文を返さない
        expect(JSON.stringify(body)).not.toContain(token);
      }
    }
  });

  it('GET の /api/*（/api/feed/* を除く）も、X-Ito-Client がないか別のサイトからなら 403 csrf（§14 の 4.・§24 D39）', async () => {
    const broken: [string, Record<string, string>][] = [
      ['X-Ito-Client なし', { 'x-ito-client': '' }],
      ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
      ['Sec-Fetch-Site: same-site', { 'sec-fetch-site': 'same-site' }],
      ['Sec-Fetch-Site: none', { 'sec-fetch-site': 'none' }],
    ];
    const checked: string[] = [];
    for (const r of apiRoutes()) {
      if (r.method !== 'GET' || isFeed(r.path)) continue;
      for (const [label, over] of broken) {
        const res = await send(ctx, 'GET', r.path, {
          csrf: false,
          headers: { 'x-ito-client': '1', ...tsUser(ADMIN), ...over },
        });
        const body = (await res.json()) as { code?: string };
        expect([r.path, label, res.status, body.code]).toEqual([r.path, label, 403, 'csrf']);
      }
      checked.push(r.path);
    }
    expect(checked).toContain('/api/sync');
  });

  it('/api の外のルートは GET /healthz だけ（状態を変えるルートを CSRF・本人確認の外に置かない）', () => {
    const outside = new Set(
      ctx.app.routes
        .filter((r) => !r.path.startsWith('/api/') && r.method !== 'ALL')
        .map((r) => `${r.method} ${r.path}`),
    );
    expect([...outside]).toEqual(['GET /healthz']);
  });

  it('/api/feed/* は ID ヘッダだけでは使えない（連携キーだけで認証）', async () => {
    const feeds = apiRoutes().filter((r) => isFeed(r.path));
    expect(feeds.length).toBeGreaterThan(0);
    for (const r of feeds) {
      const res = await send(ctx, r.method, r.path, { csrf: false, headers: tsUser(ADMIN) });
      expect([r.path, res.status]).toEqual([r.path, 401]);
    }
  });
});
