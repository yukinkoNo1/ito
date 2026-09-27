/**
 * 繰り返し（§11）。rrule を import するのはこのファイルだけ。外には自前の型（RuleParts・Wall）だけを出す。
 *
 * 浮動時刻: 予定の日時は JST の壁時計（'2026-10-03' '07:30'）で持つ。rrule には、壁時計の値をそのまま
 * UTC の Date（Date.UTC(2026, 9, 3, 7, 30)）として渡し、返ってきた Date も UTC の各項目を壁時計として読む。
 * こうすると端末やサーバーのタイムゾーンに関係なく、同じ入力から同じ回が出る（JST は夏時間がない）。
 */
import { RRule, Weekday as RRuleWeekday } from 'rrule';
import {
  addDays,
  type DateISO,
  isValidDate,
  parseDate,
  type TimeHM,
  WEEKDAY_LABELS,
  type Weekday,
  weekdayOf,
} from './jst';

/** 1 回の展開で出す回の上限（§11） */
export const MAX_OCCURRENCES_PER_EXPAND = 2000;

export type RuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** 曜日の指定（weekday: 0=日〜6=土。nth: 第 n（-1=最終）。毎週は null） */
export interface ByDay {
  weekday: Weekday;
  nth: number | null;
}

/** RRULE の中身（検証済み） */
export interface RuleParts {
  freq: RuleFreq;
  interval: number;
  count: number | null;
  /** 'YYYYMMDD'（終日）または 'YYYYMMDDTHHmmss'（時刻あり。浮動時刻） */
  until: string | null;
  byDay: ByDay[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  byYearDay: number[];
  byWeekNo: number[];
  wkst: Weekday | null;
}

/** 壁時計の日時（終日は '00:00'） */
export interface Wall {
  date: DateISO;
  time: TimeHM;
}

export type RuleResult = { ok: true; rule: RuleParts } | { ok: false; message: string };

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const FREQS: readonly RuleFreq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const ALLOWED_KEYS = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'BYSETPOS',
  'BYYEARDAY',
  'BYWEEKNO',
  'WKST',
]);

function fail(message: string): RuleResult {
  return { ok: false, message };
}

function intList(value: string, min: number, max: number): number[] | null {
  const out: number[] = [];
  for (const part of value.split(',')) {
    if (!/^[+-]?\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n === 0 || n < min || n > max) return null;
    out.push(n);
  }
  return out;
}

function untilValid(value: string): boolean {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/.exec(value);
  if (!m) return false;
  if (!isValidDate(`${m[1]}-${m[2]}-${m[3]}`)) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 59)) {
    return false;
  }
  return true;
}

/**
 * RRULE の検証（§11 のサブセット。§24 D33）。
 * - FREQ は DAILY・WEEKLY・MONTHLY・YEARLY だけ（HOURLY 以下は拒否）。INTERVAL 1〜99、COUNT 1〜1000、COUNT と UNTIL は併用しない
 * - DTSTART・TZID・BYHOUR・BYMINUTE・BYSECOND・RDATE・EXDATE などは拒否（開始は予定から導き、1 日の中で回を増やさない）
 * - 毎日・毎週は BYDAY（毎週の曜日）だけ。BYMONTH などの絞り込みで回が 1 つも出ない規則を作れないようにする
 *   （rrule は回が出ないと 9999 年まで空回りするため）。第 n 曜日は毎月・毎年だけ
 */
