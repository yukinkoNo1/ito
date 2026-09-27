import { safeNotificationPath } from '@ito/core/notify';
import { apiRequest } from '../data/api';
import { readDevice, writeDevice } from './device';
import { detectPlatform, isStandalone } from './install';

/**
 * Web Push の購読（§15）。
 * - 公開鍵は画面を開いたときに取っておく（ボタンを押したあと最初に await するのは requestPermission。
 *   ユーザー操作の扱いが切れないように）
 * - iOS は購読が黙って失効するので、起動・前面復帰のたびに getSubscription() を確かめ、あればサーバーに upsert、
 *   なくて許可済みなら購読し直す
 * - サーバーが返した購読の ID を端末に保存する（端末の一覧の「この端末」に使う）
 */

export const PUSH_SUBSCRIPTION_KEY = 'push.subscriptionId';

export interface PushEnv {
  notification: {
    permission: NotificationPermission;
    requestPermission(): Promise<NotificationPermission>;
  } | null;
  getRegistration(): Promise<{
    pushManager: {
      getSubscription(): Promise<PushSubscriptionLike | null>;
      subscribe(options: {
        userVisibleOnly: boolean;
        applicationServerKey: Uint8Array<ArrayBuffer>;
      }): Promise<PushSubscriptionLike>;
    };
  } | null>;
  request: typeof apiRequest;
}

export interface PushSubscriptionLike {
  endpoint: string;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

function browserEnv(): PushEnv {
  return {
    notification:
      typeof Notification === 'undefined'
        ? null
        : {
            get permission() {
              return Notification.permission;
            },
            requestPermission: () => Notification.requestPermission(),
          },
    async getRegistration() {
      if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined') return null;
      return (await navigator.serviceWorker.ready) as unknown as Awaited<
        ReturnType<PushEnv['getRegistration']>
      >;
    },
    request: apiRequest,
  };
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 端末の名前（S-07 の「通知を受け取る端末」） */
export function deviceLabel(): string {
  const p = detectPlatform();
  if (p === 'ios') return 'iPhone';
  if (p === 'android') return 'Android';
  return 'パソコン';
}

let cachedKey: string | null = null;

/** VAPID の公開鍵（画面を開いたときに呼んでおく。使えなければ null） */
export async function loadPublicKey(env: PushEnv = browserEnv()): Promise<string | null> {
  if (cachedKey) return cachedKey;
  try {
    const res = await env.request('GET', '/api/push/public-key');
    const key = (res.body as { publicKey?: unknown } | null)?.publicKey;
    if (res.status === 200 && typeof key === 'string') cachedKey = key;
  } catch {}
  return cachedKey;
}

async function register(env: PushEnv, sub: PushSubscriptionLike): Promise<boolean> {
  const json = sub.toJSON();
  const res = await env.request('POST', '/api/push/subscriptions', {
    body: { endpoint: json.endpoint ?? sub.endpoint, keys: json.keys ?? {}, label: deviceLabel() },
  });
  const id = (res.body as { id?: unknown } | null)?.id;
  if (res.status === 200 && typeof id === 'string') {
    writeDevice(PUSH_SUBSCRIPTION_KEY, id);
    return true;
  }
  return false;
}

export type EnableResult = 'enabled' | 'denied' | 'unsupported' | 'unavailable' | 'failed';

/**
 * 「通知をオンにする」（ボタンを押したときに呼ぶ）。publicKey は先に取っておいたもの。
 * 最初に await するのは requestPermission()
 */
export async function enablePush(
  publicKey: string | null,
  env: PushEnv = browserEnv(),
): Promise<EnableResult> {
  if (!env.notification) return 'unsupported';
  const permission = await env.notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  if (!publicKey) return 'unavailable';
  try {
    const reg = await env.getRegistration();
    if (!reg) return 'unsupported';
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      }));
    return (await register(env, sub)) ? 'enabled' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * 起動・前面復帰のたびに呼ぶ。購読があれば upsert、なくて許可済みなら購読し直す（iOS の黙った失効への対策）。
 * 許可がなければ何もしない
 */
export async function checkPushSubscription(env: PushEnv = browserEnv()): Promise<void> {
  if (env.notification?.permission !== 'granted') return;
  try {
    const reg = await env.getRegistration();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = await loadPublicKey(env);
      if (!key) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(key),
      });
    }
    await register(env, sub);
  } catch {}
}

/** この端末の購読をやめる（ログアウト・この端末を一覧から消したとき）。サーバーの購読を消してから unsubscribe */
export async function unsubscribePush(env: PushEnv = browserEnv()): Promise<void> {
  const id = readDevice(PUSH_SUBSCRIPTION_KEY);
  if (id) {
    try {
      await env.request('DELETE', `/api/push/subscriptions/${encodeURIComponent(id)}`);
    } catch {}
  }
  writeDevice(PUSH_SUBSCRIPTION_KEY, null);
  try {
    const reg = await env.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {}
}

export function thisDeviceSubscriptionId(): string | null {
  return readDevice(PUSH_SUBSCRIPTION_KEY);
}

/** 通知の許可の状態（§22 NotificationPermissionVM。iPhone でホーム画面に未追加なら needs-install） */
export function notificationPermission():
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'needs-install' {
  if (detectPlatform() === 'ios' && !isStandalone()) return 'needs-install';
  if (typeof Notification === 'undefined' || typeof PushManager === 'undefined')
    return 'unsupported';
  return Notification.permission;
}

/** アプリのバッジを未読の数に合わせる（対応していなければ何もしない） */
export function syncAppBadge(count: number): void {
  const nav = globalThis.navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    const p = count > 0 ? nav?.setAppBadge?.(count) : nav?.clearAppBadge?.();
    void p?.catch(() => {});
  } catch {}
}

/** SW からの知らせ（同期を促す・通知を押した先へ移る） */
export function listenServiceWorkerMessages(handlers: {
  onSync: () => void;
  onNavigate: (path: string) => void;
}): () => void {
  const sw = globalThis.navigator?.serviceWorker;
  if (!sw) return () => {};
  const listener = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; path?: unknown } | null;
    if (data?.type === 'SYNC') handlers.onSync();
    if (data?.type === 'NAVIGATE') handlers.onNavigate(safeNotificationPath(data.path));
  };
  sw.addEventListener('message', listener);
  return () => sw.removeEventListener('message', listener);
}
