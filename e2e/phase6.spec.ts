import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { SCENARIOS } from '../apps/web/src/ui/gallery/scenarios';
import {
  MOCK_EVENTS,
  MOCK_MEMBERS,
  MOCK_NOW_ISO,
  MOCK_TODAY,
  type MockMemberKey,
  toCreateBody,
} from '../apps/web/src/ui/mock-data';
import { expect, test } from './fixtures';
import { api, composerTrigger, ensureFamily, homeList, ORIGIN, type Who } from './helpers';

/**
 * Phase 6 の受け入れ（§23）: ギャラリーと本番の画面のスクリーンショット、§6.2 の手数、「大きめ」、axe、
 * 入力欄の文字 16px 以上、タップ領域 44px 以上。見本のデータ（mock-data.ts）を API で入れ、時計を止める
 */

const COLORS = ['yamabuki', 'wakakusa', 'wakatake', 'asagi', 'fuji', 'momo', 'ruri', 'kaki'];
const TOMORROW = '2030-09-30';

interface AdminMember {
  id: string;
  login: string;
  name: string;
  mark: string;
  color: string;
  disabled: boolean;
}

async function adminMembers(request: APIRequestContext): Promise<AdminMember[]> {
  const res = await api(request, 'papa', 'GET', '/api/members');
  return ((await res.json()) as { members: AdminMember[] }).members;
}

/** 家族の名前・略称・色を見本と同じにする（ほかのテストが色を変えていても） */
async function matchMockFamily(request: APIRequestContext): Promise<Map<MockMemberKey, string>> {
  const ids = new Map<MockMemberKey, string>();
  for (const m of MOCK_MEMBERS) {
    const list = await adminMembers(request);
    const target = list.find((x) => x.login === m.login);
    if (!target) throw new Error(`見本の家族がいません: ${m.login}`);
    ids.set(m.key, target.id);
    if (target.name !== m.name || target.mark !== m.mark) {
      const res = await api(request, 'papa', 'PATCH', `/api/members/${target.id}`, {
        name: m.name,
        mark: m.mark,
      });
      expect(res.status(), `${m.login} の名前`).toBe(200);
    }
    if (target.color === m.color) continue;
    const holder = list.find((x) => x.color === m.color && x.id !== target.id && !x.disabled);
    if (holder) {
      const free = COLORS.find(
        (c) =>
          !list.some((x) => !x.disabled && x.color === c) &&
          !MOCK_MEMBERS.some((mm) => mm.color === c),
      );
      const res = await api(request, 'papa', 'PATCH', `/api/members/${holder.id}`, { color: free });
      expect(res.status(), `${holder.login} の色をあける`).toBe(200);
    }
    const res = await api(request, 'papa', 'PATCH', `/api/members/${target.id}`, {
      color: m.color,
    });
    expect(res.status(), `${m.login} の色`).toBe(200);
  }
  return ids;
}

/** 見本の予定を入れる（Idempotency-Key を固定して、何度呼んでも 1 件ずつ） */
async function seedMockEvents(request: APIRequestContext, ids: Map<MockMemberKey, string>) {
  const idOf = (k: MockMemberKey) => ids.get(k) ?? '';
  for (const e of MOCK_EVENTS) {
    const res = await request.fetch('/api/events', {
      method: 'POST',
      headers: {
        'X-Dev-Login': MOCK_MEMBERS.find((m) => m.key === e.by)?.login ?? '',
        'X-Ito-Client': '1',
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'Idempotency-Key': `e2e-mock-${e.key}`,
      },
      data: JSON.stringify(toCreateBody(e, idOf)),
    });
    expect(res.status(), e.key).toBe(201);
  }
  // 家族が入れた予定の履歴を既読にする（見出しの「履歴」の数をギャラリーと同じ 0 に）
  await api(request, 'papa', 'POST', '/api/activity/read', {});
}

async function titles(
  request: APIRequestContext,
  who: Who,
): Promise<{ title: string | null; startAt?: string; endAt?: string | null }[]> {
  const res = await api(request, who, 'GET', '/api/sync?cursor=0');
  return (
    (await res.json()) as {
      events: { title: string | null; startAt?: string; endAt?: string | null }[];
    }
  ).events;
}

async function settled(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function attachPair(testInfo: TestInfo, name: string, a: Buffer, b: Buffer) {
  await testInfo.attach(`${name}-本番.png`, { body: a, contentType: 'image/png' });
  await testInfo.attach(`${name}-ギャラリー.png`, { body: b, contentType: 'image/png' });
}

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ request, context, page }) => {
  await ensureFamily(request);
  const ids = await matchMockFamily(request);
  await seedMockEvents(request, ids);
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ito.notice.install.dismissed', '1');
    } catch {}
  });
  await page.clock.setFixedTime(new Date(MOCK_NOW_ISO));
});

