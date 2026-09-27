/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

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
