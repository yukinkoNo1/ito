import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** エラーの code ごとの日本語の title（RFC 9457 の problem+json。SPEC §13） */
const TITLES: Record<string, string> = {
  no_identity: 'ログインが確認できません',
  not_member: 'このアカウントは家族として登録されていません',
  forbidden: 'この操作はできません',
  csrf: 'このリクエストは受け付けられません',
  misdirected: 'ホスト名が正しくありません',
  payload_too_large: '送信内容が大きすぎます',
  body_incomplete: '送信内容を最後まで受け取れませんでした',
  not_found: '見つかりません',
  occurrence_not_found: 'この回は見つかりません',
  gone: 'この予定は削除されています',
  method_not_allowed: 'この方法では使えません',
  validation: '入力内容が正しくありません',
  invalid_query: 'パラメータが正しくありません',
  conflict: 'ほかの家族が先に変更しました',
  name_taken: 'その名前はほかの家族が使っています',
  color_taken: 'その色はほかの家族が使っています',
  login_taken: 'そのログインはもう登録されています',
  member_limit: '家族の人数の上限に達しています',
  last_admin: '最後の管理者は外せません',
  precondition_required: 'If-Match が必要です',
  idempotency_key_required: 'Idempotency-Key が必要です',
  client_outdated: 'アプリを更新してください',
  rate_limited: '回数が多すぎます。しばらく待ってからやり直してください',
  feed_unauthorized: '連携キーが正しくありません',
  feed_user_device: '人の端末からは表示用フィードを読めません',
  push_unavailable: '通知の設定がされていません',
  device_limit: '通知を受け取る端末の数の上限に達しています',
  series_limit: '繰り返しの予定の数の上限に達しています',
  internal: 'サーバーでエラーが起きました',
};

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    public readonly detail?: string,
    public readonly extra?: Record<string, unknown>,
    public readonly headers?: Record<string, string>,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export function titleOf(code: string): string {
  return TITLES[code] ?? TITLES.internal ?? 'エラー';
}

export function problemBody(
  status: number,
  code: string,
  detail?: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: `urn:ito:problem:${code}`,
    title: titleOf(code),
    status,
    ...(detail ? { detail } : {}),
    code,
    ...(extra ?? {}),
  };
}

export function problemResponse(c: Context, err: ApiError): Response {
  const body = JSON.stringify(problemBody(err.status, err.code, err.detail, err.extra));
  const headers: Record<string, string> = {
    'Content-Type': 'application/problem+json; charset=utf-8',
    ...(err.headers ?? {}),
  };
  return c.body(body, err.status, headers);
}