/* ───────── ギャラリーと本番の画面（見本のデータを変える操作より先に） ───────── */

test.describe('ギャラリーの状態と本番の画面のスクリーンショットが一致する', () => {
  test('これから', async ({ page }, testInfo) => {
    await page.goto('/');
    const list = homeList(page);
    await expect(list.getByRole('button', { name: /夕食/ })).toBeVisible();
    await expect(page.getByText('最終同期 14:18')).toBeVisible();
    await settled(page);
    const prod = await page.locator('.app-shell').screenshot({ animations: 'disabled' });
    await page.goto('/__gallery?s=flow&bare=1');
    await expect(homeList(page).getByRole('button', { name: /夕食/ })).toBeVisible();
    await settled(page);
    const gallery = await page.locator('.app-shell').screenshot({ animations: 'disabled' });
    await attachPair(testInfo, 'flow', prod, gallery);
    expect(prod.equals(gallery), 'これからの画面がギャラリーと同じ').toBe(true);
  });

  test('月', async ({ page }, testInfo) => {
    await page.goto('/month/2030-09');
    const day = page.getByRole('region', { name: '選んだ日の予定' });
    await expect(day.getByRole('button', { name: /夕食/ })).toBeVisible();
    await settled(page);
    const prod = await page.locator('.app-shell').screenshot({ animations: 'disabled' });
    await page.goto('/__gallery?s=month&bare=1');
    await expect(
      page.getByRole('region', { name: '選んだ日の予定' }).getByRole('button', { name: /夕食/ }),
    ).toBeVisible();
    await settled(page);
    const gallery = await page.locator('.app-shell').screenshot({ animations: 'disabled' });
    await attachPair(testInfo, 'month', prod, gallery);
    expect(prod.equals(gallery), '月の画面がギャラリーと同じ').toBe(true);
  });
});

/* ───────── §6.2 使いやすさの基準（手数） ───────── */

test.describe('§6.2 の手数', () => {
  test('今日と明日の予定が、開いてすぐスクロールなしで見える', async ({ page }) => {
    await page.goto('/');
    const list = homeList(page);
    await expect(list.getByRole('button', { name: /夕食/ })).toBeVisible();
    const box = await list.boundingBox();
    if (!box) throw new Error('一覧が見えない');
    for (const date of [MOCK_TODAY, TOMORROW]) {
      const rows = page.locator(`[data-date="${date}"] .event-row`);
      const n = await rows.count();
      expect(n, date).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const r = await rows.nth(i).boundingBox();
        if (!r) throw new Error('行が見えない');
        expect(r.y, `${date} の ${i + 1} 行目`).toBeGreaterThanOrEqual(box.y - 1);
        expect(r.y + r.height, `${date} の ${i + 1} 行目`).toBeLessThanOrEqual(
          box.y + box.height + 1,
        );
      }
    }
  });

  test('自分の予定だけを見る: 1 タップ（「自分」の札）', async ({ page }) => {
    await page.goto('/');
    const list = homeList(page);
    await expect(list.getByRole('button', { name: /ヨガ/ })).toBeVisible();
    await page
      .getByRole('group', { name: '表示する人' })
      .getByRole('button', { name: '自分', exact: true })
      .click();
    await expect(list.getByRole('button', { name: /ヨガ/ })).toHaveCount(0);
    await expect(list.getByRole('button', { name: /夕食/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /出張（大阪）/ }).first()).toBeVisible();
  });

  test('特定の日に移動する: 2 タップ（「日付」→ その月の日）、週の帯なら 1 タップ', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(homeList(page).getByRole('button', { name: /夕食/ })).toBeVisible();
    await page.getByRole('button', { name: '日付', exact: true }).click();
    await page.getByRole('button', { name: '9月10日', exact: true }).click();
    await expect(page.locator('[data-date="2030-09-10"]')).toBeInViewport();
    await expect(page.getByRole('button', { name: '9月10日 火曜日へ移動' })).toHaveAttribute(
      'aria-current',
      'date',
    );
    await expect(page.getByRole('button', { name: '今日に戻る' })).toBeVisible();

    await page.getByRole('button', { name: '9月12日 木曜日へ移動' }).click();
    await expect(page.locator('[data-date="2030-09-12"]')).toBeInViewport();
    await page.getByRole('button', { name: '今日に戻る' }).click();
    await expect(page.locator(`[data-date="${MOCK_TODAY}"]`)).toBeInViewport();
  });

  test('予定を追加する: 3 タップ（入力バー → 最近の予定の札 → 保存）', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await expect(homeList(page).getByRole('button', { name: /夕食/ })).toBeVisible();
    await composerTrigger(page).click();
    const dialog = page.getByRole('dialog', { name: '予定を書く' });
    const suggestion = dialog.locator('.recent-events .ui-button').first();
    const title = (await suggestion.locator('strong').textContent()) ?? '';
    expect(title).not.toBe('');
    const count = async () =>
      (await titles(request, 'papa')).filter((e) => e.title === title).length;
    const before = await count();
    await suggestion.click();
    await dialog.getByRole('button', { name: /に保存$/ }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect.poll(count).toBe(before + 1);
  });

  test('予定の時刻を直す: 詳細の日時 → 時刻の札 → 保存（編集画面を経由しない）', async ({
    page,
    request,
  }) => {
    await page.goto('/');
    await homeList(page)
      .getByRole('button', { name: /歯医者/ })
      .click();
    const detail = page.getByRole('dialog', { name: '予定の詳細' });
    await detail.getByRole('button', { name: /^日時/ }).click();
    const sheet = page.getByRole('dialog', { name: '日時を直す' });
    await sheet.getByRole('button', { name: '15:00', exact: true }).click();
    await sheet.getByRole('button', { name: /に変更$/ }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await expect
      .poll(async () => {
        const e = (await titles(request, 'mama')).find((x) => x.title === '歯医者');
        return [e?.startAt, e?.endAt];
      })
      .toEqual(['2030-09-30T15:00:00+09:00', '2030-09-30T15:30:00+09:00']);
  });
});