export function parseRrule(input: string): RuleResult {
  const text = input.trim().replace(/^RRULE:/i, '');
  if (text.length === 0 || text.length > 300) return fail('繰り返しの指定が正しくありません');
  const pairs = new Map<string, string>();
  for (const part of text.split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) return fail('繰り返しの指定が正しくありません');
    const key = part.slice(0, at).toUpperCase();
    const value = part.slice(at + 1).toUpperCase();
    if (!ALLOWED_KEYS.has(key)) return fail(`繰り返しに使えない指定です（${key}）`);
    if (pairs.has(key) || value.length === 0) return fail('繰り返しの指定が正しくありません');
    pairs.set(key, value);
  }
  const freq = pairs.get('FREQ');
  if (!freq) return fail('繰り返しの頻度がありません');
  if (!FREQS.includes(freq as RuleFreq)) {
    return fail('毎時・毎分の繰り返しは使えません（毎日・毎週・毎月・毎年だけ）');
  }
  const rule: RuleParts = {
    freq: freq as RuleFreq,
    interval: 1,
    count: null,
    until: null,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    bySetPos: [],
    byYearDay: [],
    byWeekNo: [],
    wkst: null,
  };
  const interval = pairs.get('INTERVAL');
  if (interval !== undefined) {
    if (!/^\d{1,2}$/.test(interval) || Number(interval) < 1) {
      return fail('繰り返しの間隔は 1〜99 です');
    }
    rule.interval = Number(interval);
  }
  const count = pairs.get('COUNT');
  if (count !== undefined) {
    if (!/^\d{1,4}$/.test(count) || Number(count) < 1 || Number(count) > 1000) {
      return fail('繰り返しの回数は 1〜1000 回です');
    }
    rule.count = Number(count);
  }
  const until = pairs.get('UNTIL');
  if (until !== undefined) {
    if (!untilValid(until)) return fail('繰り返しの終わりの日付が正しくありません');
    rule.until = until;
  }
  if (rule.count !== null && rule.until !== null) {
    return fail('繰り返しの回数と終わりの日付は、どちらか一方だけです');
  }
  const monthlyOrYearly = rule.freq === 'MONTHLY' || rule.freq === 'YEARLY';
  const byDay = pairs.get('BYDAY');
  if (byDay !== undefined) {
    for (const part of byDay.split(',')) {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(part);
      if (!m) return fail('繰り返しの曜日の指定が正しくありません');
      const weekday = DAY_CODES.indexOf(m[2] as (typeof DAY_CODES)[number]) as Weekday;
      let nth: number | null = null;
      if (m[1] !== undefined) {
        nth = Number(m[1]);
        const limit = rule.freq === 'YEARLY' ? 53 : 5;
        if (!monthlyOrYearly || nth === 0 || Math.abs(nth) > limit) {
          return fail('「第 n 曜日」は毎月・毎年の繰り返しだけです');
        }
      }
      if (rule.byDay.some((d) => d.weekday === weekday && d.nth === nth)) {
        return fail('繰り返しの曜日が重なっています');
      }
      rule.byDay.push({ weekday, nth });
    }
  }
  const lists: [string, keyof RuleParts, number, number, boolean][] = [
    ['BYMONTHDAY', 'byMonthDay', -31, 31, monthlyOrYearly],
    ['BYMONTH', 'byMonth', 1, 12, monthlyOrYearly],
    ['BYSETPOS', 'bySetPos', -366, 366, monthlyOrYearly],
    ['BYYEARDAY', 'byYearDay', -366, 366, rule.freq === 'YEARLY'],
    ['BYWEEKNO', 'byWeekNo', -53, 53, rule.freq === 'YEARLY'],
  ];
  for (const [key, field, min, max, allowed] of lists) {
    const value = pairs.get(key);
    if (value === undefined) continue;
    if (!allowed) return fail(`この頻度では使えない指定です（${key}）`);
    const list = intList(value, min, max);
    if (!list) return fail('繰り返しの指定が正しくありません');
    (rule[field] as number[]) = list;
  }
  const wkst = pairs.get('WKST');
  if (wkst !== undefined) {
    const i = DAY_CODES.indexOf(wkst as (typeof DAY_CODES)[number]);
    if (i < 0) return fail('繰り返しの指定が正しくありません');
    rule.wkst = i as Weekday;
  }
  if (rule.bySetPos.length > 0 && rule.byDay.length === 0 && rule.byMonthDay.length === 0) {
    return fail('繰り返しの指定が正しくありません');
  }
  return { ok: true, rule };
}

function dayCode(d: ByDay): string {
  return `${d.nth === null ? '' : d.nth}${DAY_CODES[d.weekday]}`;
}

