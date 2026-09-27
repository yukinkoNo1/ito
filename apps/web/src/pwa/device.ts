/**
 * 端末ごとに保存するもの（localStorage）。iPhone のホーム画面アプリは Safari と保存領域が別なので、
 * 「はじめて」の進み具合・ホームの案内を閉じたか・前回開いた時刻は端末ごと（§12 F-21・§15）。
 * 保存できない環境（プライベートブラウズなど）では何もしない。
 */
const PREFIX = 'ito.';

export function readDevice(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writeDevice(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(PREFIX + key);
    else globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {}
}

export function clearDevice(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {}
}

export const DEVICE_KEYS = {
  lastOpenedAt: 'lastOpenedAt',
  onboarded: 'onboarded',
  installNoticeDismissed: 'notice.install.dismissed',
  notificationsNoticeDismissed: 'notice.notifications.dismissed',
  textSize: 'textSize',
} as const;
