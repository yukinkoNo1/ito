import { z } from 'zod';
import { graphemeLength, normalizeText } from './text';

/** 家族の色（§22 の順。管理者の自動登録ではこの順で未使用の最初の色を使う） */
export const MEMBER_COLORS = [
  'yamabuki',
  'wakakusa',
  'wakatake',
  'asagi',
  'fuji',
  'momo',
  'ruri',
  'kaki',
] as const;
export type MemberColor = (typeof MEMBER_COLORS)[number];
export const memberColorSchema = z.enum(MEMBER_COLORS);

export const MEMBER_ROLES = ['admin', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** 表示名 1〜20 文字（NFC・前後の空白除去のあと） */
export const memberNameSchema = z
  .string()
  .transform(normalizeText)
  .refine((v) => graphemeLength(v) >= 1 && graphemeLength(v) <= 20, {
    message: '名前は 1〜20 文字にしてください',
  });

/** 略称 1 文字 */
export const memberMarkSchema = z
  .string()
  .transform(normalizeText)
  .refine((v) => graphemeLength(v) === 1, { message: '略称は 1 文字にしてください' });

/** 呼び名 最大 10 個・各 1〜10 文字 */
export const memberAliasesSchema = z
  .array(
    z
      .string()
      .transform(normalizeText)
      .refine((v) => graphemeLength(v) >= 1 && graphemeLength(v) <= 10, {
        message: '呼び名は 1〜10 文字にしてください',
      }),
  )
  .max(10);

/** Tailscale のログイン（小文字化・前後空白除去） */
export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export const loginSchema = z
  .string()
  .transform(normalizeLogin)
  .refine((v) => v.length >= 3 && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v), {
    message: 'ログインはメールアドレスの形にしてください',
  });