/** 決まった順に並べた RRULE（保存・比較に使う） */
export function formatRrule(rule: RuleParts): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.map(dayCode).join(',')}`);
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.byMonth.length > 0) parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  if (rule.byYearDay.length > 0) parts.push(`BYYEARDAY=${rule.byYearDay.join(',')}`);
  if (rule.byWeekNo.length > 0) parts.push(`BYWEEKNO=${rule.byWeekNo.join(',')}`);
  if (rule.bySetPos.length > 0) parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
  if (rule.wkst !== null) parts.push(`WKST=${DAY_CODES[rule.wkst]}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.until !== null) parts.push(`UNTIL=${rule.until}`);
  return parts.join(';');
}

/** 検証して決まった順にする。正しくなければ null */
export function normalizeRrule(input: string): string | null {
  const r = parseRrule(input);
  return r.ok ? formatRrule(r.rule) : null;
}

/* ───────── 浮動時刻 ───────── */

function toFloating(w: Wall): Date {
  const { year, month, day } = parseDate(w.date);
  const [hh, mm] = w.time.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hh ?? 0, mm ?? 0));
}

function fromFloating(d: Date): Wall {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${String(d.getUTCFullYear()).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`,
    time: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`,
  };
}

function untilToFloating(until: string): Date {
  const y = Number(until.slice(0, 4));
  const m = Number(until.slice(4, 6));
  const d = Number(until.slice(6, 8));
  const hh = until.length > 8 ? Number(until.slice(9, 11)) : 0;
  const mi = until.length > 8 ? Number(until.slice(11, 13)) : 0;
  const ss = until.length > 8 ? Number(until.slice(13, 15)) : 0;
  return new Date(Date.UTC(y, m - 1, d, hh, mi, ss));
}

/** rrule の曜日の番号（0=月〜6=日） */
function rruleWeekday(w: Weekday): number {
  return (w + 6) % 7;
}

const ruleCache = new Map<string, RRule>();

function toRRule(rule: RuleParts, dtstart: Wall): RRule {
  const key = `${formatRrule(rule)}|${dtstart.date}T${dtstart.time}`;
  const hit = ruleCache.get(key);
  if (hit) return hit;
  const freq = {
    DAILY: RRule.DAILY,
    WEEKLY: RRule.WEEKLY,
    MONTHLY: RRule.MONTHLY,
    YEARLY: RRule.YEARLY,
  }[rule.freq];
  const r = new RRule({
    freq,
    interval: rule.interval,
    dtstart: toFloating(dtstart),
    count: rule.count,
    until: rule.until ? untilToFloating(rule.until) : null,
    byweekday:
      rule.byDay.length > 0
        ? rule.byDay.map((d) => new RRuleWeekday(rruleWeekday(d.weekday), d.nth ?? undefined))
        : null,
    bymonthday: rule.byMonthDay.length > 0 ? rule.byMonthDay : null,
    bymonth: rule.byMonth.length > 0 ? rule.byMonth : null,
    bysetpos: rule.bySetPos.length > 0 ? rule.bySetPos : null,
    byyearday: rule.byYearDay.length > 0 ? rule.byYearDay : null,
    byweekno: rule.byWeekNo.length > 0 ? rule.byWeekNo : null,
    wkst: rule.wkst === null ? null : rruleWeekday(rule.wkst),
  });
  if (ruleCache.size > 500) ruleCache.clear();
  ruleCache.set(key, r);
  return r;
}

/**
 * [from, to) に始まる回の開始（壁時計）。最大 limit 回で打ち切る（§11）。
 * dtstart は予定の開始（終日は '00:00'）
 */
export function ruleStarts(
  rule: RuleParts,
  dtstart: Wall,
  from: Wall,
  to: Wall,
  limit = MAX_OCCURRENCES_PER_EXPAND,
): Wall[] {
  const fromD = toFloating(from);
  const toD = toFloating(to);
  if (toD <= fromD) return [];
  const out: Wall[] = [];
  toRRule(rule, dtstart).between(fromD, toD, true, (d) => {
    if (d.getTime() >= toD.getTime()) return false;
    out.push(fromFloating(d));
    return out.length < limit;
  });
  return out;
}

/** 回の recurrenceId（§3: 時刻あり 'YYYY-MM-DDTHH:mm'、終日 'YYYY-MM-DD'） */
export function recurrenceIdOf(w: Wall, allDay: boolean): string {
  return allDay ? w.date : `${w.date}T${w.time}`;
}

