import type { MiddlewareHandler } from 'hono';

/** SPEC §18 のレスポンスヘッダ（全応答） */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** next() のあとに付けるので、エラー応答（problem+json）にも付く */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
  };
}
