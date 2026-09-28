import {
  addDays,
  type DateISO,
  fromJst,
  MINUTE_MS,
  minutesOfTime,
  todayJst,
  toJstParts,
} from './jst';
import type { NotificationSettings } from './schemas';

/**
 * 通知の時刻とだれに送るかの計算（§15）。Service Worker からも読むので zod などの重いものを import しない。
 * サーバーのスケジューラと PWA の詳細（自分への通知の札）で共有する。
 * 時刻は epoch ミリ秒。終日の回の startMs は開始日の 0:00（JST）なので、どちらも「開始＋オフセット」で決まる
 * （終日の -240 = 前日 20:00、420 = 当日 7:00）。
 */

/** 展開する範囲: 開始が [今−1450分, 今＋8日] の回（開始後の通知・終日の当日朝の通知も拾うため） */
export const REMINDER_LOOKBACK_MIN = 1450;
export const REMINDER_LOOKAHEAD_DAYS = 8;
/** 送る範囲: 通知時刻が (今−10分, 今]。再起動や 5xx のあとも、10 分以内なら送る */
export const SEND_GRACE_MIN = 10;
/** 家族の変更は、最後の変更から 2 分待って 1 通にまとめる */
export const CHANGE_BATCH_MIN = 2;
/** 変更・まとめの TTL（6 時間） */
export const DIGEST_TTL_SEC = 6 * 60 * 60;
/** 購読の失敗がこれを超えたら送らない（§15） */
export const MAX_FAIL_COUNT = 5;
/** ペイロードの上限（§15） */
export const PUSH_PAYLOAD_MAX_BYTES = 2048;

/** 通知時刻（ミリ秒） */
export function reminderAt(o: { startMs: number }, offsetMin: number): number {
  return o.startMs + offsetMin * MINUTE_MS;
}

/** 通知時刻が (今−10分, 今] にあるか */
export function inSendWindow(atMs: number, nowMs: number): boolean {
  return atMs > nowMs - SEND_GRACE_MIN * MINUTE_MS && atMs <= nowMs;
}

/** 回の中で、通知に使う項目（例外行ならその行の担当者。シリーズの通知の設定は親の ID で持つ） */
export interface ReminderTarget {
  allDay: boolean;
  forEveryone: boolean;
  memberIds: readonly string[];
  visibility: 'family' | 'private';
  ownerId: string;
}

/**
 * その人への通知のオフセット（§15・§10 reminder_prefs）。
 * - 本人の行があればそれ（`[]` は「通知なし」）
 * - なければ、担当者（全員の予定を含む）には本人の既定値（時刻あり timedDefaults・終日 allDayDefaults）
 * - 担当外は通知なし。他人の非公開には付けない
 */
export function effectiveOffsets(
  target: ReminderTarget,
  memberId: string,
  pref: readonly number[] | undefined,
  settings: Pick<NotificationSettings, 'timedDefaults' | 'allDayDefaults'>,
): number[] {
  if (target.visibility === 'private' && target.ownerId !== memberId) return [];
  if (pref !== undefined) return [...pref];
  const assignee = target.forEveryone || target.memberIds.includes(memberId);
  if (!assignee) return [];
  return [...(target.allDay ? settings.allDayDefaults : settings.timedDefaults)];
}

/** 通知のキー（予定が動いたら開始が変わって新しいキーになり、通知し直せる。§15） */
export function reminderKey(
  occurrenceKey: string,
  startMs: number,
  memberId: string,
  offset: number,
): string {
  return `rem:${occurrenceKey}:${startMs}:${memberId}:${offset}`;
}

export type DigestKind = 'morning' | 'evening';

export function digestKey(kind: DigestKind, memberId: string, date: DateISO): string {
  return `digest:${kind}:${memberId}:${date}`;
}

/**
 * まとめ・予告を送る日（本人の時刻が (今−10分, 今] に入った日）。なければ null。
 * 0:00 をまたぐ 10 分（23:55 の予告を 0:02 に拾う）も見るため、今日と 10 分前の日の両方を調べる
 */
export function digestDateDue(time: string, nowMs: number): DateISO | null {
  const today = todayJst(nowMs);
  const before = todayJst(nowMs - SEND_GRACE_MIN * MINUTE_MS);
  for (const date of before === today ? [today] : [before, today]) {
    if (inSendWindow(fromJst(date, time), nowMs)) return date;
  }
  return null;
}

