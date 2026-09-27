/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clickTarget, planNotification, readPushData } from './pwa/push-payload';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// アプリシェル・フォント・アイコンをプリキャッシュし、古いものは消す（SPEC §17）
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// ナビゲーションはキャッシュした index.html を返す。/api/ と /healthz は除外（/api/* はキャッシュしない）
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/healthz$/],
  }),
);

// 「更新」を押したら待機中の SW に切り替える
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// Push（§15）: showNotification より前に await を置かない（iOS は通知を出さない push を「サイレント」とみなし、
// 購読を取り消すことがある）。出したあとで、開いている画面に同期を促す
self.addEventListener('push', (event) => {
  const plan = planNotification(readPushData(() => event.data?.json()));
  event.waitUntil(
    self.registration.showNotification(plan.title, plan.options).then(async () => {
      if (plan.appBadge !== null) {
        try {
          await (plan.appBadge > 0
            ? self.navigator.setAppBadge?.(plan.appBadge)
            : self.navigator.clearAppBadge?.());
        } catch {}
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) w.postMessage({ type: 'SYNC' });
    }),
  );
});

// 通知を押したら、開いている画面を前面にしてその場所へ（なければ開く）。url は同一オリジンのパスだけ
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = clickTarget(event.notification.data, self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const same = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (same) {
        await same.focus();
        const url = new URL(target);
        same.postMessage({ type: 'NAVIGATE', path: `${url.pathname}${url.search}` });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
