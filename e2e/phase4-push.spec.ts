import { expect, test } from './fixtures';
import { ORIGIN } from './helpers';

/**
 * Phase 4（通知）: Service Worker の push（通知を出す・url は同一オリジンのパスだけ）。
 * Playwright の既定の Chromium（headless shell）は通知の許可をいつも拒むので、このファイルだけ
 * 新しい headless の Chromium（channel: 'chromium'）で動かす。push は DevTools の ServiceWorker.deliverPushMessage で届ける
 */
test.use({ channel: 'chromium' });

test('Service Worker に push を届けると通知が出る。url は同一オリジンのパスだけ', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications'], { origin: ORIGIN });
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cdp = await context.newCDPSession(page);
  const registrationId = new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
      const r = e.registrations.find((x) => x.scopeURL.startsWith(ORIGIN) && !x.isDeleted);
      if (r) resolve(r.registrationId);
    });
  });
  await cdp.send('ServiceWorker.enable');
  const id = await registrationId;
  const deliver = (data: unknown) =>
    cdp.send('ServiceWorker.deliverPushMessage', {
      origin: ORIGIN,
      registrationId: id,
      data: JSON.stringify(data),
    });
  await deliver({
    v: 1,
    kind: 'reminder',
    title: 'E2E 歯医者',
    body: '今日 10:00〜（30分前の通知）',
    url: '/e/abc?r=2028-05-10T10%3A00',
    tag: 'rem:abc',
  });
  await deliver({
    v: 1,
    kind: 'change',
    title: '家族の予定の変更',
    body: 'お母さんが「x」を追加しました',
    url: 'https://evil.example.com/',
    tag: 'change',
  });
  const shown = () =>
    page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return (await reg.getNotifications())
        .map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url }))
        .sort((a, b) => a.tag.localeCompare(b.tag));
    });
  await expect.poll(shown).toEqual([
    {
      title: '家族の予定の変更',
      body: 'お母さんが「x」を追加しました',
      tag: 'change',
      url: '/',
    },
    {
      title: 'E2E 歯医者',
      body: '今日 10:00〜（30分前の通知）',
      tag: 'rem:abc',
      url: '/e/abc?r=2028-05-10T10%3A00',
    },
  ]);
  await cdp.detach();
});
