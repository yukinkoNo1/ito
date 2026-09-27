import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../src/env';

const prod = {
  NODE_ENV: 'production',
  AUTH_MODE: 'tailscale',
  HOST: '127.0.0.1',
  APP_ORIGIN: 'https://ito.example.ts.net',
};

function problemsOf(source: Record<string, string>): string[] {
  try {
    loadEnv(source);
  } catch (e) {
    if (e instanceof EnvError) return e.problems;
    throw e;
  }
  return [];
}

describe('env の起動時検査（SPEC §14）', () => {
  it('本番の正しい設定なら通り、FEED_ALLOW_USER_DEVICES の既定は false', () => {
    const env = loadEnv(prod);
    expect(env.AUTH_MODE).toBe('tailscale');
    expect(env.APP_HOST).toBe('ito.example.ts.net');
    expect(env.FEED_ALLOW_USER_DEVICES).toBe(false);
    expect(env.MAX_MEMBERS).toBe(6);
    expect(env.ANTHROPIC_MODEL).toBe('claude-haiku-4-5');
  });

  it('本番設定で HOST=0.0.0.0 なら起動しない', () => {
    expect(() => loadEnv({ ...prod, HOST: '0.0.0.0' })).toThrow(EnvError);
  });

  it('HOST は ::1 でもよい', () => {
    expect(loadEnv({ ...prod, HOST: '::1' }).HOST).toBe('::1');
  });

  it('本番（NODE_ENV=production）で dev モードなら起動しない', () => {
    expect(() => loadEnv({ ...prod, AUTH_MODE: 'dev', DEV_LOGIN: 'papa@example.com' })).toThrow(
      EnvError,
    );
  });

  it('dev モードは NODE_ENV=development のときだけ（test でも不可）', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        AUTH_MODE: 'dev',
        DEV_LOGIN: 'a@example.com',
        APP_ORIGIN: 'http://localhost:5173',
      }),
    ).toThrow(EnvError);
    const env = loadEnv({
      NODE_ENV: 'development',
      AUTH_MODE: 'dev',
      DEV_LOGIN: 'a@example.com',
      APP_ORIGIN: 'http://localhost:5173',
    });
    expect(env.APP_HOST).toBe('localhost:5173');
  });

  it('AUTH_MODE=tailscale では APP_ORIGIN が https:// でなければ起動しない', () => {
    expect(() => loadEnv({ ...prod, APP_ORIGIN: 'http://ito.example.ts.net' })).toThrow(EnvError);
  });

  it('APP_ORIGIN にパスがあれば起動しない', () => {
    expect(() => loadEnv({ ...prod, APP_ORIGIN: 'https://ito.example.ts.net/app' })).toThrow(
      EnvError,
    );
  });

  it('VAPID は 2 つそろえ、subject は mailto: か https:', () => {
    // 形だけ正しい見本の鍵（P-256 の公開鍵 65 バイト・秘密鍵 32 バイトを base64url にした長さ）
    const pub = `B${'A'.repeat(86)}`;
    const priv = 'A'.repeat(43);
    expect(problemsOf({ ...prod, VAPID_PUBLIC_KEY: pub })).not.toHaveLength(0);
    expect(
      problemsOf({
        ...prod,
        VAPID_PUBLIC_KEY: pub,
        VAPID_PRIVATE_KEY: priv,
        VAPID_SUBJECT: 'you@example.com',
      }),
    ).not.toHaveLength(0);
    expect(
      problemsOf({
        ...prod,
        VAPID_PUBLIC_KEY: pub,
        VAPID_PRIVATE_KEY: priv,
        VAPID_SUBJECT: 'mailto:you@example.com',
      }),
    ).toHaveLength(0);
    expect(
      problemsOf({
        ...prod,
        VAPID_PUBLIC_KEY: pub,
        VAPID_PRIVATE_KEY: priv,
        VAPID_SUBJECT: 'https://ito.example.ts.net',
      }),
    ).toHaveLength(0);
  });

  it('VAPID の鍵の長さが違えば起動しない（値はメッセージに出さない）', () => {
    const problems = problemsOf({
      ...prod,
      VAPID_PUBLIC_KEY: 'pub-not-a-key',
      VAPID_PRIVATE_KEY: 'priv-not-a-key',
      VAPID_SUBJECT: 'mailto:you@example.com',
    });
    expect(problems).toHaveLength(2);
    expect(problems.join(' ')).not.toContain('not-a-key');
  });

  it('エラーメッセージに値（秘密情報）を出さない', () => {
    const secret = 'super-secret-private-key-value';
    const problems = problemsOf({
      ...prod,
      HOST: '0.0.0.0',
      VAPID_PRIVATE_KEY: secret,
      VAPID_SUBJECT: 'bad',
    });
    expect(problems.join('\n')).not.toContain(secret);
  });

  it('空文字は未設定として扱う（compose の env_file の KEY=）', () => {
    const env = loadEnv({
      ...prod,
      ANTHROPIC_API_KEY: '',
      FEED_ALLOW_USER_DEVICES: '',
      MAX_MEMBERS: '',
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.FEED_ALLOW_USER_DEVICES).toBe(false);
    expect(env.MAX_MEMBERS).toBe(6);
  });

  it('FEED_ALLOW_USER_DEVICES は true/false だけ', () => {
    expect(loadEnv({ ...prod, FEED_ALLOW_USER_DEVICES: 'true' }).FEED_ALLOW_USER_DEVICES).toBe(
      true,
    );
    expect(() => loadEnv({ ...prod, FEED_ALLOW_USER_DEVICES: 'yes' })).toThrow(EnvError);
  });

  it('ADMIN_LOGINS はカンマ区切りで小文字化する', () => {
    expect(
      loadEnv({ ...prod, ADMIN_LOGINS: ' You@Example.com , b@example.com' }).ADMIN_LOGINS,
    ).toEqual(['you@example.com', 'b@example.com']);
  });
});
