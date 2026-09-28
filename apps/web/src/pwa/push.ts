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
 * - ログアウト・「この端末」を一覧から消したら「自分で止めた」印を付け、起動・前面復帰では購読し直さない
 *   （印を消すのは「通知をオンにする」＝enablePush だけ）
 */

export const PUSH_SUBSCRIPTION_KEY = 'push.subscriptionId';
export const PUSH_OPTED_OUT_KEY = 'push.optedOut';

/** この端末で通知を自分で止めたか */
export function pushOptedOut(): boolean {
  return readDevice(PUSH_OPTED_OUT_KEY) === '1';
}

/** 「自分で止めた」印を付ける（ログアウトは端末の保存を消したあとで付け直す） */
export function markPushOptedOut(): void {
  writeDevice(PUSH_OPTED_OUT_KEY, '1');
}

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
      // ready は SW を登録していない環境（pnpm dev）では解決しないので、登録があるときだけ待つ
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return null;
      return (reg.active ? reg : await navigator.serviceWorker.ready) as unknown as Awaited<
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

/**
 * VAPID の公開鍵の状態: 取れた（ready）／家のサーバーに鍵がない（disabled。公開鍵が null）／
 * まだ取れていない（unknown。通信の失敗など。押したときに取り直す）
 */
export type PublicKeyState =
  | { status: 'ready'; key: string }
  | { status: 'disabled' }
  | { status: 'unknown' };

export const UNKNOWN_KEY: PublicKeyState = { status: 'unknown' };

let cachedKey: string | null = null;

/** VAPID の公開鍵（画面を開いたときに呼んでおく）。取れた鍵だけを覚える */
export async function loadPublicKey(env: PushEnv = browserEnv()): Promise<PublicKeyState> {
  if (cachedKey) return { status: 'ready', key: cachedKey };
  try {
    const res = await env.request('GET', '/api/push/public-key');
    const key = (res.body as { publicKey?: unknown } | null)?.publicKey;
    if (res.status === 200 && typeof key === 'string' && key.length > 0) {
      cachedKey = key;
      return { status: 'ready', key };
    }
    if (res.status === 200 && key === null) return { status: 'disabled' };
  } catch {}
  return UNKNOWN_KEY;
}

/** テスト用: 覚えた公開鍵を忘れる */
export function forgetPublicKey(): void {
  cachedKey = null;
}

/**
 * 購読を家のサーバーに登録する。端末の数の上限（409 device_limit）と、プッシュサービスでない送り先（422）を
 * 分けて返す（§15。総点検 B4）
 */
async function register(
  env: PushEnv,
  sub: PushSubscriptionLike,
): Promise<'ok' | 'too_many' | 'unsupported' | 'failed'> {
  const json = sub.toJSON();
  const res = await env.request('POST', '/api/push/subscriptions', {
    body: { endpoint: json.endpoint ?? sub.endpoint, keys: json.keys ?? {}, label: deviceLabel() },
  });
  const id = (res.body as { id?: unknown } | null)?.id;
  if (res.status === 200 && typeof id === 'string') {
    writeDevice(PUSH_SUBSCRIPTION_KEY, id);
    return 'ok';
  }
  if (res.status === 409 && (res.body as { code?: unknown } | null)?.code === 'device_limit') {
    return 'too_many';
  }
  return res.status === 422 ? 'unsupported' : 'failed';
}

export type EnableResult =
  | 'enabled'
  | 'denied'
  | 'unsupported'
  | 'unavailable'
  | 'too_many'
  | 'failed';

/** 「通知をオンにする」の結果の文（設定とホームの案内で同じ。家のサーバーに鍵がないと通信の失敗を分ける） */
export const ENABLE_MESSAGES: Record<EnableResult, string> = {
  enabled: 'この端末で通知を受け取ります',
  denied: '通知が許可されませんでした。端末の設定で許可できます',
  unsupported: 'この端末やブラウザでは通知を使えません',
  unavailable: '家のサーバーで通知の設定がされていません',
  too_many:
    '通知を受け取る端末は 1 人 10 台までです。設定の「通知を受け取る端末」から使っていない端末を止めてください',
  failed: '通知をオンにできませんでした。しばらくしてからやり直してください',
};

/**
 * 「通知をオンにする」（ボタンを押したときに呼ぶ）。publicKey は画面を開いたときに取っておいたもの。
 * 最初に await するのは requestPermission()。鍵が取れていなければ許可のあとで取り直し、
 * 家のサーバーに鍵がない（unavailable）と通信の失敗（failed）を分ける
 */
export async function enablePush(
  publicKey: PublicKeyState,
  env: PushEnv = browserEnv(),
): Promise<EnableResult> {
  if (!env.notification) return 'unsupported';
  const permission = await env.notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  // 自分でオンにしたので、「自分で止めた」印を消す（起動・前面復帰の確かめも再び働く）
  writeDevice(PUSH_OPTED_OUT_KEY, null);
  const key = publicKey.status === 'unknown' ? await loadPublicKey(env) : publicKey;
  if (key.status === 'disabled') return 'unavailable';
  if (key.status === 'unknown') return 'failed';
  try {
    const reg = await env.getRegistration();
    if (!reg) return 'unsupported';
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(key.key),
      }));
    const registered = await register(env, sub);
    return registered === 'ok' ? 'enabled' : registered;
  } catch {
    return 'failed';
  }
}

/**
 * 起動・前面復帰のたびに呼ぶ。購読があれば upsert、なくて許可済みなら購読し直す（iOS の黙った失効への対策）。
 * 許可がないとき・自分で止めたときは何もしない
 */
export async function checkPushSubscription(env: PushEnv = browserEnv()): Promise<void> {
  if (env.notification?.permission !== 'granted' || pushOptedOut()) return;
  try {
    const reg = await env.getRegistration();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const key = await loadPublicKey(env);
      if (key.status !== 'ready') return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(key.key),
      });
    }
    // 待っているあいだに止めた（ログアウト・この端末の削除）なら登録しない
    if (pushOptedOut()) return;
    await register(env, sub);
  } catch {}
}

/**
 * この端末の購読をやめる（ログアウト・この端末を一覧から消したとき）。「自分で止めた」印を付け、
 * サーバーの購読を消してから unsubscribe
 */
export async function unsubscribePush(env: PushEnv = browserEnv()): Promise<void> {
  markPushOptedOut();
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

/**
 * 通知の許可の状態（§22 NotificationPermissionVM。iPhone でホーム画面に未追加なら needs-install）。
 * 許可済みでも、この端末で自分で止めたなら default（「通知をオンにする」を出す）
 */
export function notificationPermission():
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported'
  | 'needs-install' {
  if (detectPlatform() === 'ios' && !isStandalone()) return 'needs-install';
  if (typeof Notification === 'undefined' || typeof PushManager === 'undefined')
    return 'unsupported';
  const permission = Notification.permission;
  return permission === 'granted' && pushOptedOut() ? 'default' : permission;
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
