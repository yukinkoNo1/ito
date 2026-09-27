/** プロトコル版（X-Ito-Client。§12） */
export const PROTOCOL_VERSION = '1';

export class NetworkError extends Error {
  constructor() {
    super('家のサーバーにつながりません');
    this.name = 'NetworkError';
  }
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

const DEV_LOGIN_KEY = 'ito.devLogin';

/** 開発・E2E のビルドだけ、X-Dev-Login で本人を切り替えられる（本番のビルドには入らない） */
export function devLogin(): string | null {
  if (!(import.meta.env.DEV || __ITO_E2E__)) return null;
  try {
    return globalThis.localStorage?.getItem(DEV_LOGIN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setDevLogin(login: string | null): void {
  if (!(import.meta.env.DEV || __ITO_E2E__)) return;
  if (login) localStorage.setItem(DEV_LOGIN_KEY, login);
  else localStorage.removeItem(DEV_LOGIN_KEY);
}

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * API クライアント。状態を変える要求には Content-Type: application/json と X-Ito-Client を付ける（§13・§14）。
 * 通信できなければ NetworkError（Tailscale が切れたときも。navigator.onLine は見ない。§12）。
 */
export async function apiRequest(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string>; fetcher?: Fetcher } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    'X-Ito-Client': PROTOCOL_VERSION,
    Accept: 'application/json',
  };
  const stateChanging = method !== 'GET' && method !== 'HEAD';
  if (stateChanging) headers['Content-Type'] = 'application/json';
  // 本番のビルドでは分岐ごと消える（X-Dev-Login の文字列も残らない）
  if (import.meta.env.DEV || __ITO_E2E__) {
    const dev = devLogin();
    if (dev) headers['X-Dev-Login'] = dev;
  }
  Object.assign(headers, opts.headers ?? {});
  const fetcher = opts.fetcher ?? ((i, init) => fetch(i, init));
  let res: Response;
  try {
    res = await fetcher(path, {
      method,
      headers,
      body: stateChanging ? JSON.stringify(opts.body ?? {}) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new NetworkError();
  }
  let body: unknown = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

export function problemCode(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'code' in body) {
    const code = (body as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}
