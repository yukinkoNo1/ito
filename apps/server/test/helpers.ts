import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { type FakeClock, fakeClock, fromJst } from '@ito/core';
import { type App, createApp, type PushDeps } from '../src/app';
import { type Database_, openDatabase, runMigrations } from '../src/db/client';
import { type Env, loadEnv } from '../src/env';
import { createLogger, type Logger } from '../src/logger';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

export const TS_ORIGIN = 'https://ito.example.ts.net';
export const DEV_ORIGIN = 'http://localhost:8787';

/** 本番と同じ設定（AUTH_MODE=tailscale） */
export function tailscaleEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'production',
    AUTH_MODE: 'tailscale',
    HOST: '127.0.0.1',
    APP_ORIGIN: TS_ORIGIN,
    ADMIN_LOGINS: 'admin@example.com',
    DATABASE_PATH: ':memory:',
    ...overrides,
  });
}

/** 開発モード */
export function devEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'development',
    AUTH_MODE: 'dev',
    APP_ORIGIN: DEV_ORIGIN,
    DEV_LOGIN: 'papa@example.com',
    ADMIN_LOGINS: 'papa@example.com',
    DATABASE_PATH: ':memory:',
    ...overrides,
  });
}

export class LogCapture {
  lines: string[] = [];
  stream = new Writable({
    write: (chunk, _enc, cb) => {
      this.lines.push(String(chunk));
      cb();
    },
  });
  get text(): string {
    return this.lines.join('');
  }
}

export interface TestContext {
  app: App;
  env: Env;
  database: Database_;
  clock: FakeClock;
  logs: LogCapture;
  logger: Logger;
  close(): void;
}

export function createTestContext(
  env: Env,
  opts: { now?: number; staticDir?: string | null; push?: PushDeps } = {},
): TestContext {
  const database = openDatabase(':memory:');
  runMigrations(database.db, MIGRATIONS_DIR);
  const clock = fakeClock(opts.now ?? fromJst('2026-09-27', '14:18'));
  const logs = new LogCapture();
  const logger = createLogger('debug', logs.stream);
  const app = createApp({
    env,
    db: database.db,
    sqlite: database.sqlite,
    clock,
    logger,
    staticDir: opts.staticDir ?? null,
    ...(opts.push ? { push: opts.push } : {}),
  });
  return { app, env, database, clock, logs, logger, close: () => database.close() };
}

export interface RequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  /** 既定では CSRF を通るヘッダ（X-Ito-Client・Content-Type・Origin・Sec-Fetch-Site）を付ける */
  csrf?: boolean;
  host?: string;
}

/** Host やCSRF 用のヘッダを付けて app.request() する */
export async function send(
  ctx: TestContext,
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = { host: opts.host ?? ctx.env.APP_HOST };
  const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (stateChanging && opts.csrf !== false) {
    headers['x-ito-client'] = '1';
    headers['content-type'] = 'application/json';
    headers.origin = ctx.env.APP_ORIGIN;
    headers['sec-fetch-site'] = 'same-origin';
  }
  Object.assign(headers, opts.headers ?? {});
  for (const [k, v] of Object.entries(headers)) if (v === '') delete headers[k];
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  } else if (stateChanging && opts.csrf !== false) {
    init.body = '{}';
  }
  return ctx.app.request(`http://${headers.host ?? 'localhost'}${path}`, init);
}

/** Tailscale の ID ヘッダ */
export function tsUser(login: string, name?: string): Record<string, string> {
  return { 'tailscale-user-login': login, ...(name ? { 'tailscale-user-name': name } : {}) };
}
