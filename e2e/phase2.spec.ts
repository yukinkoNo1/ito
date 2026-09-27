import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { api, ensureFamily, ORIGIN } from './helpers';

const SW_PATH = fileURLToPath(new URL('../apps/web/dist-e2e/sw.js', import.meta.url));
const OFFLINE = /net::ERR_INTERNET_DISCONNECTED/;
const ABORTED = /net::ERR_FAILED/;
const CONFLICT = /status of 409/;

let seq = 0;
async function createAs(
  request: APIRequestContext,
  who: 'papa' | 'mama',
  body: Record<string, unknown>,
): Promise<{ id: string; version: number }> {
  seq++;
  const res = await request.fetch('/api/events', {
    method: 'POST',
    headers: {
      'X-Dev-Login': who === 'papa' ? 'papa@example.com' : 'mama@example.com',
      'X-Ito-Client': '1',
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'Idempotency-Key': `e2e-p2-${Date.now()}-${seq}`,
    },
    data: JSON.stringify(body),
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { event: { id: string; version: number } }).event;
}

async function serverTitles(request: APIRequestContext): Promise<string[]> {
  const sync = (await (await api(request, 'papa', 'GET', '/api/sync?cursor=0')).json()) as {
    events: { title: string | null }[];
  };
  return sync.events.map((e) => e.title ?? '');
}

/** SW が有効になるのを待ち、読み込み直して SW の管理下にする */
async function underServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/** 明日（JST） */
function tomorrowIso(): string {
  return new Date(Date.now() + 9 * 3600_000 + 24 * 3600_000).toISOString().slice(0, 10);
}

async function editTitle(page: Page, from: string, to: string) {
  await page.goto('/');
  await page
    .getByRole('button', { name: new RegExp(from) })
    .first()
    .click();
  await expect(page.getByRole('article', { name: '予定の詳細' })).toBeVisible();
  await page.getByRole('button', { name: '編集' }).click();
  const dialog = page.getByRole('dialog', { name: '予定を書く' });
  await dialog.getByLabel('件名').fill(to);
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/');
}

async function composeOn(page: Page, title: string, day: string) {
  await page.getByRole('button', { name: '予定を書く' }).click();
  const dialog = page.getByRole('dialog', { name: '予定を書く' });
  await dialog.getByLabel('件名').fill(title);
  await dialog.getByLabel('日付').fill(day);
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
}

test.beforeEach(async ({ request }) => {
  await ensureFamily(request);
});

test.describe('オフライン', () => {
  test.use({ allowedConsoleErrors: { patterns: [OFFLINE] } });

  test('オフラインで閲覧・作成 → 復帰で送信', async ({ page, context, request }) => {
    const day = tomorrowIso();
    await createAs(request, 'mama', {
      title: 'E2E オフラインで見る',
      allDay: true,
      startDate: day,
    });
    await page.goto('/');
    await expect(page.getByText('E2E オフラインで見る')).toBeVisible();
    await underServiceWorker(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText('E2E オフラインで見る')).toBeVisible();

    await composeOn(page, 'E2E オフラインで書く', day);
    const row = page.getByRole('button', { name: /E2E オフラインで書く/ });
    await expect(row).toContainText('未送信');
    await expect(page.getByText('家のサーバーにつながりません')).toBeVisible();

    await context.setOffline(false);
    await expect(row).not.toContainText('未送信', { timeout: 15_000 });
    expect(await serverTitles(request)).toContain('E2E オフラインで書く');
  });

  test('同じ予定をオフラインで 2 回編集しても、自分の変更どうしで 409 にならない', async ({
    page,
    context,
    request,
  }) => {
    const day = tomorrowIso();
    await createAs(request, 'papa', { title: 'E2E 二回編集', allDay: true, startDate: day });
    await page.goto('/');
    await expect(page.getByText('E2E 二回編集')).toBeVisible();
    await underServiceWorker(page);
    await context.setOffline(true);
    await editTitle(page, 'E2E 二回編集', 'E2E 二回編集 A');
    await editTitle(page, 'E2E 二回編集 A', 'E2E 二回編集 B');
    await context.setOffline(false);
    const row = page.getByRole('button', { name: /E2E 二回編集 B/ });
    await expect(row).not.toContainText('未送信', { timeout: 15_000 });
    await expect(row).not.toContainText('競合');
    expect(await serverTitles(request)).toContain('E2E 二回編集 B');
  });
});

test.describe('API だけ遮断', () => {
  test.use({ allowedConsoleErrors: { patterns: [ABORTED] } });

  test('Tailscale だけ切れた状態でも、送信待ちが溜まり、解除で送られる', async ({
    page,
    context,
    request,
  }) => {
    const day = tomorrowIso();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'これから' })).toBeVisible();
    await context.route('**/api/**', (route) => route.abort());

    await composeOn(page, 'E2E 遮断中に書く', day);
    await expect(page.getByText('家のサーバーにつながりません（Tailscale を確認）')).toBeVisible();
    await expect(page.getByRole('button', { name: /E2E 遮断中に書く/ })).toContainText('未送信');

    await context.unroute('**/api/**');
    await page.getByRole('button', { name: '再試行' }).click();
    await expect(page.getByRole('button', { name: /E2E 遮断中に書く/ })).not.toContainText(
      '未送信',
    );
    await expect(page.getByText('家のサーバーにつながりません')).toBeHidden();
    expect(await serverTitles(request)).toContain('E2E 遮断中に書く');
  });
});

