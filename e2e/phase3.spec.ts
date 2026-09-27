import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { api, composerTrigger, ensureFamily } from './helpers';

/**
 * Phase 3（繰り返し）: 書く画面で繰り返しを作り、詳細から「この予定だけ」「これ以降すべて」「すべて」で直す・消す。
 * オフラインでは「これ以降」「すべて」を選べない（§11・C-04）
 */

const OFFLINE = /net::ERR_INTERNET_DISCONNECTED \(http:\/\/localhost:8788\/api\//;

interface Row {
  id: string;
  title: string | null;
  startAt?: string;
  rrule: string | null;
  exdates: string[];
  parentId: string | null;
  recurrenceId: string | null;
}

async function rows(request: APIRequestContext, prefix: string): Promise<Row[]> {
  const res = await api(request, 'papa', 'GET', '/api/sync?cursor=0');
  return ((await res.json()) as { events: Row[] }).events.filter((e) =>
    (e.title ?? '').startsWith(prefix),
  );
}

async function openOccurrence(page: Page, date: string, title: RegExp) {
  await page.goto(`/month/${date.slice(0, 7)}?d=${date}`);
  await page
    .getByRole('region', { name: '選んだ日の予定' })
    .getByRole('button', { name: title })
    .click();
  const detail = page.getByRole('dialog', { name: '予定の詳細' });
  await expect(detail).toBeVisible();
  return detail;
}

test.beforeEach(async ({ request }) => {
  await ensureFamily(request);
});

test('繰り返しを書いて、この予定だけ・これ以降すべて・すべてで直す', async ({ page, request }) => {
  test.setTimeout(60_000);
  const T = 'E2E 月曜の練習';
  // 書く画面の「くわしく」で毎週・10 回
  await page.goto('/');
  await composerTrigger(page).click();
  const composer = page.getByRole('dialog', { name: '予定を書く' });
  await composer.getByLabel('予定を一言で入力').fill(T);
  await composer.getByRole('button', { name: 'くわしく' }).click();
  await composer.getByLabel('開始日').fill('2028-03-06');
  await composer.getByRole('button', { name: '9:00', exact: true }).click();
  await composer.getByLabel('開始の時刻').fill('07:30');
  await composer.getByRole('button', { name: '毎週', exact: true }).click();
  await composer.getByRole('button', { name: '10回', exact: true }).click();
  await composer.getByRole('button', { name: '3/6(月) 07:30 に保存' }).click();
  await expect(composer).toBeHidden();
  await expect
    .poll(async () => (await rows(request, T)).map((r) => r.rrule))
    .toEqual(['FREQ=WEEKLY;BYDAY=MO;COUNT=10']);

  // この予定だけ: 3/13 の時刻を直す
  let detail = await openOccurrence(page, '2028-03-13', new RegExp(T));
  await detail.getByRole('button', { name: /^日時/ }).click();
  const sheet = page.getByRole('dialog', { name: '日時を直す' });
  await sheet.getByRole('button', { name: '9:00', exact: true }).click();
  await sheet.getByRole('button', { name: /に変更$/ }).click();
  const editScope = page.getByRole('dialog', { name: 'どの予定を変更しますか？' });
  await editScope.getByRole('button', { name: /^この予定だけ/ }).click();
  await expect(editScope).toBeHidden();
  await expect
    .poll(async () =>
      (await rows(request, T)).filter((r) => r.parentId).map((r) => [r.recurrenceId, r.startAt]),
    )
    .toEqual([['2028-03-13T07:30', '2028-03-13T09:00:00+09:00']]);
  await detail.getByRole('button', { name: '閉じる' }).click();

  // この予定だけ削除: 3/20
  detail = await openOccurrence(page, '2028-03-20', new RegExp(T));
  await detail.getByRole('button', { name: '削除' }).click();
  const deleteScope = page.getByRole('dialog', { name: 'どの予定を削除しますか？' });
  await deleteScope.getByRole('button', { name: /^この予定だけ/ }).click();
  await expect(page.getByText('予定を削除しました')).toBeVisible();
  await expect
    .poll(async () => (await rows(request, T)).find((r) => r.rrule)?.exdates)
    .toEqual(['2028-03-20T07:30']);

  // これ以降すべて: 3/13 から件名を変える（その回以降の個別の変更 2 件が消えることを C-04 で見せる）
  detail = await openOccurrence(page, '2028-03-13', new RegExp(T));
  await detail.getByRole('button', { name: '編集' }).click();
  const editor = page.getByRole('dialog', { name: '予定を書く' });
  await editor.getByLabel('件名').fill(`${T}（新）`);
  await editor.getByRole('button', { name: /に変更$/ }).click();
  const followScope = page.getByRole('dialog', { name: 'どの予定を変更しますか？' });
  await expect(followScope).toContainText('この回以降の個別の変更 2 件は消えます');
  await followScope.getByRole('button', { name: /^これ以降すべて/ }).click();
  await expect(editor).toBeHidden();
  await expect
    .poll(async () =>
      (await rows(request, T))
        .filter((r) => r.rrule)
        .map((r) => [r.title, r.rrule, r.startAt])
        .sort(),
    )
    .toEqual([
      [T, 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20280306T235959', '2028-03-06T07:30:00+09:00'],
      [`${T}（新）`, 'FREQ=WEEKLY;BYDAY=MO;COUNT=9', '2028-03-13T09:00:00+09:00'],
    ]);
  await page
    .getByRole('dialog', { name: '予定の詳細' })
    .getByRole('button', { name: '閉じる' })
    .click();

  // すべて: 後の回（3/27）から時刻を変えても、前の回（3/13）は消えずに同じだけずれる
  detail = await openOccurrence(page, '2028-03-27', /E2E 月曜の練習（新）/);
  await detail.getByRole('button', { name: /^日時/ }).click();
  await page
    .getByRole('dialog', { name: '日時を直す' })
    .getByRole('button', { name: '12:00', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '日時を直す' })
    .getByRole('button', { name: /に変更$/ })
    .click();
  await page
    .getByRole('dialog', { name: 'どの予定を変更しますか？' })
    .getByRole('button', { name: /^すべて/ })
    .click();
  await expect
    .poll(async () => (await rows(request, `${T}（新）`)).find((r) => r.rrule)?.startAt)
    .toBe('2028-03-13T12:00:00+09:00');
  await page.goto('/month/2028-03?d=2028-03-13');
  await expect(page.getByRole('region', { name: '選んだ日の予定' })).toContainText('12:00');
});

test.describe('オフライン', () => {
  test.use({ allowedConsoleErrors: { patterns: [OFFLINE] } });

  test('オフラインでは「これ以降すべて」「すべて」を選べない（この予定だけは選べる）', async ({
    page,
    context,
    request,
  }) => {
    const res = await request.fetch('/api/events', {
      method: 'POST',
      headers: {
        'X-Dev-Login': 'papa@example.com',
        'X-Ito-Client': '1',
        'Content-Type': 'application/json',
        Origin: 'http://localhost:8788',
        'Idempotency-Key': 'e2e-p3-offline',
      },
      data: JSON.stringify({
        title: 'E2E 水曜のゴミ',
        allDay: false,
        startAt: '2028-04-05T07:30:00+09:00',
        // 回数を決める（終わりのない繰り返しは、ほかの E2E の見本の期間＝2030 年にも出てしまう）
        rrule: 'FREQ=WEEKLY;BYDAY=WE;COUNT=3',
        forEveryone: true,
      }),
    });
    expect(res.status()).toBe(201);
    await page.goto('/month/2028-04?d=2028-04-12');
    await expect(
      page
        .getByRole('region', { name: '選んだ日の予定' })
        .getByRole('button', { name: /E2E 水曜のゴミ/ }),
    ).toBeVisible();
    // 画面を開いたあとでつながらなくなった（ページは読み込み直さない）
    await context.setOffline(true);
    await page
      .getByRole('region', { name: '選んだ日の予定' })
      .getByRole('button', { name: /E2E 水曜のゴミ/ })
      .click();
    const detail = page.getByRole('dialog', { name: '予定の詳細' });
    await detail.getByRole('button', { name: '削除' }).click();
    const scope = page.getByRole('dialog', { name: 'どの予定を削除しますか？' });
    await expect(scope.getByRole('button', { name: /^これ以降すべて/ })).toBeDisabled();
    await expect(scope.getByRole('button', { name: /^すべて/ })).toBeDisabled();
    await expect(scope.getByRole('button', { name: /^この予定だけ/ })).toBeEnabled();
    await expect(scope).toContainText('オフライン中は');
    await scope.getByRole('button', { name: '閉じる' }).click();
    await context.setOffline(false);
  });
});