/** 朝のまとめは今日、前夜の予告は明日の予定 */
export function digestTargetDate(kind: DigestKind, sendDate: DateISO): DateISO {
  return kind === 'morning' ? sendDate : addDays(sendDate, 1);
}

/** 静かな時間か（22:00〜7:00 のように日をまたぐ範囲も。from と to が同じなら静かな時間はない） */
export function inQuietHours(nowMs: number, quiet: NotificationSettings['quietHours']): boolean {
  if (!quiet.enabled) return false;
  const now = minutesOfTime(toJstParts(nowMs).time);
  const from = minutesOfTime(quiet.from);
  const to = minutesOfTime(quiet.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** 通知の札・本文の文言（分。負=前）。終日は開始日 0:00 基準 */
export function offsetLabel(offset: number, allDay: boolean): string {
  if (allDay) {
    const dayShift = Math.floor(offset / 1440);
    const minutes = ((offset % 1440) + 1440) % 1440;
    const time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    const day =
      dayShift === 0
        ? '当日'
        : dayShift === -1
          ? '前日'
          : dayShift === 1
            ? '翌日'
            : dayShift > 0
              ? `${dayShift}日後`
              : `${-dayShift}日前`;
    return `${day} ${time}`;
  }
  if (offset === 0) return '開始時';
  const abs = Math.abs(offset);
  const unit =
    abs % 1440 === 0 ? `${abs / 1440}日` : abs % 60 === 0 ? `${abs / 60}時間` : `${abs}分`;
  return offset < 0 ? `${unit}前` : `開始の${unit}後`;
}

/** 詳細・書く画面で選べる通知の候補（§22 reminderOptions） */
export const TIMED_REMINDER_OPTIONS = [0, -10, -30, -60, -1440] as const;
/** 終日: 当日 7:00・前日 20:00・2 日前 20:00 */
export const ALL_DAY_REMINDER_OPTIONS = [420, -240, -1680] as const;

export function reminderOptions(allDay: boolean, current: readonly number[] = []): number[] {
  const base: number[] = allDay ? [...ALL_DAY_REMINDER_OPTIONS] : [...TIMED_REMINDER_OPTIONS];
  for (const o of current) if (!base.includes(o)) base.push(o);
  return allDay ? base : base.sort((a, b) => b - a);
}

/* ───────── ペイロード（§15） ───────── */

export const PUSH_KINDS = ['reminder', 'digest', 'change', 'test'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export interface PushPayload {
  v: 1;
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  tag: string;
  badge?: number;
}

/** ロック画面に予定名を出さない設定のときの文（§15） */
export const HIDDEN_TITLE = 'いと';
export const HIDDEN_BODY = '予定の通知があります';

export function hideDetails(payload: PushPayload): PushPayload {
  return { ...payload, title: HIDDEN_TITLE, body: HIDDEN_BODY };
}

/** UTF-8 にしたときのバイト数（core は DOM・Node の型を使わないので自前で数える） */
export function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return n;
}

/** 2KB を超えないように本文・件名を切る（JSON にしたときのバイト数で測る） */
export function fitPayload(payload: PushPayload): PushPayload {
  const size = (p: PushPayload) => utf8Length(JSON.stringify(p));
  let p = payload;
  while (size(p) > PUSH_PAYLOAD_MAX_BYTES && p.body.length > 0) {
    p = { ...p, body: `${[...p.body].slice(0, Math.max(0, [...p.body].length - 20)).join('')}…` };
    if (p.body === '…') p = { ...p, body: '' };
  }
  while (size(p) > PUSH_PAYLOAD_MAX_BYTES && p.title.length > 1) {
    p = {
      ...p,
      title: `${[...p.title].slice(0, Math.max(1, [...p.title].length - 10)).join('')}…`,
    };
  }
  return p;
}

/**
 * 通知を押したときに開く場所（§15）。同一オリジンのパスだけ受け付け、それ以外（別のオリジン・`//host`・
 * `javascript:`・`\` を含むもの）は `/`
 */
export function safeNotificationPath(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 500) return '/';
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return '/';
  // 制御文字を含むものは受け付けない
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return '/';
  }
  return url;
}