test('別のメンバーが追加した予定に「新」が付き、次に開いたときには消える', async ({
  page,
  request,
}) => {
  const day = tomorrowIso();
  const fresh = page.locator('li[data-fresh="true"]', { hasText: 'E2E ふえた予定' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'これから' })).toBeVisible();
  // いったん閉じる（前回開いた時刻が保存される）
  await page.goto('about:blank');
  await createAs(request, 'mama', { title: 'E2E ふえた予定', allDay: true, startDate: day });
  await page.goto('/');
  await expect(fresh).toBeVisible();
  await expect(page.getByRole('button', { name: /新しい予定 \d+件/ })).toBeVisible();
  // 同じ回のあいだ（アプリの中で画面を移っても）は消えない
  await page.getByRole('link', { name: '月' }).click();
  await page.getByRole('link', { name: 'これから' }).click();
  await expect(fresh).toBeVisible();
  // 次に開いたときには消える
  await page.goto('about:blank');
  await page.goto('/');
  await expect(page.getByRole('button', { name: /E2E ふえた予定/ })).toBeVisible();
  await expect(fresh).toHaveCount(0);
});

test.describe('競合', () => {
  test.use({ allowedConsoleErrors: { patterns: [OFFLINE, CONFLICT] } });

  for (const choice of ['家族の変更を採用', '自分の変更で上書き', '両方残す'] as const) {
    test(`競合を起こして解決する: ${choice}`, async ({ page, context, request }) => {
      const day = tomorrowIso();
      const title = `E2E 競合 ${choice}`;
      const created = await createAs(request, 'papa', { title, allDay: true, startDate: day });
      await page.goto('/');
      await expect(page.getByText(title)).toBeVisible();
      await underServiceWorker(page);
      await context.setOffline(true);
      await editTitle(page, title, `${title} 自分`);
      // そのあいだにお母さんが同じ予定を変える
      const res = await request.fetch(`/api/events/${created.id}`, {
        method: 'PATCH',
        headers: {
          'X-Dev-Login': 'mama@example.com',
          'X-Ito-Client': '1',
          'Content-Type': 'application/json',
          Origin: ORIGIN,
          'If-Match': String(created.version),
        },
        data: JSON.stringify({ scope: 'all', changes: { title: `${title} 家族` } }),
      });
      expect(res.status()).toBe(200);
      await context.setOffline(false);
      const row = page.getByRole('button', { name: new RegExp(`${title} 自分`) });
      await expect(row).toContainText('競合', { timeout: 15_000 });
      await row.click();
      await page.getByRole('button', { name: choice }).click();
      const expected =
        choice === '家族の変更を採用'
          ? [`${title} 家族`]
          : choice === '自分の変更で上書き'
            ? [`${title} 自分`]
            : [`${title} 家族`, `${title} 自分`].sort();
      await expect
        .poll(async () => (await serverTitles(request)).filter((t) => t.startsWith(title)).sort())
        .toEqual(expected);
    });
  }
});

test('/api/* は Cache Storage に入らない。/api/export へのページ遷移は index.html にならない', async ({
  page,
}) => {
  await page.goto('/');
  await underServiceWorker(page);
  await page.getByRole('link', { name: '月' }).click();
  await page.getByRole('link', { name: 'これから' }).click();
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((u) => u.startsWith('/api/'))).toEqual([]);
  const res = await page.request.get('/api/export?format=json', {
    headers: { Accept: 'text/html' },
  });
  expect(res.headers()['content-type'] ?? '').not.toContain('text/html');
});

test('「更新」を押すと新しい SW に切り替わる', async ({ page }) => {
  await page.goto('/');
  await underServiceWorker(page);
  // 新しい版の sw.js を配る（E2E 用のビルドのファイルを書き換え、終わったら戻す）
  const original = readFileSync(SW_PATH, 'utf8');
  try {
    writeFileSync(SW_PATH, `${original}\n// e2e-new-version\n`);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    await expect(page.getByText('新しいバージョンがあります')).toBeVisible({ timeout: 15_000 });
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.waiting !== null,
      ),
    ).toBe(true);
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: '更新' }).click(),
    ]);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return reg?.waiting === null && reg?.active?.state === 'activated';
        }),
      )
      .toBe(true);
    await expect(page.getByText('新しいバージョンがあります')).toBeHidden();
  } finally {
    writeFileSync(SW_PATH, original);
  }
});

test('インストールできる（CDP の Page.getInstallabilityErrors が空。§24 D25）', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  await expect
    .poll(async () => (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors, {
      timeout: 15_000,
    })
    .toEqual([]);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
});

test('はじめて（色 → 使い方）→ ホームの案内（ホーム画面への追加）は閉じたら出ない', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ito.devLogin', 'haruto@example.com');
    } catch {}
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: /ようこそ/ })).toBeVisible();
  await page.getByRole('button', { name: '次へ' }).click();
  await page.getByRole('button', { name: 'はじめる' }).click();
  await expect(page.getByRole('heading', { name: 'これから' })).toBeVisible();
  const notice = page.getByRole('note');
  await expect(notice).toContainText('ホーム画面に追加');
  await notice.getByRole('button', { name: '案内を閉じる' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'これから' })).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
  await page.goto('/install');
  await expect(page.getByRole('heading', { name: 'ホーム画面に追加' })).toBeVisible();
  await context.close();
});

test('この端末からログアウト（端末の保存を消して、はじめてへ）', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  // 初期化スクリプトは使わない（ログアウトのあとに書き戻さないように）
  await page.goto('/install');
  await page.evaluate(() => {
    localStorage.setItem('ito.devLogin', 'mama@example.com');
    localStorage.setItem('ito.onboarded', '1');
  });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
  await page.getByRole('button', { name: 'この端末からログアウト' }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  const left = await page.evaluate(() => ({
    onboarded: localStorage.getItem('ito.onboarded'),
    devLogin: localStorage.getItem('ito.devLogin'),
  }));
  expect(left).toEqual({ onboarded: null, devLogin: null });
  await context.close();
});