/* ───────── 大きめ・axe・入力欄・タップ領域 ───────── */

const SCREENS: { path: string; ready: (page: Page) => Promise<void> }[] = [
  {
    path: '/',
    ready: async (p) => expect(homeList(p).getByRole('button', { name: /夕食/ })).toBeVisible(),
  },
  {
    path: '/month/2030-09',
    ready: async (p) => expect(p.getByRole('region', { name: '選んだ日の予定' })).toBeVisible(),
  },
  { path: '/free', ready: async (p) => expect(p.getByText('全員があいている候補')).toBeVisible() },
  { path: '/search', ready: async (p) => expect(p.getByRole('main')).toBeVisible() },
  { path: '/settings', ready: async (p) => expect(p.getByText('この端末と家族')).toBeVisible() },
  {
    path: '/settings/members',
    ready: async (p) => expect(p.getByText('papa@example.com')).toBeVisible(),
  },
  { path: '/activity', ready: async (p) => expect(p.getByRole('main')).toBeVisible() },
  { path: '/trash', ready: async (p) => expect(p.getByRole('main')).toBeVisible() },
  {
    path: '/install',
    ready: async (p) => expect(p.getByRole('button', { name: 'iPhone' })).toBeVisible(),
  },
];

/** シートを開いた状態（書く画面のくわしく・詳細・日時を直す・日付を選ぶ） */
const OVERLAYS: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: '書く（くわしく）',
    open: async (p) => {
      await p.goto('/');
      await composerTrigger(p).click();
      await p
        .getByRole('dialog', { name: '予定を書く' })
        .getByRole('button', { name: 'くわしく' })
        .click();
    },
  },
  {
    name: '詳細',
    open: async (p) => {
      await p.goto('/');
      await homeList(p).getByRole('button', { name: /夕食/ }).click();
      await expect(p.getByRole('dialog', { name: '予定の詳細' })).toBeVisible();
    },
  },
  {
    name: '日時を直す',
    open: async (p) => {
      await p.goto('/');
      await homeList(p).getByRole('button', { name: /夕食/ }).click();
      await p
        .getByRole('dialog', { name: '予定の詳細' })
        .getByRole('button', { name: /^日時/ })
        .click();
      await expect(p.getByRole('dialog', { name: '日時を直す' })).toBeVisible();
    },
  },
  {
    name: '日付を選ぶ',
    open: async (p) => {
      await p.goto('/');
      await p.getByRole('button', { name: '日付', exact: true }).click();
      await expect(p.getByRole('region', { name: '日付を選択' })).toBeVisible();
    },
  },
];

