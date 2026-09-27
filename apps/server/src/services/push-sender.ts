import type { PushPayload } from '@ito/core';
import webpush from 'web-push';

/**
 * Web Push の送信（§15）。テストでは記録するだけのダミーに差し替える（RUNBOOK Phase 4）。
 * 結果: ok（届いた）／gone（404・410。購読を消す）／retry（429・5xx・通信エラー。10 分以内なら次の実行で再送）／
 * fail（そのほか。再送しない）
 */
export type PushResult =
  | { kind: 'ok' }
  | { kind: 'gone'; status: number }
  | { kind: 'retry'; status: number | null }
  | { kind: 'fail'; status: number | null };

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOptions {
  /** 秒（web-push の既定は 4 週間なので必ず指定する） */
  TTL: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
}

export interface PushSender {
  send(target: PushTarget, payload: PushPayload, options: PushOptions): Promise<PushResult>;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function classifyStatus(status: number | null): PushResult {
  if (status !== null && status >= 200 && status < 300) return { kind: 'ok' };
  if (status === 404 || status === 410) return { kind: 'gone', status };
  if (status === null || status === 429 || status >= 500) return { kind: 'retry', status };
  return { kind: 'fail', status };
}

/**
 * 本物の送信（web-push。RFC 8291 の aes128gcm で暗号化し、VAPID で署名する）。
 * エラーの本文や endpoint はログに出さない（呼び出し側は状態コードだけを見る）
 */
export function webPushSender(keys: VapidKeys, timeoutMs = 10_000): PushSender {
  return {
    async send(target, payload, options) {
      try {
        const res = await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          {
            vapidDetails: keys,
            TTL: options.TTL,
            urgency: options.urgency,
            contentEncoding: 'aes128gcm',
            timeout: timeoutMs,
          },
        );
        return classifyStatus(res.statusCode);
      } catch (e) {
        const status =
          e instanceof webpush.WebPushError && typeof e.statusCode === 'number'
            ? e.statusCode
            : null;
        return classifyStatus(status);
      }
    },
  };
}

/** VAPID の鍵が揃っていれば返す（なければ push は無効） */
export function vapidKeysFrom(env: {
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}
