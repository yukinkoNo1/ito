import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { api, ensureFamily, LOGINS, navTo, ORIGIN, type Who } from './helpers';

/**
 * Phase 7（仕上げ）: 空き時間から書く（§6.2）、検索（S-10）、書き出し（JSON／ICS。§13・§17）、
 * これからの一覧のスクロール（§19。1 年分の予定で 50ms を超える long task が出ない。§24 D25）
 */

let seq = 0;
async function createAs(request: APIRequestContext, who: Who, body: Record<string, unknown>) {
  seq++;
  const res = await request.fetch('/api/events', {
    method: 'POST',
    headers: {
      'X-Dev-Login': LOGINS[who],
      'X-Ito-Client': '1',
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      'Idempotency-Key': `e2e-p7-${who}-${seq}`,
    },
    data: JSON.stringify(body),
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { event: { id: string } }).event;
}

/** 今日から n 日後（日本時間）の YYYY-MM-DD */
function dayFromToday(n: number): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 + n * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function eventsTitled(request: APIRequestContext, title: string) {
  const res = await api(request, 'papa', 'GET', '/api/sync?cursor=0');
  return (
    (await res.json()) as { events: { title: string | null; startAt?: string }[] }
  ).events.filter((e) => e.title === title);
}

test.beforeEach(async ({ request }) => {
  await ensureFamily(request);
});

test('§6.2 みんなが空いている時間に予定を入れる: 空き → 候補の「この時間で書く」→ 保存', async ({
  page,
  request,
}) => {
  const T = 'E2E 空きで夕食';
  await page.goto('/');
  await navTo(page, '空き').click();
  const row = page.locator('.candidate-row').first();
  await expect(row).toBeVisible();
  // 候補の見出し: 「9/28(月)」と「17:00–24:00」
  const label = (await row.innerText()).replace(/\s+/g, ' ');
  const m = /(\d{1,2})\/(\d{1,2})\(.\) (\d{1,2}):(\d{2})/.exec(label);
  expect(m, label).not.toBeNull();
  await row.getByRole('button', { name: 'この時間で書く' }).click();
  const composer = page.getByRole('dialog', { name: '予定を書く' });
  await composer.getByLabel('予定を一言で入力').fill(T);
  await composer.getByRole('button', { name: /に保存$/ }).click();
  await expect(composer).toBeHidden();
  await expect.poll(async () => (await eventsTitled(request, T)).length).toBe(1);
  const startAt = (await eventsTitled(request, T))[0]?.startAt ?? '';
  const [, month, day, hour, minute] = m as RegExpExecArray;
  expect(startAt.slice(5, 10)).toBe(`${month?.padStart(2, '0')}-${day?.padStart(2, '0')}`);
  expect(startAt.slice(11, 16)).toBe(`${hour?.padStart(2, '0')}:${minute}`);
});

test('検索: 件名・場所・メモの部分一致。他人の非公開は出ない。人で絞り込み・最近の検索語', async ({
  page,
  request,
}) => {
  await createAs(request, 'papa', {
    title: 'E2E 検索の歯医者',
    allDay: false,
    startAt: `${dayFromToday(3)}T10:00:00+09:00`,
    location: '駅前',
  });
  await createAs(request, 'mama', {
    title: 'E2E 検索の買い物',
    allDay: false,
    startAt: `${dayFromToday(4)}T10:00:00+09:00`,
    note: '歯ブラシを買う',
  });
  await createAs(request, 'haru', {
    title: 'E2E 検索の内緒の歯医者',
    allDay: false,
    startAt: `${dayFromToday(5)}T10:00:00+09:00`,
    visibility: 'private',
  });
  await page.goto('/search');
  const box = page.getByLabel('予定を検索');
  await box.fill('E2E 検索');
  const results = page.locator('.search-results');
  await expect(results).toContainText('E2E 検索の歯医者');
  await expect(results).toContainText('E2E 検索の買い物');
  await expect(results).not.toContainText('内緒');
  // メモ（歯ブラシ）・場所（駅前）でも見つかる
  await box.fill('E2E 歯');
  await expect(results).toContainText('E2E 検索の買い物');
  await box.fill('駅前');
  await expect(results).toContainText('E2E 検索の歯医者');
  // 人で絞り込む（お母さん）
  await box.fill('E2E 検索');
  await page
    .getByRole('group', { name: '人で絞り込み' })
    .getByRole('button', { name: '母' })
    .click();
  await expect(results).toContainText('E2E 検索の買い物');
  await expect(results).not.toContainText('E2E 検索の歯医者');
  // 開くと詳細が出て、閉じて検索語を消すと最近の検索語に残っている
  await results.getByRole('button', { name: /E2E 検索の買い物/ }).click();
  const detail = page.getByRole('dialog', { name: '予定の詳細' });
  await expect(detail).toContainText('E2E 検索の買い物');
  await detail.getByRole('button', { name: '閉じる' }).click();
  await page.getByRole('button', { name: '検索語を消す' }).click();
  await expect(page.locator('.recent-searches')).toContainText('E2E 検索');
});

test.describe('書き出し（§13・§17）', () => {
  test.beforeEach(async ({ request }) => {
    await createAs(request, 'papa', {
      title: 'E2E 書き出しの予定',
      allDay: false,
      startAt: `${dayFromToday(6)}T09:00:00+09:00`,
    });
    await createAs(request, 'haru', {
      title: 'E2E 書き出しの内緒',
      allDay: false,
      startAt: `${dayFromToday(6)}T10:00:00+09:00`,
      visibility: 'private',
    });
  });

  test('JSON: 設定から fetch で取ってファイルに保存する（他人の非公開は入らない）', async ({
    page,
  }) => {
    // 共有シートを使わない端末として（<a download> で保存）
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    });
    await page.goto('/settings');
    await page.getByRole('button', { name: /予定を書き出す/ }).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSON（バックアップ用）' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^ito-\d{8}\.json$/);
    const chunks: Buffer[] = [];
    for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain('E2E 書き出しの予定');
    expect(text).not.toContain('E2E 書き出しの内緒');
    await expect(page.getByText('書き出しました')).toBeVisible();
  });

  test('ICS: iPhone では共有シートで渡す（VCALENDAR、他人の非公開は入らない）', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: { name: string; text: string }[] };
      w.__shared = [];
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: { files: File[] }) => {
          for (const f of data.files) w.__shared.push({ name: f.name, text: await f.text() });
        },
      });
    });
    await page.goto('/settings');
    await page.getByRole('button', { name: /予定を書き出す/ }).click();
    await page.getByRole('button', { name: 'ICS（カレンダーに取り込む）' }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length),
      )
      .toBe(1);
    const [shared] = await page.evaluate(
      () => (window as unknown as { __shared: { name: string; text: string }[] }).__shared,
    );
    expect(shared?.name).toMatch(/^ito-\d{8}\.ics$/);
    expect(shared?.text.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(shared?.text).toContain('SUMMARY:E2E 書き出しの予定');
    expect(shared?.text).not.toContain('E2E 書き出しの内緒');
  });
});

