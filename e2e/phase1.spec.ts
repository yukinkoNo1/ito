import { expect, test } from './fixtures';
import { api, ensureFamily, loginAs } from './helpers';

test.beforeEach(async ({ request }) => {
  await ensureFamily(request);
});

test('2 人の開発ログインで、片方が作った予定がもう片方に出る。祝日は月と日に出る', async ({
  browser,
  page,
}) => {
  // お父さん（既定の本人）が 2026-10-12（スポーツの日）に書く
  await page.goto('/month/2026-10');
  await page.getByRole('button', { name: /^2026-10-12 スポーツの日/ }).click();
  await page.getByRole('button', { name: '＋ この日に書く' }).click();
  const dialog = page.getByRole('dialog', { name: '予定を書く' });
  await dialog.getByLabel('件名').fill('E2E 運動会');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('保存しました')).toBeVisible();

  // お母さんの画面に出る
  const mamaContext = await browser.newContext();
  await loginAs(mamaContext, 'mama');
  const mama = await mamaContext.newPage();
  await mama.goto('/month/2026-10');
  const cell = mama.getByRole('button', { name: /^2026-10-12 スポーツの日 1件/ });
  await expect(cell).toBeVisible();
  await expect(cell).toContainText('E2E 運動会');
  await cell.click();
  const day = mama.getByRole('region', { name: '10月12日' });
  await expect(day).toContainText('スポーツの日');
  await expect(day).toContainText('E2E 運動会');
  await mamaContext.close();
});

test('削除 → 元に戻す', async ({ page, request }) => {
  const created = await api(request, 'mama', 'POST', '/api/events', {
    title: 'E2E 消して戻す',
    allDay: true,
    startDate: '2026-10-20',
    endDate: '2026-10-20',
  });
  expect(created.status()).toBe(400); // Idempotency-Key が要る
  const ok = await request.fetch('/api/events', {
    method: 'POST',
    headers: {
      'X-Dev-Login': 'mama@example.com',
      'X-Ito-Client': '1',
      'Content-Type': 'application/json',
      Origin: 'http://localhost:8788',
      'Idempotency-Key': 'e2e-undo-1',
    },
    data: JSON.stringify({
      title: 'E2E 消して戻す',
      allDay: true,
      startDate: '2026-10-20',
      endDate: '2026-10-20',
    }),
  });
  expect(ok.status()).toBe(201);

  await page.goto('/month/2026-10');
  await page.getByRole('button', { name: /^2026-10-20 1件/ }).click();
  await page
    .getByRole('region', { name: '10月20日' })
    .getByRole('button', { name: /E2E 消して戻す/ })
    .click();
  await page.getByRole('button', { name: '削除' }).click();
  await expect(page.getByText('予定を削除しました')).toBeVisible();
  await expect(page.getByRole('region', { name: '10月20日' })).not.toContainText('E2E 消して戻す');
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(page.getByRole('region', { name: '10月20日' })).toContainText('E2E 消して戻す');
  // サーバーにも残っている（ゴミ箱に入っていない）
  await expect
    .poll(async () => {
      const sync = (await (await api(request, 'papa', 'GET', '/api/sync?cursor=0')).json()) as {
        events: { title: string }[];
      };
      return sync.events.some((e) => e.title === 'E2E 消して戻す');
    })
    .toBe(true);
});
