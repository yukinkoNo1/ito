import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

export const ORIGIN = 'http://localhost:8788';

export const LOGINS = {
  papa: 'papa@example.com',
  mama: 'mama@example.com',
  haru: 'haruto@example.com',
  saki: 'saki@example.com',
} as const;
export type Who = keyof typeof LOGINS;

/** API を直接呼ぶ（CSRF を通るヘッダ付き。開発モードの X-Dev-Login で本人を選ぶ） */
export async function api(
  request: APIRequestContext,
  who: Who,
  method: string,
  path: string,
  body?: unknown,
) {
  const headers: Record<string, string> = { 'X-Dev-Login': LOGINS[who], 'X-Ito-Client': '1' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers.Origin = ORIGIN;
  }
  return request.fetch(path, {
    method,
    headers,
    data: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
}

let membersReady = false;

/** 家族（お父さん＝管理者の自動登録、お母さん、はると）をそろえる。何度呼んでもよい */
export async function ensureFamily(request: APIRequestContext): Promise<void> {
  if (membersReady) return;
  await api(request, 'papa', 'GET', '/api/me');
  const list = (await (await api(request, 'papa', 'GET', '/api/members')).json()) as {
    members: { login: string }[];
  };
  const have = new Set(list.members.map((m) => m.login));
  if (!have.has(LOGINS.mama)) {
    await api(request, 'papa', 'POST', '/api/members', {
      login: LOGINS.mama,
      name: 'お母さん',
      mark: '母',
      color: 'wakatake',
    });
  }
  if (!have.has(LOGINS.haru)) {
    await api(request, 'papa', 'POST', '/api/members', {
      login: LOGINS.haru,
      name: 'はると',
      mark: 'は',
      color: 'asagi',
    });
  }
  if (!have.has(LOGINS.saki)) {
    await api(request, 'papa', 'POST', '/api/members', {
      login: LOGINS.saki,
      name: 'さき',
      mark: 'さ',
      color: 'momo',
    });
  }
  membersReady = true;
}

/** 「これから」が開いた（本番の UI。§6.3 S-01） */
export function homeList(page: Page) {
  return page.getByRole('region', { name: 'これからの予定' });
}

/** 下のナビ（C-01） */
export function navTo(page: Page, label: 'これから' | '月' | '空き' | '設定') {
  return page.getByRole('navigation', { name: 'メイン' }).getByRole('button', {
    name: label,
    exact: true,
  });
}

/** 入力バー（C-01 の「予定を書く」） */
export function composerTrigger(page: Page) {
  return page.getByRole('button', { name: /^＋\s*予定を書く/ });
}

/** そのブラウザのコンテキストを、開発用のログインでその人にする */
export async function loginAs(context: BrowserContext, who: Who): Promise<void> {
  await context.addInitScript((login) => {
    try {
      localStorage.setItem('ito.devLogin', login);
      localStorage.setItem('ito.onboarded', '1');
    } catch {}
  }, LOGINS[who]);
}

export async function waitSynced(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.innerText.length > 0);
}