test('§19 これからの一覧: 1 年分の予定でスクロールしても 50ms を超える long task が出ず、描く範囲は前後 8 週ほどに収まる', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  // 毎日の予定 8 本（1 年分）と毎週の予定 4 本、ほかの家族の非公開 1 本
  const start = dayFromToday(-30);
  for (let i = 0; i < 8; i++) {
    await createAs(request, i % 2 ? 'mama' : 'papa', {
      title: `E2E 毎日${i}`,
      allDay: false,
      startAt: `${start}T${String(6 + i * 2).padStart(2, '0')}:00:00+09:00`,
      rrule: 'FREQ=DAILY;COUNT=365',
    });
  }
  for (let i = 0; i < 4; i++) {
    await createAs(request, 'papa', {
      title: `E2E 毎週${i}`,
      allDay: false,
      startAt: `${start}T${String(7 + i).padStart(2, '0')}:30:00+09:00`,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    });
  }
  await createAs(request, 'haru', {
    title: 'E2E 毎日の内緒',
    allDay: false,
    startAt: `${start}T21:00:00+09:00`,
    rrule: 'FREQ=DAILY;COUNT=365',
    visibility: 'private',
  });
  await page.goto('/');
  const list = page.getByRole('region', { name: 'これからの予定' });
  await expect(list.getByRole('button', { name: /E2E 毎日0/ }).first()).toBeVisible();
  // 読み込みが落ち着いてから測る
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((entries) => {
      for (const e of entries.getEntries()) w.__long.push(e.duration);
    }).observe({ type: 'longtask' });
  });
  const box = await list.boundingBox();
  if (!box) throw new Error('一覧が見えない');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const renderedRange = () =>
    page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id^="date-"]')].map((e) => e.id.slice(5));
      return { first: ids[0] ?? '', last: ids[ids.length - 1] ?? '', count: ids.length };
    });
  const before = await renderedRange();
  // 下へ（端で 4 週ずつ足し、140 日を超えたら上の端を削る）→ 上へ戻る
  for (let i = 0; i < 260; i++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(500);
  const after = await renderedRange();
  // 足した（最初は今日の 8 週先まで）うえで、上の端を削った（最初は昨日から）
  expect(after.last > before.last, JSON.stringify({ before, after })).toBe(true);
  expect(after.first > before.first, JSON.stringify({ before, after })).toBe(true);
  // 描いている日は、前後 8 週と足した 4 週ほど（140 日）まで
  expect(after.count).toBeLessThanOrEqual(141);
  // 削ったあとも、見ていた行が画面の中にある（位置が飛ばない）
  const visible = await page.evaluate(() => {
    const root = document.querySelector('[aria-label="これからの予定"]');
    if (!root) return 0;
    const r = root.getBoundingClientRect();
    return [...root.querySelectorAll('[data-item-key]')].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.bottom > r.top && b.top < r.bottom;
    }).length;
  });
  expect(visible).toBeGreaterThan(0);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(500);
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  expect(long.filter((d) => d > 50)).toEqual([]);
  // 他人の非公開は「予定あり」
  await expect(list).not.toContainText('E2E 毎日の内緒');
});
