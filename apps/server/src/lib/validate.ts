import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from '../errors';

export interface FieldProblem {
  field: string;
  message: string;
}

export function validationError(errors: FieldProblem[]): ApiError {
  return new ApiError(422, 'validation', errors[0]?.message, { errors });
}

function toProblems(error: z.ZodError): FieldProblem[] {
  return error.issues.map((i) => ({
    field: i.path.map(String).join('.') || '(本文)',
    message: i.message,
  }));
}

/** 本文を JSON として読み、zod で検証する（失敗は 422 validation。入力値そのものは返さない） */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw validationError([{ field: '(本文)', message: 'JSON の形式が正しくありません' }]);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw validationError(toProblems(parsed.error));
  return parsed.data;
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw validationError(toProblems(parsed.error));
  return parsed.data;
}

/**
 * If-Match: 3 / "3" / W/"3" → 3。なければ null、形が違えば NaN。
 * 検査（428・422・409）は認可のあとにサービス側で行う（§10「認可 → If-Match」）。
 */
export function parseIfMatch(c: Context): number | null {
  const raw = c.req.header('if-match');
  if (raw === undefined) return null;
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw.trim());
  return m ? Number(m[1]) : Number.NaN;
}

/** Idempotency-Key（1〜200 文字の見える ASCII） */
export function parseIdempotencyKey(c: Context): string | null {
  const raw = c.req.header('idempotency-key');
  if (raw === undefined) return null;
  const v = raw.trim();
  if (!/^[\x21-\x7e]{1,200}$/.test(v)) {
    throw validationError([
      { field: 'Idempotency-Key', message: 'Idempotency-Key の形式が正しくありません' },
    ]);
  }
  return v;
}