/** recurrenceId → 壁時計 */
export function wallOfRecurrenceId(rid: string): Wall | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(rid);
  if (!m?.[1] || !isValidDate(m[1])) return null;
  return { date: m[1], time: m[2] ?? '00:00' };
}

/** その回がシリーズの回か（rid の日時にシリーズの回があるか） */
export function isOccurrenceOf(rule: RuleParts, dtstart: Wall, rid: Wall): boolean {
  const next = toFloating(rid);
  const hits = ruleStarts(rule, dtstart, rid, fromFloating(new Date(next.getTime() + 60_000)), 1);
  return hits.length === 1;
}

/** rid より前の回の数（rid は含まない。取り消した回も数える＝COUNT の数え方） */
export function countBefore(rule: RuleParts, dtstart: Wall, rid: Wall): number {
  const r = toRRule(rule, dtstart);
  let n = 0;
  r.between(toFloating(dtstart), toFloating(rid), true, (d) => {
    if (d.getTime() >= toFloating(rid).getTime()) return false;
    n++;
    return n <= 1000;
  });
  return n;
}

/** rid の直前の回（なければ null＝rid が初回） */
export function previousStart(rule: RuleParts, dtstart: Wall, rid: Wall): Wall | null {
  const prev = toRRule(rule, dtstart).before(toFloating(rid), false);
  return prev ? fromFloating(prev) : null;
}

/** 壁時計 → UNTIL の値（時刻ありはその日の 23:59:59。rrule は日付だけの UNTIL を 0:00 と読み、最終日の回を落とすため） */
export function untilFor(date: DateISO, allDay: boolean): string {
  const d = date.replaceAll('-', '');
  return allDay ? d : `${d}T235959`;
}

/** UNTIL → その日付 */
export function untilDate(until: string): DateISO {
  return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
}

/* ───────── 説明文（§11）と UI の形（§22） ───────── */

/** UI で作れる形か（それ以外は「カスタム」） */
function uiKind(
  rule: RuleParts,
):
  | { kind: 'daily' }
  | { kind: 'weekly' }
  | { kind: 'monthlyByDate'; day: number }
  | { kind: 'monthlyByWeekday'; nth: number[]; weekday: Weekday }
  | { kind: 'yearly' }
  | null {
  const extra =
    rule.byMonth.length + rule.bySetPos.length + rule.byYearDay.length + rule.byWeekNo.length;
  if (extra > 0) return null;
  switch (rule.freq) {
    case 'DAILY':
      return rule.byDay.length === 0 && rule.byMonthDay.length === 0 ? { kind: 'daily' } : null;
    case 'WEEKLY':
      return rule.byMonthDay.length === 0 && rule.byDay.every((d) => d.nth === null)
        ? { kind: 'weekly' }
        : null;
    case 'MONTHLY': {
      if (rule.byDay.length === 0 && rule.byMonthDay.length === 1) {
        return { kind: 'monthlyByDate', day: rule.byMonthDay[0] as number };
      }
      const first = rule.byDay[0];
      if (
        rule.byMonthDay.length === 0 &&
        first &&
        rule.byDay.every((d) => d.nth !== null && d.weekday === first.weekday)
      ) {
        return {
          kind: 'monthlyByWeekday',
          nth: rule.byDay.map((d) => d.nth as number),
          weekday: first.weekday,
        };
      }
      return null;
    }
    case 'YEARLY':
      return rule.byDay.length === 0 && rule.byMonthDay.length === 0 ? { kind: 'yearly' } : null;
  }
}

/** 曜日の並び（月曜から） */
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function every(interval: number, unit: '日' | '週' | 'か月' | '年', one: string): string {
  if (interval === 1) return one;
  if (interval === 2 && unit === '週') return '隔週';
  if (interval === 2 && unit === 'か月') return '隔月';
  return `${interval}${unit}ごと`;
}

/**
 * 繰り返しの説明文（§11）: 「毎週 月・木」「隔週 土」「毎月 第2・第4 水」「毎月 月末」「毎年」「毎日（10回）」。
 * 週の曜日を省いた毎週は、開始日の曜日で書く（dtstartDate を渡す）
 */
