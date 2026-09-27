import { HIDDEN_BODY, HIDDEN_TITLE, safeNotificationPath } from '@ito/core/notify';

/**
 * Service Worker が受け取った push の中身を通知の形にする（§15）。
 * zod を SW に入れないため、ここで型を手で確かめる。読めない中身でも通知は必ず出す
 * （iOS は通知を出さない push を「サイレント」とみなし、購読を取り消すことがある）。
 */
export interface NotificationPlan {
  title: string;
  options: {
    body: string;
    tag: string;
    icon: string;
    badge: string;
    data: { url: string };
  };
  /** アプリのバッジ（未読の数）。なければ触らない */
  appBadge: number | null;
}

const ICON = '/icons/icon-192.png';

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

export function planNotification(data: unknown): NotificationPlan {
  const o = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const ok = o.v === 1;
  const title = (ok && str(o.title, 200)) || HIDDEN_TITLE;
  const body = ok ? (str(o.body, 1000) ?? '') : HIDDEN_BODY;
  const tag = (ok && str(o.tag, 200)) || 'ito';
  const badge =
    ok && typeof o.badge === 'number' && Number.isInteger(o.badge) && o.badge >= 0
      ? Math.min(o.badge, 9999)
      : null;
  return {
    title,
    options: {
      body,
      tag,
      icon: ICON,
      badge: ICON,
      data: { url: safeNotificationPath(ok ? o.url : null) },
    },
    appBadge: badge,
  };
}

/** push の data を JSON として読む（読めなければ null） */
export function readPushData(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return null;
  }
}

/** 通知を押したときに開く URL（同一オリジンのパスだけ。§15） */
export function clickTarget(data: unknown, origin: string): string {
  const url =
    typeof data === 'object' && data !== null ? (data as Record<string, unknown>).url : null;
  return new URL(safeNotificationPath(url), origin).href;
}
