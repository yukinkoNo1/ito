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

export type PushFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: Uint8Array | null;
    redirect: 'manual';
    signal: AbortSignal;
  },
) => Promise<{ status: number; body: { cancel(): Promise<void> } | null }>;

/**
 * 本物の送信（web-push で RFC 8291 の aes128gcm に暗号化し、VAPID で署名した要求を作り、fetch で送る）。
 * - 締め切りは要求の全体に掛ける（web-push の timeout は無通信の時間なので、少しずつ返す相手には効かない。総点検 B2）
 * - 応答の本文は読まずに捨てる（大きな本文を溜めない）。リダイレクトはたどらない
 * エラーの本文や endpoint はログに出さない（呼び出し側は状態コードだけを見る）
 */
export function webPushSender(
  keys: VapidKeys,
  timeoutMs = 10_000,
  fetcher: PushFetch = (url, init) => fetch(url, init),
): PushSender {
  return {
    async send(target, payload, options) {
      let details: ReturnType<typeof webpush.generateRequestDetails>;
      try {
        details = webpush.generateRequestDetails(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          {
            vapidDetails: keys,
            TTL: options.TTL,
            urgency: options.urgency,
            contentEncoding: 'aes128gcm',
          },
        );
      } catch {
        return classifyStatus(null);
      }
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(details.headers)) {
        // 長さは fetch が本文から付ける
        if (name.toLowerCase() !== 'content-length') headers[name] = String(value);
      }
      try {
        const res = await fetcher(details.endpoint, {
          method: details.method,
          headers,
          body: details.body ? new Uint8Array(details.body) : null,
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
        await res.body?.cancel().catch(() => {});
        return classifyStatus(res.status);
      } catch {
        return classifyStatus(null);
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