export function describeRule(rule: RuleParts, dtstartDate?: DateISO): string {
  const kind = uiKind(rule);
  let body: string;
  if (!kind) {
    body = 'カスタムの繰り返し';
  } else if (kind.kind === 'daily') {
    body = every(rule.interval, '日', '毎日');
  } else if (kind.kind === 'weekly') {
    const days =
      rule.byDay.length > 0
        ? rule.byDay.map((d) => d.weekday)
        : dtstartDate
          ? [weekdayOf(dtstartDate)]
          : [];
    const sorted = WEEK_ORDER.filter((w) => days.includes(w));
    body = `${every(rule.interval, '週', '毎週')}${sorted.length ? ` ${sorted.map((w) => WEEKDAY_LABELS[w]).join('・')}` : ''}`;
  } else if (kind.kind === 'monthlyByDate') {
    body = `${every(rule.interval, 'か月', '毎月')} ${kind.day === -1 ? '月末' : kind.day < 0 ? `月末から${-kind.day}日前` : `${kind.day}日`}`;
  } else if (kind.kind === 'monthlyByWeekday') {
    const nth = [...kind.nth].sort((a, b) => (a < 0 ? 99 : a) - (b < 0 ? 99 : b));
    const label = nth
      .map((n) => (n === -1 ? '最終' : n < 0 ? `最後から${-n}` : `第${n}`))
      .join('・');
    body = `${every(rule.interval, 'か月', '毎月')} ${label} ${WEEKDAY_LABELS[kind.weekday]}`;
  } else {
    body = every(rule.interval, '年', '毎年');
  }
  if (rule.count !== null) return `${body}（${rule.count}回）`;
  if (rule.until !== null) {
    const { month, day } = parseDate(untilDate(rule.until));
    return `${body}（${month}/${day}まで）`;
  }
  return body;
}

/** RRULE 文字列の説明文（正しくなければ null） */
export function describe(rrule: string, dtstartDate?: DateISO): string | null {
  const r = parseRrule(rrule);
  return r.ok ? describeRule(r.rule, dtstartDate) : null;
}

/** §22 の RecurrenceVM・RecurrenceEndVM と同じ形（core は ui の型を import しないので、ここで同じ形を持つ） */
export type RecurrencePreset =
  | { kind: 'none' }
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: Weekday[] }
  | { kind: 'monthlyByDate'; day: number }
  | { kind: 'monthlyByWeekday'; nth: number[]; weekday: Weekday }
  | { kind: 'yearly' }
  | { kind: 'custom'; label: string };

export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'count'; count: number }
  | { kind: 'until'; date: DateISO };

/** RRULE → UI の形（繰り返しなしは none。UI で作れない形は custom） */
export function toPreset(
  rrule: string | null,
  dtstartDate: DateISO,
): { recurrence: RecurrencePreset; end: RecurrenceEnd } {
  if (!rrule) return { recurrence: { kind: 'none' }, end: { kind: 'never' } };
  const r = parseRrule(rrule);
  if (!r.ok)
    return { recurrence: { kind: 'custom', label: 'カスタムの繰り返し' }, end: { kind: 'never' } };
  const rule = r.rule;
  const end: RecurrenceEnd =
    rule.count !== null
      ? { kind: 'count', count: rule.count }
      : rule.until !== null
        ? { kind: 'until', date: untilDate(rule.until) }
        : { kind: 'never' };
  const kind = uiKind(rule);
  if (!kind) return { recurrence: { kind: 'custom', label: describeRule(rule, dtstartDate) }, end };
  switch (kind.kind) {
    case 'daily':
      return { recurrence: { kind: 'daily', interval: rule.interval }, end };
    case 'weekly': {
      const weekdays =
        rule.byDay.length > 0 ? rule.byDay.map((d) => d.weekday) : [weekdayOf(dtstartDate)];
      return { recurrence: { kind: 'weekly', interval: rule.interval, weekdays }, end };
    }
    case 'monthlyByDate':
      return rule.interval === 1
        ? { recurrence: { kind: 'monthlyByDate', day: kind.day }, end }
        : { recurrence: { kind: 'custom', label: describeRule(rule, dtstartDate) }, end };
    case 'monthlyByWeekday':
      return rule.interval === 1
        ? { recurrence: { kind: 'monthlyByWeekday', nth: kind.nth, weekday: kind.weekday }, end }
        : { recurrence: { kind: 'custom', label: describeRule(rule, dtstartDate) }, end };
    case 'yearly':
      return rule.interval === 1
        ? { recurrence: { kind: 'yearly' }, end }
        : { recurrence: { kind: 'custom', label: describeRule(rule, dtstartDate) }, end };
  }
}

