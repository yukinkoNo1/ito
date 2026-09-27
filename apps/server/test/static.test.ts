import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, send, type TestContext, tailscaleEnv } from './helpers';

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

  it('ハッシュ付きの資産は長期キャッシュ、sw.js は no-cache', async () => {
    const asset = await send(ctx, 'GET', '/assets/index-abc123.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    const sw = await send(ctx, 'GET', '/sw.js');
    expect(sw.headers.get('cache-control')).toBe('no-cache');
  });

  it('/api/* と /healthz は index.html にしない（/api/export へのページ遷移も）', async () => {
    const res = await send(ctx, 'GET', '/api/export', { headers: { accept: 'text/html' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
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
