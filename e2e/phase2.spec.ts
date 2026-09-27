import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { api, ensureFamily, ORIGIN } from './helpers';

const SW_PATH = fileURLToPath(new URL('../apps/web/dist-e2e/sw.js', import.meta.url));
// 許すのは、テストで意図して失敗させた /api/ への要求だけ（アプリシェル・アイコン・manifest などの失敗は許さない）
const API_URL = String.raw`\(http://localhost:8788/api/`;
const OFFLINE = new RegExp(`net::ERR_INTERNET_DISCONNECTED ${API_URL}`);
const ABORTED = new RegExp(`net::ERR_FAILED ${API_URL}`);
const CONFLICT = new RegExp(`status of 409 .*${API_URL}events/`);

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

  test('Tailscale だけ切れた状態でも、読み込み直して見られ、送信待ちが溜まり、つながれば（再試行を押さなくても）送られる', async ({
    page,
    context,
    request,
  }) => {
    const day = tomorrowIso();
    await createAs(request, 'mama', { title: 'E2E 遮断前からある', allDay: true, startDate: day });
    // 60 秒ごとの同期を進めるために時計を入れる（時間はふつうに流れる）
    await page.clock.install();
    await page.goto('/');
    await expect(page.getByText('E2E 遮断前からある')).toBeVisible();
    await context.route('**/api/**', (route) => route.abort());

    // API だけ届かない状態で読み込み直しても、手元の予定が見える
    await page.reload();
    await expect(page.getByText('E2E 遮断前からある')).toBeVisible();
    await expect(page.getByText('家のサーバーにつながりません（Tailscale を確認）')).toBeVisible();

    await composeOn(page, 'E2E 遮断中に書く', day);
    const row = page.getByRole('button', { name: /E2E 遮断中に書く/ });
    await expect(row).toContainText('未送信');

    await context.unroute('**/api/**');
    // 再試行は押さない。表示中の 60 秒ごとの同期で送られる
    await page.clock.runFor(61_000);
    await expect(row).not.toContainText('未送信', { timeout: 15_000 });
    await expect(page.getByText('家のサーバーにつながりません')).toBeHidden();
    expect(await serverTitles(request)).toContain('E2E 遮断中に書く');
  });
});

/** 背面に回す・前面に戻す（iPhone のホーム画面アプリでいちばん多い開き直し） */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('背面に回して前面に戻したときも、そのあいだに増えた予定に「新」が付く', async ({
  page,
  request,
}) => {
  const day = tomorrowIso();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'これから' })).toBeVisible();
  await setVisibility(page, 'hidden');
  await createAs(request, 'mama', {
    title: 'E2E 背面のあいだに増えた',
    allDay: true,
    startDate: day,
  });
  await setVisibility(page, 'visible');
  await expect(
    page.locator('li[data-fresh="true"]', { hasText: 'E2E 背面のあいだに増えた' }),
  ).toBeVisible();
});

test('ホーム画面から開いている（インストール済み）ときは、ホーム画面への追加の案内を出さない', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', {
      configurable: true,
      get: () => true,
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'これから' })).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
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
      const resolver = page.getByRole('region', { name: '競合の解決' });
      await expect(resolver).toBeVisible();
      // 解決するまでは編集・削除できない（自分の変更が黙って消えないように。SYNC-01）
      await expect(page.getByRole('button', { name: '編集' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '削除' })).toHaveCount(0);
      await page.getByRole('button', { name: choice }).click();
      await expect(resolver).toHaveCount(0);
      await page.goto('/');
      const mine = page.getByRole('button', { name: new RegExp(`${title} 自分`) });
      const theirs = page.getByRole('button', { name: new RegExp(`${title} 家族`) });
      if (choice === '家族の変更を採用') {
        await expect(theirs).toBeVisible();
        await expect(mine).toHaveCount(0);
      } else if (choice === '自分の変更で上書き') {
        await expect(mine).not.toContainText('未送信', { timeout: 15_000 });
        await expect(theirs).toHaveCount(0);
      } else {
        await expect(theirs).toBeVisible();
        await expect(mine).not.toContainText('未送信', { timeout: 15_000 });
      }
      // 行の印（未送信・競合）が残っていない（件名にも「競合」が入るので、印の要素だけを見る）
      await expect(page.getByText(/^(競合|未送信)$/)).toHaveCount(0);
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

test.describe('SW を通らない遷移', () => {
  // /api/export は家族のアプリからの要求ではない（X-Ito-Client がない）ので 4xx になる。その 1 件だけ許す
  test.use({
    allowedConsoleErrors: {
      patterns: [/status of 4\d\d .*\(http:\/\/localhost:8788\/api\/export/],
    },
  });

  test('/api/export・/healthz へのページ遷移は、SW の管理下でも index.html にならない', async ({
    page,
  }) => {
    await page.goto('/');
    await underServiceWorker(page);
    for (const path of ['/api/export?format=json', '/healthz']) {
      const res = await page.goto(path);
      expect(res, path).not.toBeNull();
      expect(res?.fromServiceWorker(), path).toBe(false);
      expect(res?.headers()['content-type'] ?? '', path).not.toContain('text/html');
      await expect(page.locator('#root'), path).toHaveCount(0);
    }
  });
});

test('/api/* は Cache Storage に入らない', async ({ page }) => {
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

test.describe('はじめての端末', () => {
  test.use({ onboarded: false });

  test('はじめて（色 → 使い方）→ ホームの案内（ホーム画面への追加）は閉じたら出ない', async ({
    page,
    context,
    request,
  }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('ito.devLogin', 'haruto@example.com');
      } catch {}
    });
    await page.goto('/');
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole('heading', { name: /ようこそ/ })).toBeVisible();
    // ほかの家族の色は選べない。空いている色を選ぶとサーバーに保存される
    await expect(page.getByRole('radio', { name: /^wakatake/ })).toBeDisabled();
    const fuji = page.getByRole('radio', { name: /^fuji/ });
    await fuji.click();
    await expect(fuji).toBeChecked();
    await expect
      .poll(
        async () =>
          ((await (await api(request, 'haru', 'GET', '/api/me')).json()) as { color: string })
            .color,
      )
      .toBe('fuji');
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
  });

  test.describe('ログアウト', () => {
    test.use({ allowedConsoleErrors: { patterns: [OFFLINE] } });

    test('この端末からログアウト（端末の保存を消して、はじめてへ。そのあともオフラインで開ける）', async ({
      page,
      context,
    }) => {
      // 初期化スクリプトは使わない（ログアウトのあとに書き戻さないように）
      await page.goto('/install');
      await page.evaluate(() => {
        localStorage.setItem('ito.devLogin', 'mama@example.com');
        localStorage.setItem('ito.onboarded', '1');
      });
      await page.goto('/settings');
      await underServiceWorker(page);
      await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
      await page.getByRole('button', { name: 'この端末からログアウト' }).click();
      await expect(page).toHaveURL(/\/welcome$/);
      const left = await page.evaluate(() => ({
        onboarded: localStorage.getItem('ito.onboarded'),
        devLogin: localStorage.getItem('ito.devLogin'),
      }));
      expect(left).toEqual({ onboarded: null, devLogin: null });
      // SW は入り直してプリキャッシュを作り直す（古い登録が残って空のキャッシュを見ない）
      await underServiceWorker(page);
      await context.setOffline(true);
      await page.reload();
      await expect(page.getByRole('heading', { name: /ようこそ/ })).toBeVisible();
      await context.setOffline(false);
    });
  });
});