/** 横にはみ出した要素（わざと横にスクロールする札の列の中は除く） */
async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    // わざと横にスクロールする札の列（styles.css の overflow-x: auto と、7 個以上の人の札）
    const RAILS = '.option-rail, .suggestion-list, .gallery-group, .member-filters';
    const out: string[] = [];
    if (document.documentElement.scrollWidth > width + 1)
      out.push(`page ${document.documentElement.scrollWidth}`);
    for (const el of document.querySelectorAll(
      '#root button, #root p, #root strong, #root span, #root input, #root time, #root small',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest(RAILS)) continue;
      if (r.right > width + 1 || r.left < -1) {
        out.push(
          `${el.tagName}.${el.className} "${(el.textContent ?? '').slice(0, 20)}" ${Math.round(r.left)}-${Math.round(r.right)}`,
        );
      }
    }
    // 縦にスクロールする箱の中で、横にはみ出していないか（箱の中に隠れた横スクロール）
    for (const el of document.querySelectorAll('#root *')) {
      if (el.matches(RAILS)) continue;
      const style = getComputedStyle(el);
      if (!['auto', 'scroll'].includes(style.overflowY)) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.push(`scroll box .${el.className} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    return out.slice(0, 10);
  });
}

/** 44px 未満のタップ領域・16px 未満の入力欄の文字 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    for (const el of document.querySelectorAll(
      '#root button, #root a[href], #root input, #root select, #root textarea',
    )) {
      if (!visible(el)) continue;
      // 文の中のリンク（メモの URL）は除く（WCAG 2.5.8 の例外）
      if (el.tagName === 'A' && el.closest('p')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) {
        out.push(
          `${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (size < 16) out.push(`${el.tagName} の文字 ${size}px`);
      }
    }
    return out.slice(0, 20);
  });
}

async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return result.violations.map(
    (v) =>
      `${v.id}: ${v.nodes
        .map((n) => n.target.join(' '))
        .slice(0, 3)
        .join(' | ')}`,
  );
}