/**
 * UI の形 → RRULE（繰り返しなしは null。custom は undefined＝今の RRULE のまま）。
 * 終わりは COUNT か UNTIL の一方だけ。時刻ありの UNTIL はその日の 23:59:59（浮動時刻）
 */
export function fromPreset(
  recurrence: RecurrencePreset,
  end: RecurrenceEnd,
  allDay: boolean,
): string | null | undefined {
  if (recurrence.kind === 'none') return null;
  if (recurrence.kind === 'custom') return undefined;
  const rule: RuleParts = {
    freq: 'DAILY',
    interval: 1,
    count: end.kind === 'count' ? end.count : null,
    until: end.kind === 'until' ? untilFor(end.date, allDay) : null,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    bySetPos: [],
    byYearDay: [],
    byWeekNo: [],
    wkst: null,
  };
  switch (recurrence.kind) {
    case 'daily':
      rule.interval = recurrence.interval;
      break;
    case 'weekly':
      rule.freq = 'WEEKLY';
      rule.interval = recurrence.interval;
      rule.byDay = WEEK_ORDER.filter((w) => recurrence.weekdays.includes(w)).map((weekday) => ({
        weekday,
        nth: null,
      }));
      break;
    case 'monthlyByDate':
      rule.freq = 'MONTHLY';
      rule.byMonthDay = [recurrence.day];
      break;
    case 'monthlyByWeekday':
      rule.freq = 'MONTHLY';
      rule.byDay = recurrence.nth.map((nth) => ({ weekday: recurrence.weekday, nth }));
      break;
    case 'yearly':
      rule.freq = 'YEARLY';
      break;
  }
  return formatRrule(rule);
}

/** 29〜31 日を選んだ毎月なら「月末にしますか？」と聞く（31 日のない月などはとばされるため。§11） */
export function suggestMonthEnd(startDate: DateISO): boolean {
  return parseDate(startDate).day >= 29;
}

/**
 * 「すべて」の日時の変更（§11）: 選んだ回の元の日時からの差分（日数）を、曜日・日の指定にも当てる。
 * 毎週の曜日・毎月の日（正の日付）・毎月の第 n 曜日の曜日をずらす。UI で作れない形はそのまま
 */
export function shiftRule(rule: RuleParts, deltaDays: number): RuleParts {
  if (deltaDays === 0) return rule;
  const kind = uiKind(rule);
  if (!kind) return rule;
  const shiftWeekday = (w: Weekday) => ((((w + deltaDays) % 7) + 7) % 7) as Weekday;
  if (kind.kind === 'weekly' || kind.kind === 'monthlyByWeekday') {
    return { ...rule, byDay: rule.byDay.map((d) => ({ ...d, weekday: shiftWeekday(d.weekday) })) };
  }
  if (kind.kind === 'monthlyByDate' && kind.day > 0) {
    const day = kind.day + deltaDays;
    return { ...rule, byMonthDay: [day >= 1 && day <= 31 ? day : day > 31 ? -1 : 1] };
  }
  return rule;
}

/** 日付に日数を足した壁時計 */
export function shiftWall(w: Wall, deltaMinutes: number): Wall {
  const [hh, mm] = w.time.split(':').map(Number);
  const total = (hh ?? 0) * 60 + (mm ?? 0) + deltaMinutes;
  const days = Math.floor(total / 1440);
  const min = ((total % 1440) + 1440) % 1440;
  return {
    date: addDays(w.date, days),
    time: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`,
  };
}
