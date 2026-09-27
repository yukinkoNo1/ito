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

export const pushSubscriptionInputSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      // https の URL だけ（空白・制御文字を含まない。ホストのあとにパスがある）
      .regex(/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[!-~]*$/, 'https の URL だけ受け付けます'),
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
