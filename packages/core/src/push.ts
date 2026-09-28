import './zod-config';
import { z } from 'zod';
import { PUSH_KINDS } from './notify';

/** Push の入力・出力のスキーマ（§13・§15）。Service Worker は notify.ts だけを読む（zod を入れない） */

export const pushPayloadSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(PUSH_KINDS),
    title: z.string().max(200),
    body: z.string().max(1000),
    url: z.string().max(500),
    tag: z.string().max(200),
    badge: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/, '形式が正しくありません');

/**
 * 受け付けるプッシュサービス（ブラウザが返す endpoint の先。§15）。家の LAN や任意のサーバーを送り先にさせない
 * （通知のたびにサーバーから要求が出るため。総点検 B4）: FCM（Chrome・Android）、Apple（Safari・iPhone）、
 * Mozilla（Firefox）、WNS（Edge）
 */
const PUSH_SERVICE_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  const m = /^https:\/\/([A-Za-z0-9.-]+)\/[!-~]*$/.exec(endpoint);
  const host = m?.[1]?.toLowerCase();
  return host !== undefined && PUSH_SERVICE_HOSTS.some((re) => re.test(host));
}

export const pushSubscriptionInputSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      // プッシュサービスの https の URL だけ（ポートの指定なし・空白や制御文字を含まない・ホストのあとにパスがある）
      .refine(isPushServiceEndpoint, 'プッシュサービスの URL だけ受け付けます'),
    keys: z
      .object({ p256dh: base64url.min(16).max(200), auth: base64url.min(8).max(100) })
      .strict(),
    label: z.string().trim().min(1).max(20).optional(),
  })
  .strict();
export type PushSubscriptionInput = z.output<typeof pushSubscriptionInputSchema>;

export const deviceDtoSchema = z.object({
  id: z.string(),
  label: z.string(),
  lastOkAt: z.string().nullable(),
  createdAt: z.string(),
  isThisDevice: z.boolean(),
});
export type DeviceDTO = z.output<typeof deviceDtoSchema>;
