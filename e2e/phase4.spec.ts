import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { api, composerTrigger, ensureFamily, ORIGIN } from './helpers';

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

interface Row {
  id: string;
  title: string | null;
  rrule: string | null;
}

async function rowsTitled(request: APIRequestContext, title: string): Promise<Row[]> {
  const res = await api(request, 'papa', 'GET', '/api/sync?cursor=0');
  return ((await res.json()) as { events: Row[] }).events.filter((e) => e.title === title);
}

/** 書く画面の「くわしく」で、その日の 9:00 に書いて保存する（act で保存の前に操作する） */
async function writeEvent(
  page: Page,
  request: APIRequestContext,
  title: string,
  date: string,
  act: (composer: Locator) => Promise<void>,
): Promise<string> {
  await page.goto('/');
  await composerTrigger(page).click();
  const composer = page.getByRole('dialog', { name: '予定を書く' });
  await composer.getByLabel('予定を一言で入力').fill(title);
  await composer.getByRole('button', { name: 'くわしく' }).click();
  await composer.getByLabel('開始日').fill(date);
  await composer.getByRole('button', { name: '9:00', exact: true }).click();
  await act(composer);
  await composer.getByRole('button', { name: /に保存$/ }).click();
  await expect(composer).toBeHidden();
  await expect.poll(async () => (await rowsTitled(request, title)).length).toBe(1);
  return ((await rowsTitled(request, title))[0] as Row).id;
}

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

test('書く画面の自分への通知: 触らなければ行を作らず、触れば作る。終日にしたら既定値に戻る', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const plain = await writeEvent(page, request, 'E2E 通知そのまま', '2028-06-05', async (c) => {
    // 担当（自分）なので既定の 30分前が選ばれている
    await expect(c.getByRole('button', { name: '30分前', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  const touched = await writeEvent(page, request, 'E2E 通知を足す', '2028-06-06', async (c) => {
    await c.getByRole('button', { name: '開始時', exact: true }).click();
  });
  const toAllDay = await writeEvent(
    page,
    request,
    'E2E 終日に切り替え',
    '2028-06-07',
    async (c) => {
      await c.getByRole('button', { name: '10分前', exact: true }).click();
      await c.getByRole('button', { name: '終日', exact: true }).click();
      // 時刻ありの「10分前」は終日では意味が変わるので、終日の既定値（前日 20:00）に戻る
      await expect(c.getByRole('button', { name: '10分前', exact: true })).toHaveCount(0);
      await expect(c.getByRole('button', { name: '前日20:00', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    },
  );
  await expect
    .poll(async () => (await myPrefs(request)).find((p) => p.eventId === touched)?.offsets)
    .toEqual([-30, 0]);
  const prefs = await myPrefs(request);
  expect(prefs.find((p) => p.eventId === plain)).toBeUndefined();
  expect(prefs.find((p) => p.eventId === toAllDay)).toBeUndefined();
});

test('書く画面の自分への通知: 繰り返しを「これ以降すべて」で直すと、新しいシリーズに付く', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const T = 'E2E 通知の練習';
  const e = await createEvent(request, {
    title: T,
    allDay: false,
    startAt: '2028-07-03T07:30:00+09:00',
    rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=5',
    memberIds: [],
    forEveryone: true,
  });
  await page.goto('/month/2028-07?d=2028-07-17');
  await page
    .getByRole('region', { name: '選んだ日の予定' })
    .getByRole('button', { name: new RegExp(T) })
    .click();
  await page
    .getByRole('dialog', { name: '予定の詳細' })
    .getByRole('button', { name: '編集' })
    .click();
  const editor = page.getByRole('dialog', { name: '予定を書く' });
  await editor.getByRole('button', { name: 'くわしく' }).click();
  await editor.getByRole('button', { name: '開始時', exact: true }).click();
  await editor.getByLabel('件名').fill(`${T}（新）`);
  await editor.getByRole('button', { name: /に変更$/ }).click();
  await page
    .getByRole('dialog', { name: 'どの予定を変更しますか？' })
    .getByRole('button', { name: /^これ以降すべて/ })
    .click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await rowsTitled(request, `${T}（新）`)).length).toBe(1);
  const next = (await rowsTitled(request, `${T}（新）`))[0] as Row;
  await expect
    .poll(async () => (await myPrefs(request)).find((p) => p.eventId === next.id)?.offsets)
    .toEqual([-30, 0]);
  // 元のシリーズ（7/10 まで）には行を作らない（既定値のまま）
  expect((await myPrefs(request)).find((p) => p.eventId === e.id)).toBeUndefined();
});
