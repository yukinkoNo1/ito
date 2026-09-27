/**
 * 日本時間（Asia/Tokyo、UTC+9 固定・夏時間なし）の日付計算。
 * 端末やサーバーのタイムゾーンを使わず、epoch ミリ秒に 9 時間を足して UTC として読む。
 * Temporal は使わない（SPEC §8）。
 */

/** 'YYYY-MM-DD'（日本時間の日付） */
export type DateISO = string;
/** 'HH:mm'（24 時間表記・日本時間） */
export type TimeHM = string;
/** 0=日 1=月 2=火 3=水 4=木 5=金 6=土 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

export interface JstParts {
  date: DateISO;
  time: TimeHM;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function toJstParts(ms: number): JstParts {
  const d = new Date(ms + JST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  return {
    date: `${pad4(year)}-${pad2(month)}-${pad2(day)}`,
    time: `${pad2(hour)}:${pad2(minute)}`,
    year,
    month,
    day,
    hour,
    minute,
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay() as Weekday,
  };
}

export function todayJst(nowMs: number): DateISO {
  return toJstParts(nowMs).date;
}

export function parseDate(date: DateISO): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`日付の形式が正しくありません: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** 日付の 0:00（UTC 扱い）の epoch ミリ秒。日数の計算用 */
function dateToUtcMs(date: DateISO): number {
  const { year, month, day } = parseDate(date);
  return Date.UTC(year, month - 1, day);
}

function utcMsToDate(ms: number): DateISO {
  const d = new Date(ms);
  return `${pad4(d.getUTCFullYear())}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function minutesOfTime(time: TimeHM): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new RangeError(`時刻の形式が正しくありません: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function timeFromMinutes(min: number): TimeHM {
  const m = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 日本時間の日付と時刻 → epoch ミリ秒 */
export function fromJst(date: DateISO, time: TimeHM = '00:00'): number {
  return dateToUtcMs(date) + minutesOfTime(time) * MINUTE_MS - JST_OFFSET_MS;
}

/** 日本時間の日付の 0:00 から min 分後 → epoch ミリ秒（24:00 以降も可） */
export function fromJstMinutes(date: DateISO, min: number): number {
  return dateToUtcMs(date) + min * MINUTE_MS - JST_OFFSET_MS;
}

export function addDays(date: DateISO, n: number): DateISO {
  return utcMsToDate(dateToUtcMs(date) + n * DAY_MS);
}

/** b − a の日数 */
export function diffDays(a: DateISO, b: DateISO): number {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / DAY_MS);
}

export function weekdayOf(date: DateISO): Weekday {
  return new Date(dateToUtcMs(date)).getUTCDay() as Weekday;
}

/** 月を足す。日は月末に丸める */
export function addMonths(date: DateISO, n: number): DateISO {
  const { year, month, day } = parseDate(date);
  const total = year * 12 + (month - 1) + n;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  const d = Math.min(day, daysInMonth(y, mo));
  return `${pad4(y)}-${pad2(mo)}-${pad2(d)}`;
}

export function monthKey(year: number, month: number): string {
  return `${pad4(year)}-${pad2(month)}`;
}

export function firstOfMonth(year: number, month: number): DateISO {
  return `${pad4(year)}-${pad2(month)}-01`;
}

/** その日を含む週の始まりの日（weekStart 0=日曜 1=月曜） */
export function startOfWeek(date: DateISO, weekStart: 0 | 1): DateISO {
  const wd = weekdayOf(date);
  const back = (wd - weekStart + 7) % 7;
  return addDays(date, -back);
}

/** '2026-10-03T07:00:00+09:00' */
export function toIsoJst(ms: number): string {
  const p = toJstParts(ms);
  return `${p.date}T${p.time}:${pad2(p.second)}+09:00`;
}

const ISO_RE =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** オフセット付きの ISO 8601 → epoch ミリ秒。形式が違えば null */
export function parseIsoToMs(value: string): number | null {
  const m = ISO_RE.exec(value);
  if (!m) return null;
  const date = m[1] as string;
  if (!isValidDate(date)) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  const second = m[4] ? Number(m[4]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const tz = m[5] as string;
  let offsetMin = 0;
  if (tz !== 'Z') {
    const sign = tz.startsWith('-') ? -1 : 1;
    const [oh, om] = tz.slice(1).split(':').map(Number) as [number, number];
    offsetMin = sign * (oh * 60 + om);
  }
  const { year, month, day } = parseDate(date);
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(ms)) return null;
  return ms - offsetMin * MINUTE_MS;
}

/** 'M/D' */
export function formatMd(date: DateISO): string {
  const { month, day } = parseDate(date);
  return `${month}/${day}`;
}

/** 'M/D(曜)' */
export function formatMdW(date: DateISO): string {
  return `${formatMd(date)}(${WEEKDAY_LABELS[weekdayOf(date)]})`;
}

/** 'M月D日' */
export function formatMonthDay(date: DateISO): string {
  const { month, day } = parseDate(date);
  return `${month}月${day}日`;
}

/** 'H:mm' → 先頭の 0 を取った表示（'08:00' → '8:00'） */
export function formatTimeShort(time: TimeHM): string {
  return time.startsWith('0') ? time.slice(1) : time;
}

export function compareDate(a: DateISO, b: DateISO): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: DateISO, b: DateISO): DateISO {
  return a > b ? a : b;
}

export function minDate(a: DateISO, b: DateISO): DateISO {
  return a < b ? a : b;
}
