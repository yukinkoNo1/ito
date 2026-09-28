import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { members } from '../src/db/schema';
import { createTestContext, send, type TestContext, tailscaleEnv, tsUser } from './helpers';

const root = fileURLToPath(new URL('../../../.data/test-tmp/static', import.meta.url));
let ctx: TestContext;

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>いと</title>');
  writeFileSync(path.join(root, 'sw.js'), 'self.x=1');
  writeFileSync(path.join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  mkdirSync(path.join(root, '..', 'secret'), { recursive: true });
  writeFileSync(path.join(root, '..', 'secret', 'x.txt'), 'secret');
  ctx = createTestContext(tailscaleEnv(), { staticDir: root });
});
afterAll(() => ctx.close());

describe('静的配信（SPEC §20）', () => {
  it('index.html は no-cache', async () => {
    const res = await send(ctx, 'GET', '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('画面のルートは index.html にフォールバック', async () => {
    for (const p of ['/month/2026-10', '/settings/members', '/e/abc']) {
      const res = await send(ctx, 'GET', p);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<title>いと</title>');
    }
  });

  it('JS・HTML は Accept-Encoding があれば gzip で送る（小さいものと /api/* はそのまま）', async () => {
    writeFileSync(path.join(root, 'assets', 'big-abc123.js'), `console.log(${'1+'.repeat(2000)}1)`);
    const res = await send(ctx, 'GET', '/assets/big-abc123.js', {
      headers: { 'accept-encoding': 'gzip, br' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const text = await new Response(
      (res.body as ReadableStream).pipeThrough(new DecompressionStream('gzip')),
    ).text();
    expect(text.startsWith('console.log(1+1+')).toBe(true);
    // 1KB 未満は圧縮しない
    const small = await send(ctx, 'GET', '/assets/index-abc123.js', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(small.headers.get('content-encoding')).toBeNull();
    // /api/*（同期のほか）は圧縮しない
    const api = await send(ctx, 'GET', '/api/me', { headers: { 'accept-encoding': 'gzip' } });
    expect(api.headers.get('content-encoding')).toBeNull();
  });

  it('ハッシュ付きの資産は長期キャッシュ、sw.js は no-cache', async () => {
    const asset = await send(ctx, 'GET', '/assets/index-abc123.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    const sw = await send(ctx, 'GET', '/sw.js');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('/api/* と /healthz は index.html にしない（/api/export へのページ遷移も）', async () => {
    // 登録済みのメンバーとして（identity を通ったあとでも静的配信に落ちない）
    const now = ctx.clock.now();
    ctx.database.db
      .insert(members)
      .values({
        id: '0192f5a0-1c00-7000-8000-000000000001',
        login: 'mama@example.com',
        name: 'お母さん',
        mark: '母',
        color: 'wakatake',
        aliases: '[]',
        role: 'member',
        settings: '{}',
        activityReadAt: 0,
        createdAt: now,
        updatedAt: now,
        disabledAt: null,
      })
      .run();
    for (const p of ['/api/export?format=json', '/api', '/api/nothing/here']) {
      const res = await send(ctx, 'GET', p, {
        headers: {
          accept: 'text/html',
          'sec-fetch-mode': 'navigate',
          ...tsUser('mama@example.com'),
        },
      });
      // /api/export はページ遷移では使えない（403。Phase 7 で経路ができた）。ない経路は 404
      expect(res.status).toBe(p.startsWith('/api/export') ? 403 : 404);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      expect(await res.text()).not.toContain('<title>');
    }
    const health = await send(ctx, 'GET', '/healthz', { headers: { accept: 'text/html' } });
    expect(await health.json()).toEqual({ ok: true });
  });

  it('ルートの外のファイルは読めない', async () => {
    const res = await send(ctx, 'GET', '/..%2fsecret%2fx.txt');
    expect(res.status).toBe(404);
    const res2 = await send(ctx, 'GET', '/%2e%2e/secret/x.txt');
    expect(await res2.text()).not.toBe('secret');
  });

  it('ない資産（拡張子あり）は 404', async () => {
    const res = await send(ctx, 'GET', '/assets/nothing.js');
    expect(res.status).toBe(404);
  });
});
