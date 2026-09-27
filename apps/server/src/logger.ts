import pino, { type DestinationStream, type Logger } from 'pino';

export type { Logger };

/** 連携キー（ito_feed_…）。どこに出てもマスクする（SPEC §18 のログ） */
const FEED_TOKEN_RE = /ito_feed_[A-Za-z0-9_-]*/g;
/** Anthropic の API キー（念のため） */
const ANTHROPIC_KEY_RE = /sk-ant-[A-Za-z0-9_-]*/g;

export function maskSecretsInString(value: string): string {
  return value
    .replace(FEED_TOKEN_RE, 'ito_feed_[masked]')
    .replace(ANTHROPIC_KEY_RE, 'sk-ant-[masked]');
}

/** ログに渡す値の中の文字列を、深さ 6 までたどってマスクする */
export function maskSecrets(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskSecretsInString(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      type: value.name,
      message: maskSecretsInString(value.message),
    };
    if (value.stack) out.stack = maskSecretsInString(value.stack);
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = maskSecrets(v, depth + 1);
  return out;
}

/**
 * ログに出してよいのは、メンバー ID・予定 ID・操作・所要時間・状態コードまで（SPEC §18）。
 * 予定名・メモ・場所・入力文・ログイン（メールアドレス）・ヘッダ全体・連携キーは渡さない。
 * 渡してしまったときのために、よくある名前の項目は redact で消し、連携キーの形の文字列はマスクする。
 */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: undefined,
      redact: {
        paths: [
          'headers',
          'req.headers',
          'authorization',
          '*.authorization',
          'token',
          '*.token',
          'text',
          '*.text',
          'title',
          '*.title',
          'note',
          '*.note',
          'location',
          '*.location',
          'login',
          '*.login',
          'email',
          '*.email',
        ],
        censor: '[redacted]',
      },
      hooks: {
        logMethod(args, method) {
          method.apply(this, args.map((a) => maskSecrets(a)) as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
}
