import { z } from 'zod';

/** 空文字は未設定として扱う（compose の env_file で `KEY=` と書かれたもの） */
const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
);

const boolString = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.enum(['true', 'false']).optional(),
  )
  .transform((v) => v === 'true');

const intWithDefault = (def: number, min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().int().min(min).max(max).default(def),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  AUTH_MODE: z.enum(['tailscale', 'dev']).default('tailscale'),
  HOST: z.string().default('127.0.0.1'),
  PORT: intWithDefault(8787, 1, 65535),
  APP_ORIGIN: z.string(),
  DEV_LOGIN: optionalString,
  ADMIN_LOGINS: optionalString.transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0)
      : [],
  ),
  // 色（8 色）が有効なメンバー間で重複できないので、上限は 8
  MAX_MEMBERS: intWithDefault(6, 1, 8),
  DATABASE_PATH: z.string().min(1).default('/data/ito.db'),
  BACKUP_DIR: z.string().min(1).default('/data/backups'),
  STATIC_DIR: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString.transform((v) => v ?? 'claude-haiku-4-5'),
  AI_TIMEOUT_MS: intWithDefault(6000, 500, 60000),
  AI_RATE_PER_MIN: intWithDefault(20, 1, 1000),
  AI_RATE_PER_DAY: intWithDefault(200, 1, 100000),
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalString,
  VAPID_SUBJECT: optionalString,
  BACKUP_KEEP: intWithDefault(14, 1, 365),
  FEED_ALLOW_USER_DEVICES: boolString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema> & {
  /** APP_ORIGIN を正規化したもの（'https://ito.example.ts.net'） */
  APP_ORIGIN: string;
  /** APP_ORIGIN のホスト部（Host 検査に使う。'ito.example.ts.net' や 'localhost:8787'） */
  APP_HOST: string;
};

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`環境変数が正しくありません:\n- ${problems.join('\n- ')}`);
    this.name = 'EnvError';
  }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

/**
 * 環境変数を検証する。SPEC §14 の起動時の検査を満たさなければ EnvError を投げる（起動しない）。
 * エラーメッセージには値を入れない（秘密情報を画面やログに出さないため）。
 */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(全体)'}: ${i.message}`),
    );
  }
  const env = parsed.data;
  const problems: string[] = [];

  let origin: URL | null = null;
  try {
    origin = new URL(env.APP_ORIGIN);
  } catch {
    problems.push('APP_ORIGIN: URL の形にしてください');
  }
  if (origin) {
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
      problems.push('APP_ORIGIN: http:// か https:// で始めてください');
    }
    if (origin.pathname !== '/' || origin.search || origin.hash || origin.username) {
      problems.push('APP_ORIGIN: オリジン（スキームとホスト）だけを書いてください');
    }
  }

  // §14 起動時の検査
  if (env.AUTH_MODE === 'dev' && env.NODE_ENV !== 'development') {
    problems.push('AUTH_MODE=dev は NODE_ENV=development のときだけ使えます');
  }
  if (!LOOPBACK_HOSTS.has(env.HOST)) {
    problems.push('HOST: 127.0.0.1 か ::1 にしてください（Tailscale Serve からだけ届くように）');
  }
  if (env.AUTH_MODE === 'tailscale' && origin && origin.protocol !== 'https:') {
    problems.push('APP_ORIGIN: AUTH_MODE=tailscale では https:// にしてください');
  }
  if (env.AUTH_MODE === 'dev' && !env.DEV_LOGIN) {
    problems.push('DEV_LOGIN: AUTH_MODE=dev では既定の本人のログインが要ります');
  }

  // VAPID は 2 つそろえて、subject は mailto: か https:
  const hasPub = Boolean(env.VAPID_PUBLIC_KEY);
  const hasPriv = Boolean(env.VAPID_PRIVATE_KEY);
  if (hasPub !== hasPriv) {
    problems.push('VAPID_PUBLIC_KEY と VAPID_PRIVATE_KEY は両方を設定してください');
  }
  if (hasPub && hasPriv) {
    const subject = env.VAPID_SUBJECT ?? '';
    const ok =
      /^mailto:[^\s@]+@[^\s@]+$/.test(subject) ||
      (() => {
        try {
          return new URL(subject).protocol === 'https:';
        } catch {
          return false;
        }
      })();
    if (!ok) problems.push('VAPID_SUBJECT: mailto: か https: の正しい形式にしてください');
  }

  if (problems.length > 0) throw new EnvError(problems);

  const appOrigin = (origin as URL).origin;
  return { ...env, APP_ORIGIN: appOrigin, APP_HOST: (origin as URL).host };
}