test.describe('画面ごとの確かめ', () => {
  test('「大きめ」の文字でも崩れない（横にはみ出さない）', async ({ page, context }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('ito.textSize', 'large');
      } catch {}
    });
    for (const s of SCREENS) {
      await page.goto(s.path);
      await s.ready(page);
      expect(await page.evaluate(() => document.documentElement.dataset.textSize), s.path).toBe(
        'large',
      );
      expect(
        await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
        s.path,
      ).toBe('18.4px');
      expect(await horizontalOverflow(page), s.path).toEqual([]);
    }
    for (const o of OVERLAYS) {
      await o.open(page);
      expect(await horizontalOverflow(page), o.name).toEqual([]);
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe の違反がない（${scheme === 'light' ? 'ライト' : 'ダーク'}）`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const found: Record<string, string[]> = {};
      for (const s of SCREENS) {
        await page.goto(s.path);
        await s.ready(page);
        const v = await axeViolations(page);
        if (v.length > 0) found[s.path] = v;
      }
      for (const o of OVERLAYS) {
        await o.open(page);
        const v = await axeViolations(page);
        if (v.length > 0) found[o.name] = v;
      }
      expect(found).toEqual({});
    });
  }

  test('入力欄の文字は 16px 以上、タップ領域は 44px 以上', async ({ page }) => {
    for (const s of SCREENS) {
      await page.goto(s.path);
      await s.ready(page);
      expect(await smallTargets(page), s.path).toEqual([]);
    }
    for (const o of OVERLAYS) {
      await o.open(page);
      expect(await smallTargets(page), o.name).toEqual([]);
    }
  });
});

test.describe('はじめての端末', () => {
  test.use({ onboarded: false });

  test('はじめて（S-11）も axe の違反がなく、タップ領域は 44px 以上', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page.getByText('いとへようこそ')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    expect(await smallTargets(page)).toEqual([]);
    await page.getByRole('button', { name: '次へ' }).click();
    await expect(page.getByRole('button', { name: 'はじめる' })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

/* ───────── ギャラリーの全部の状態（C-02・C-03・C-05・案内・他人の非公開・8 人家族など）でも ───────── */

test.describe('ギャラリーの全部の状態で、axe・44px・大きめ', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`axe の違反がなく、タップ領域は 44px 以上（${theme === 'light' ? 'ライト' : 'ダーク'}）`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: theme });
      const found: Record<string, string[]> = {};
      for (const [key] of SCENARIOS) {
        await page.goto(`/__gallery?s=${key}&bare=1&theme=${theme}`);
        await expect(page.locator('#root main').first()).toBeVisible();
        const v = [...(await axeViolations(page)), ...(await smallTargets(page))];
        if (v.length > 0) found[key] = v;
      }
      expect(found).toEqual({});
    });
  }

  test('「大きめ」でも横にはみ出さない', async ({ page }) => {
    test.setTimeout(180_000);
    const found: Record<string, string[]> = {};
    for (const [key] of SCENARIOS) {
      await page.goto(`/__gallery?s=${key}&bare=1&large=1`);
      await expect(page.locator('#root main').first()).toBeVisible();
      const v = await horizontalOverflow(page);
      if (v.length > 0) found[key] = v;
    }
    expect(found).toEqual({});
  });
});

test.describe('本番の画面の細部（Phase 6 のレビュー）', () => {
  async function touch(page: Page, selector: string, fromY: number, toY: number) {
    await page.evaluate(
      ({ selector, fromY, toY }) => {
        const target = document.querySelector(selector);
        if (!target) throw new Error(`見つからない: ${selector}`);
        const make = (y: number) => new Touch({ identifier: 1, target, clientX: 100, clientY: y });
        target.dispatchEvent(
          new TouchEvent('touchstart', {
            bubbles: true,
            touches: [make(fromY)],
            changedTouches: [make(fromY)],
          }),
        );
        target.dispatchEvent(
          new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [make(toY)] }),
        );
      },
      { selector, fromY, toY },
    );
  }

  test('シートは中身のスクロールでは閉じず、つまみからの引き下ろしで閉じる', async ({ page }) => {
    await page.goto('/');
    await composerTrigger(page).click();
    const composer = page.getByRole('dialog', { name: '予定を書く' });
    await composer.getByRole('button', { name: 'くわしく' }).click();
    await page.locator('.composer-sheet .full-sheet-scroll').evaluate((el) => {
      el.scrollTop = 200;
    });
    await touch(page, '.composer-sheet .composer-details', 300, 420);
    await expect(composer).toBeVisible();
    await touch(page, '.composer-sheet .sheet-grabber', 20, 140);
    await expect(composer).toBeHidden();

    await homeList(page).getByRole('button', { name: /夕食/ }).click();
    const detail = page.getByRole('dialog', { name: '予定の詳細' });
    await detail.getByRole('button', { name: /^日時/ }).click();
    await touch(page, '.detail-subsheet', 400, 520);
    await expect(detail).toBeVisible();
    await expect(page.getByRole('dialog', { name: '日時を直す' })).toBeVisible();
  });

  test('日付をまたぐ予定の時刻は、予定名に重ならない', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '10月3日 木曜日へ移動' }).click();
    const row = page.locator('[data-date="2030-10-03"] .event-row', { hasText: '夜釣り' });
    await expect(row).toContainText('→翌01:00');
    const time = await row.locator('.event-time').boundingBox();
    const copy = await row.locator('.event-copy').boundingBox();
    if (!time || !copy) throw new Error('行が見えない');
    expect(time.x + time.width).toBeLessThanOrEqual(copy.x + 1);
  });

  test('広い画面では中央に寄せて最大 480px（§19）', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    const box = await page.locator('.app-shell').boundingBox();
    if (!box) throw new Error('画面が見えない');
    expect(box.width).toBeLessThanOrEqual(480);
    expect(Math.abs(box.x - (1024 - box.width) / 2)).toBeLessThanOrEqual(1);
  });

  test('まとめの文に「新しい予定」が二重に出ない', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.today-summary > span')).not.toContainText('新しい予定');
  });
});

test.describe('家族として登録されていない端末', () => {
  test.use({
    onboarded: false,
    allowedConsoleErrors: { patterns: [/status of 403 .*\(http:\/\/localhost:8788\/api\//] },
  });

  test('はじめての画面で、同期が止まった理由と「再試行」を出す（C-02）', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      try {
        localStorage.setItem('ito.devLogin', 'stranger@example.com');
      } catch {}
    });
    await page.goto('/welcome');
    await expect(page.getByRole('status')).toContainText(
      'このアカウント（stranger@example.com）は家族として登録されていません',
    );
    await expect(page.getByRole('button', { name: '再試行' })).toBeVisible();
  });
});

test('ギャラリー（/__gallery）の全部の状態が、エラーなく描ける', async ({ page }) => {
  await page.goto('/__gallery');
  const states = page.getByRole('group', { name: '表示する状態' }).getByRole('button');
  await expect(states.first()).toBeVisible();
  const n = await states.count();
  expect(n).toBeGreaterThan(30);
  for (const theme of ['ライト', 'ダーク']) {
    await page.getByRole('group', { name: '配色' }).getByRole('button', { name: theme }).click();
    for (let i = 0; i < n; i++) {
      await states.nth(i).click();
      await expect(states.nth(i)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.device main')).toBeVisible();
    }
  }
});
