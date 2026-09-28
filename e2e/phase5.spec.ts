import { expect, test } from './fixtures';
import { api, composerTrigger, ensureFamily } from './helpers';

/**
 * Phase 5（一言入力）: ルール解析で書いて保存し、これから・月に出る。日本語入力の変換確定の Enter では確認へ進まない（§16・§21）。
 * E2E のサーバーには ANTHROPIC_API_KEY を置かない（いつもルール解析。「かんたん解析」と出る）
 */

/** 明日（日本時間）の YYYY-MM-DD と M/D */
function tomorrow(): { iso: string; md: string } {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return {
    iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    md: `${m}/${d}`,
  };
}

test.beforeEach(async ({ request }) => {
  await ensureFamily(request);
});

test('一言（ルール解析）で書いて保存すると、これから・月に出る', async ({ page, request }) => {
  const t = tomorrow();
  await page.goto('/');
  await composerTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: '予定を書く' });
  // 書いているあいだに札へ反映する（明日・19:00・お母さん）
  await dialog.getByLabel('予定を一言で入力').fill('明日 19時 E2E一言の歯医者 母');
  await expect(dialog.getByRole('button', { name: '明日', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const save = dialog.getByRole('button', { name: new RegExp(`^${t.md}\\(.\\) 19:00 に保存$`) });
  await expect(save).toBeVisible();
  // 確認へ（Enter）: サーバーに AI の鍵がないので「かんたん解析」
  await dialog.getByLabel('予定を一言で入力').press('Enter');
  await expect(dialog.getByText(/かんたん解析/)).toBeVisible();
  await save.click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => {
      const res = await api(request, 'papa', 'GET', '/api/sync?cursor=0');
      const events = (
        (await res.json()) as {
          events: { title: string | null; startAt?: string; memberIds: string[] }[];
        }
      ).events;
      const e = events.find((x) => x.title === 'E2E一言の歯医者');
      return e ? e.startAt : null;
    })
    .toBe(`${t.iso}T19:00:00+09:00`);

  // これから（明日の見出しの下）と月（その日）に出る
  await expect(page.getByRole('button', { name: /E2E一言の歯医者/ }).first()).toBeVisible();
  await page.goto(`/month/${t.iso.slice(0, 7)}?d=${t.iso}`);
  await expect(page.getByRole('region', { name: '選んだ日の予定' })).toContainText(
    'E2E一言の歯医者',
  );
});

test('日本語入力の変換確定の Enter（isComposing・keyCode 229）では確認へ進まない', async ({
  page,
}) => {
  const parses: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/parse')) parses.push(r.method());
  });
  await page.goto('/');
  await composerTrigger(page).click();
  const dialog = page.getByRole('dialog', { name: '予定を書く' });
  const input = dialog.getByLabel('予定を一言で入力');
  await input.fill('明日 10時 E2E変換中');
  await input.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForTimeout(300);
  expect(parses).toEqual([]);
  await expect(dialog.getByText(/かんたん解析/)).toHaveCount(0);
  // ふつうの Enter なら確認へ
  await input.press('Enter');
  await expect(dialog.getByText(/かんたん解析/)).toBeVisible();
  expect(parses).toEqual(['POST']);
  await dialog.getByRole('button', { name: '閉じる' }).click();
});
