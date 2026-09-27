import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { api, ensureFamily, ORIGIN } from './helpers';

/**
 * Phase 4（通知）: 詳細の自分への通知、設定の通知の欄（端末の一覧・止める・テスト通知）、家族の管理の「端末の通知を止める」。
 * Service Worker の push は phase4-push.spec.ts。
 * E2E のサーバーには VAPID の鍵を置かない（本物の Push サービスに送らない）。購読は API で登録する
 */

let seq = 0;
async function createEvent(request: APIRequestContext, body: Record<string, unknown>) {
  seq++;
  const res = await request.fetch('/api/events', {
    method: 'POST',
    headers: {
      'X-Dev-Login': 'papa@example.com',
      'X-Ito-Client': '1',
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'Idempotency-Key': `e2e-p4-${seq}`,
    },
    data: JSON.stringify(body),
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { event: { id: string } }).event;
}

async function myPrefs(request: APIRequestContext) {
  const res = await api(request, 'papa', 'GET', '/api/sync?cursor=0');
  return ((await res.json()) as { myReminderPrefs: { eventId: string; offsets: number[] }[] })
    .myReminderPrefs;
}

const keys = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };

test.beforeEach(async ({ request }) => {
  await ensureFamily(request);
});

test('詳細の「自分への通知」で選ぶと保存され、開き直しても残る', async ({ page, request }) => {
  const e = await createEvent(request, {
    title: 'E2E 歯医者',
    allDay: false,
    startAt: '2028-05-10T10:00:00+09:00',
    memberIds: [],
    forEveryone: true,
  });
  await page.goto(`/e/${e.id}`);
  const detail = page.getByRole('dialog', { name: '予定の詳細' });
  // 担当（全員）なので既定の 30分前が選ばれている
  await expect(detail.getByRole('button', { name: '30分前' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await detail.getByRole('button', { name: '開始時' }).click();
  await expect
    .poll(async () => (await myPrefs(request)).find((p) => p.eventId === e.id)?.offsets)
    .toEqual([-30, 0]);
  await page.reload();
  await expect(
    page.getByRole('dialog', { name: '予定の詳細' }).getByRole('button', { name: '開始時' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('dialog', { name: '予定の詳細' })
    .getByRole('button', { name: 'なし', exact: true })
    .click();
  await expect
    .poll(async () => (await myPrefs(request)).find((p) => p.eventId === e.id)?.offsets)
    .toEqual([]);
});

test('設定: 通知を受け取る端末の一覧から止められる。テスト通知は鍵がなければ理由を出す', async ({
  page,
  request,
}) => {
  const res = await api(request, 'papa', 'POST', '/api/push/subscriptions', {
    endpoint: 'https://push.example.com/e2e/papa-android',
    keys,
    label: 'Android',
  });
  expect(res.status()).toBe(200);
  await page.goto('/settings');
  const row = page.getByRole('button', { name: /Android · 未確認/ });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: /テスト通知/ }).click();
  await expect(page.getByText('家のサーバーで通知の設定がされていません')).toBeVisible();
  await row.click();
  await expect(page.getByText('その端末への通知を止めました')).toBeVisible();
  await expect(page.getByRole('button', { name: /Android · 未確認/ })).toHaveCount(0);
  const list = await api(request, 'papa', 'GET', '/api/push/subscriptions');
  expect(((await list.json()) as { devices: unknown[] }).devices).toEqual([]);
});

test('家族の管理: この人の端末の通知を止める', async ({ page, request }) => {
  const res = await api(request, 'mama', 'POST', '/api/push/subscriptions', {
    endpoint: 'https://push.example.com/e2e/mama-iphone',
    keys,
    label: 'iPhone',
  });
  expect(res.status()).toBe(200);
  await page.goto('/settings/members');
  await page.getByRole('button', { name: /お母さん.*通知 1台/ }).click();
  await page.getByRole('button', { name: 'この人の端末の通知を止める' }).click();
  await expect(page.getByText('その人の端末への通知を止めました')).toBeVisible();
  await expect(page.getByRole('button', { name: /お母さん.*通知 1台/ })).toHaveCount(0);
  const mine = await api(request, 'mama', 'GET', '/api/push/subscriptions');
  expect(((await mine.json()) as { devices: unknown[] }).devices).toEqual([]);
});
