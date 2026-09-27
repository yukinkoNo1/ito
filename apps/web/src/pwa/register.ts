import { registerSW } from 'virtual:pwa-register';

/**
 * Service Worker の登録（injectRegister: null。インラインスクリプトを作らない。§17）。
 * 新しい SW が待機したら onNeedRefresh に「更新する」関数を渡す（SKIP_WAITING を送って切り替え、読み込み直す）。
 */
export function registerServiceWorker(onNeedRefresh: (apply: () => void) => void): void {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      onNeedRefresh(() => {
        void update(true);
      });
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // 前面に戻ったときに新しい版を確かめる
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => {});
      });
    },
  });
}
