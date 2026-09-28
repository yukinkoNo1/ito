/**
 * 繰り返し（§11）。rrule を import するのはこのファイルだけ。外には自前の型（RuleParts・Wall）だけを出す。
 *
 * 浮動時刻: 予定の日時は JST の壁時計（'2026-10-03' '07:30'）で持つ。rrule には、壁時計の値をそのまま
 * UTC の Date（Date.UTC(2026, 9, 3, 7, 30)）として渡し、返ってきた Date も UTC の各項目を壁時計として読む。
 * こうすると端末やサーバーのタイムゾーンに関係なく、同じ入力から同じ回が出る（JST は夏時間がない）。
 */
import * as rruleModule from 'rrule';
import {
  addDays,
  type DateISO,
  daysInMonth,
  diffDays,
  isValidDate,
  parseDate,
  type TimeHM,
  WEEKDAY_LABELS,
  type Weekday,
  weekdayOf,
} from './jst';

/**
 * rrule 2.8.1 は UMD（package.json に type も exports もない）。Vite・esbuild・Vitest は名前付きの export に
 * 変換するが、Node の ESM（tsx の pnpm dev・seed・cli）では名前付きの export が見えず default に入る。どちらでも読む
 */
type RRuleModule = typeof rruleModule;
const rruleLib: RRuleModule =
  'RRule' in rruleModule && rruleModule.RRule
    ? rruleModule
    : (rruleModule as unknown as { default: RRuleModule }).default;
const { RRule, Weekday: RRuleWeekday } = rruleLib;
type RRuleInstance = InstanceType<typeof RRule>;

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
  // 毎日で曜日を絞り、間隔が 7 の倍数だと、開始の曜日しか来ない（ほかの曜日なら回が 1 つも出ず、空回りする）
  if (rule.freq === 'DAILY' && rule.byDay.length > 0 && rule.interval % 7 === 0) {
    return fail('曜日を決めた繰り返しは「毎週」で指定してください');
  }
  return { ok: true, rule };
}

function dayCode(d: ByDay): string {
  return `${d.nth === null ? '' : d.nth}${DAY_CODES[d.weekday]}`;
}

/** 曜日の並び（月曜から。保存の並びと画面の並び） */
const MONDAY_FIRST: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

function sortedDays(days: ByDay[]): ByDay[] {
  const order = (d: ByDay) => MONDAY_FIRST.indexOf(d.weekday);
  return [...days].sort((a, b) => (a.nth ?? 0) - (b.nth ?? 0) || order(a) - order(b));
}

function sortedNums(list: number[]): number[] {
  return [...new Set(list)].sort((a, b) => a - b);
}

/** 決まった順に並べた RRULE（保存・比較に使う）。項目の順に加えて、値の並びもそろえる（曜日は月曜から・数は小さい順） */
export function formatRrule(rule: RuleParts): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) parts.push(`BYDAY=${sortedDays(rule.byDay).map(dayCode).join(',')}`);
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${sortedNums(rule.byMonthDay).join(',')}`);
  if (rule.byMonth.length > 0) parts.push(`BYMONTH=${sortedNums(rule.byMonth).join(',')}`);
  if (rule.byYearDay.length > 0) parts.push(`BYYEARDAY=${sortedNums(rule.byYearDay).join(',')}`);
  if (rule.byWeekNo.length > 0) parts.push(`BYWEEKNO=${sortedNums(rule.byWeekNo).join(',')}`);
  if (rule.bySetPos.length > 0) parts.push(`BYSETPOS=${sortedNums(rule.bySetPos).join(',')}`);
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

/**
 * 使った順に残すキャッシュ（いっぱいになったら、いちばん前に使ったものから捨てる）。いっぱいで全部を捨てると、
 * 行が多いときに毎回計算し直すことになるため（総点検のレビュー C1・C2）
 */
class LruCache<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly capacity: number) {}
  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: string, value: V): V {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    return value;
  }
}

const ruleCache = new LruCache<RRuleInstance>(4000);

const RRULE_FREQ = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
} as const;

/** rrule に渡す BY の指定（空は null） */
function byOptions(rule: RuleParts) {
  return {
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
  };
}

function toRRule(rule: RuleParts, dtstart: Wall): RRuleInstance {
  const key = `${formatRrule(rule)}|${dtstart.date}T${dtstart.time}`;
  const hit = ruleCache.get(key);
  if (hit) return hit;
  const r = new RRule({
    freq: RRULE_FREQ[rule.freq],
    interval: rule.interval,
    dtstart: toFloating(dtstart),
    count: rule.count,
    until: rule.until ? untilToFloating(rule.until) : null,
    ...byOptions(rule),
  });
  return ruleCache.set(key, r);
}

/* ───────── 展開の重さを抑える（総点検 B1。§24 D39） ─────────
 * rrule は開始から 1 期間（毎日は日、毎月は月…）ずつ歩き、回が出ない期間も歩く。回の出ない規則（2 月 30 日など）は
 * 9999 年まで空回りし、1970 年に始まる毎日の規則は表示範囲まで 2 万日を歩く。そこで
 * (1) 保存するとき、回の出ない期間が続きすぎる規則を拒む（ruleDensityError）
 * (2) 展開は、表示範囲の少し前の期間の初めから始める（開始を期間の単位で送る）。COUNT の毎日・毎週は、送った期間で
 *     飛ばした回の数を計算で出して COUNT から引く。COUNT の毎月・毎年は、期間の種類ごとの回の数を覚えて足し合わせる
 * 展開のたびに行うのは計算だけで、シリーズ全体を歩かない（総点検のレビュー C1・C2）
 */

/** 回の出ない期間（毎月は月、毎年は年。間隔ごとに数える）が続いてよい数。毎日・毎週は規則の形から続かない */
export const MAX_EMPTY_PERIODS = { MONTHLY: 120, YEARLY: 10 } as const;

/**
 * rrule が開始から補う指定（毎週の曜日・毎月の日・毎年の月日）を書き足した規則。rrule の parseoptions と同じ条件
 * （BYWEEKNO・BYYEARDAY・BYMONTHDAY・BYDAY がどれもないとき）。開始を送っても回が変わらないようにする
 */
function explicitRule(rule: RuleParts, dtstartDate: DateISO): RuleParts {
  const none =
    rule.byDay.length + rule.byMonthDay.length + rule.byYearDay.length + rule.byWeekNo.length === 0;
  if (!none) return rule;
  const { month, day } = parseDate(dtstartDate);
  if (rule.freq === 'WEEKLY') {
    return { ...rule, byDay: [{ weekday: weekdayOf(dtstartDate), nth: null }] };
  }
  if (rule.freq === 'MONTHLY') return { ...rule, byMonthDay: [day] };
  if (rule.freq === 'YEARLY') {
    return {
      ...rule,
      byMonth: rule.byMonth.length > 0 ? rule.byMonth : [month],
      byMonthDay: [day],
    };
  }
  return rule;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 400 年でグレゴリオ暦（曜日も）は同じに戻る。年をその周期の中の 2000〜2399 年に写す */
function representativeYear(y: number): number {
  return 2000 + ((((y - 2000) % 400) + 400) % 400);
}

/**
 * その期間（毎月は月、毎年は年）に回が出るか。間隔を 1 万年にして、rrule が 1 期間だけを見るようにする
 * （回が出なくても次の期間は 9999 年より後なので、そこで止まる）
 */
function onePeriod(rule: RuleParts, start: Wall): RRuleInstance {
  return new RRule({
    freq: RRULE_FREQ[rule.freq],
    interval: rule.freq === 'MONTHLY' ? 120_000 : 10_000,
    dtstart: toFloating(start),
    ...byOptions(rule),
  });
}

function periodHasOccurrence(rule: RuleParts, periodStart: Wall): boolean {
  return onePeriod(rule, periodStart).after(toFloating(periodStart), true) !== null;
}

/** 規則の形（BY の指定）ごとの、期間の種類 → 回の数 */
const periodCountTables = new LruCache<Map<string, number>>(4000);

/**
 * その期間（毎月は月、毎年は年）に rrule が出す回の数（BYSETPOS の重複も数える＝COUNT の数え方）を返す関数。
 * 回の数は期間の種類（月の長さ・1 日の曜日、毎年は前後の年のうるう年と 1/1 の曜日）と BY の指定だけで決まる
 * （時刻・間隔には関係しない）ので、規則の形ごとに 1 つの表に覚える（総点検のレビュー 2 回目 D2・3 回目 E1）
 */
function periodCounter(ex: RuleParts): (y: number, m: number) => number {
  const shape = formatRrule({ ...ex, interval: 1, count: null, until: null });
  const table = periodCountTables.get(shape) ?? periodCountTables.set(shape, new Map());
  const monthly = ex.freq === 'MONTHLY';
  return (y, m) => {
    const kind = monthly
      ? `${m}|${daysInMonth(y, m)}|${firstWeekday(y, m)}`
      : `${isLeapYear(y - 1)}|${isLeapYear(y)}|${isLeapYear(y + 1)}|${firstWeekday(y, 1)}`;
    const known = table.get(kind);
    if (known !== undefined) return known;
    const start = { date: `${representativeYear(y)}-${pad2(m)}-01`, time: '00:00' };
    const n = onePeriod(ex, start).all().length;
    table.set(kind, n);
    return n;
  };
}

/** COUNT の毎月・毎年の「使った回の数」を覚える間隔（期間の数） */
const USED_CHECKPOINT = 64;
/** 規則と開始ごとの、1 + 64i 期間ぶんに使う回の数（i = 0, 1, 2, …） */
const usedCheckpoints = new LruCache<number[]>(20_000);

/**
 * COUNT の毎月・毎年で、開始から k 期間ぶん（間隔ごと）に使う回の数。最初の期間は開始より後だけを数える。
 * 64 期間ごとの合計を覚えておき、範囲が動いても近い区切りから足す（開始から足し直さない。3 回目 E2）
 */
function usedByPeriods(rule: RuleParts, ex: RuleParts, dtstart: Wall, k: number): number {
  const plain = { ...ex, count: null, until: null };
  const key = `${formatRrule(plain)}|${dtstart.date}T${dtstart.time}`;
  const count = periodCounter(plain);
  const { year, month } = parseDate(dtstart.date);
  const monthly = rule.freq === 'MONTHLY';
  const origin = monthly ? year * 12 + (month - 1) : year;
  const inPeriod = (j: number) => {
    const at = origin + j * rule.interval;
    return monthly ? count(Math.floor(at / 12), (at % 12) + 1) : count(at, 1);
  };
  const checkpoints =
    usedCheckpoints.get(key) ?? usedCheckpoints.set(key, [onePeriod(plain, dtstart).all().length]);
  const target = Math.floor((k - 1) / USED_CHECKPOINT);
  while (checkpoints.length - 1 < target) {
    const i = checkpoints.length - 1;
    let used = checkpoints[i] ?? 0;
    for (let j = 1 + USED_CHECKPOINT * i; j <= USED_CHECKPOINT * (i + 1); j++) used += inPeriod(j);
    checkpoints.push(used);
  }
  let used = checkpoints[target] ?? 0;
  for (let j = 1 + USED_CHECKPOINT * target; j < k; j++) used += inPeriod(j);
  return used;
}

const densityCache = new LruCache<boolean>(4000);

/**
 * どの期間にも回が出るのが規則の形から分かるか（周期をたどらなくてよい）。毎月の 1〜28 日（-1〜-28 日）・毎週の
 * 曜日・第 1〜4 曜日、毎年のそれに当たるものなど。UI で作れる規則はほとんどこれに当たる（総点検のレビュー C2）
 */
function everyPeriodHasOccurrence(ex: RuleParts): boolean {
  if (ex.bySetPos.length > 0 || ex.byYearDay.length > 0 || ex.byWeekNo.length > 0) return false;
  // 日と曜日の両方を書くと、両方に合う日だけになる（13 日の金曜など）
  if (ex.byMonthDay.length > 0 && ex.byDay.length > 0) return false;
  const someDay = ex.byMonthDay.some((v) => Math.abs(v) <= 28);
  // rrule は「曜日」と「第 n 曜日」を混ぜると、両方に合う日だけを出す（MO,1TU は回が出ない）。混ぜたものは周期をたどる
  const plain = ex.byDay.some((d) => d.nth === null);
  const nth = ex.byDay.filter((d) => d.nth !== null);
  const someWeekday = (limit: number) =>
    plain ? nth.length === 0 : nth.some((d) => Math.abs(d.nth ?? 0) <= limit);
  if (ex.freq === 'MONTHLY') {
    // 毎月の月の絞り込みは、間隔との組み合わせで回の出ない月が決まるので周期をたどる
    if (ex.byMonth.length > 0) return false;
    return ex.byMonthDay.length > 0 ? someDay : someWeekday(4);
  }
  if (ex.byMonthDay.length > 0) return someDay;
  // 毎年の第 n 曜日は、月を決めればその月の中、決めなければ年の中の n 番目
  return ex.byMonth.length > 0 ? someWeekday(4) : someWeekday(52);
}

/** その月の 1 日の曜日（0=日。文字列を作らずに計算する） */
function firstWeekday(y: number, m: number): number {
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}

/**
 * 回の出ない期間が MAX_EMPTY_PERIODS を超えて続かないか。規則の形から分かるものはすぐ返す。そうでなければ、
 * 毎月は (年 mod 400, 月)、毎年は (年 mod 400) の周期を、間隔ごとに一回りたどる（毎月は最大 4,800 期間、
 * 毎年は最大 400 期間）。期間の回の有無は、月の長さ・1 日の曜日（毎年は前後の年のうるう年と 1/1 の曜日）が同じなら
 * 同じなので、その組ごとに rrule で 1 期間だけ確かめる。結果は覚えておく
 */
function denseEnough(rule: RuleParts, dtstart: Wall, byShape = true): boolean {
  if (rule.freq === 'DAILY' || rule.freq === 'WEEKLY') return true;
  const ex = explicitRule({ ...rule, count: null, until: null }, dtstart.date);
  if (byShape && everyPeriodHasOccurrence(ex)) return true;
  const { year, month } = parseDate(dtstart.date);
  const monthly = rule.freq === 'MONTHLY';
  const cycle = monthly ? 4800 : 400;
  const origin = monthly ? year * 12 + (month - 1) : year;
  // たどる期間の組は、開始を「間隔と周期の最大公約数」で割った余りで決まる（どこから回り始めても、続く長さは同じ）。
  // 開始の日だけが違う同じ規則は 1 つにまとまる
  const g = gcd(rule.interval, cycle);
  const key = `${formatRrule(ex)}|${((origin % g) + g) % g}`;
  const hit = densityCache.get(key);
  if (hit !== undefined) return hit;

  const byKind = new Map<string, boolean>();
  const produces = (y: number, m: number): boolean => {
    const kind = monthly
      ? `${m}|${daysInMonth(y, m)}|${firstWeekday(y, m)}`
      : `${isLeapYear(y - 1)}|${isLeapYear(y)}|${isLeapYear(y + 1)}|${firstWeekday(y, 1)}`;
    const known = byKind.get(kind);
    if (known !== undefined) return known;
    const has = periodHasOccurrence(ex, { date: `${y}-${pad2(m)}-01`, time: dtstart.time });
    byKind.set(kind, has);
    return has;
  };

  const steps = cycle / gcd(rule.interval, cycle);
  const flags: boolean[] = [];
  for (let j = 0; j < steps; j++) {
    const at = origin + j * rule.interval;
    const y = monthly ? Math.floor(at / 12) : at;
    const m = monthly ? (at % 12) + 1 : 1;
    flags.push(produces(representativeYear(y), m));
  }
  let ok = flags.some(Boolean);
  // 周期の終わりと初めをつないで、回の出ない期間が続く長さを見る
  let run = 0;
  for (let j = 0; j < steps * 2 && ok; j++) {
    run = flags[j % steps] ? 0 : run + 1;
    if (run > MAX_EMPTY_PERIODS[rule.freq]) ok = false;
  }
  return densityCache.set(key, ok);
}

/** テスト用: 規則の形からの判定と、周期をたどる判定を別々に返す（形からの判定が誤っていないかを確かめる） */
export function densityPathsForTest(
  rule: RuleParts,
  dtstart: Wall,
): { shape: boolean; walk: boolean } {
  const ex = explicitRule({ ...rule, count: null, until: null }, dtstart.date);
  return { shape: everyPeriodHasOccurrence(ex), walk: denseEnough(rule, dtstart, false) };
}

/** 保存する規則の検査（開始が決まってから）。回が 1 つも出ない・まれにしか出ない規則はエラーの文 */
export function ruleDensityError(rule: RuleParts, dtstart: Wall): string | null {
  if (denseEnough(rule, dtstart)) return null;
  return rule.freq === 'MONTHLY'
    ? '回がほとんど出ない繰り返しです（回の出ない月が 120 回を超えて続きます）'
    : '回がほとんど出ない繰り返しです（回の出ない年が 10 回を超えて続きます）';
}

/** 期間の番号（毎日は日、毎週は 7 日、毎月は月、毎年は年） */
function periodIndex(freq: RuleFreq, date: DateISO): number {
  const { year, month } = parseDate(date);
  if (freq === 'MONTHLY') return year * 12 + (month - 1);
  if (freq === 'YEARLY') return year;
  const days = diffDays('2000-01-01', date);
  return freq === 'WEEKLY' ? Math.floor(days / 7) : days;
}

/**
 * from より前の回を出さなくてよいとき、開始を間隔の倍数の期間だけ送った規則（送らなくてよければ null、
 * COUNT の回を送った範囲で使い切っていれば 'ended'）。from の 1 期間前より前にとどめ、毎月・毎年は期間の初めに
 * 置く（回は期間の中で開始より後だけが出るため）。
 * COUNT の毎日は曜日の一回り（7 期間）ごとに送る: 7 期間に曜日が 1 回ずつ来るので、飛ばす回は「送った一回りの数 ×
 * 曜日の数」。COUNT の毎週は「送った期間の数 × 曜日の数」（最初の週の途中から数えても同じ）。
 * COUNT の毎月・毎年は、飛ばした期間の回の数（期間の種類ごとに rrule で 1 期間だけ数えて覚える）を引く
 */
function rebased(
  rule: RuleParts,
  dtstart: Wall,
  from: Wall,
): { rule: RuleParts; dtstart: Wall } | 'ended' | null {
  const n = rule.interval;
  const step = rule.freq === 'DAILY' && rule.count !== null ? 7 : 1;
  const k =
    Math.floor(
      (periodIndex(rule.freq, from.date) - periodIndex(rule.freq, dtstart.date)) / (n * step),
    ) - 1;
  if (k <= 0) return null;
  const ex = explicitRule(rule, dtstart.date);
  let count = rule.count;
  if (count !== null) {
    if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
      count -= usedByPeriods(rule, ex, dtstart, k);
    } else {
      const weekdays = new Set(ex.byDay.map((d) => d.weekday)).size;
      count -= k * (rule.freq === 'DAILY' && weekdays === 0 ? 7 : weekdays);
    }
    if (count <= 0) return 'ended';
  }
  const { year, month } = parseDate(dtstart.date);
  let date: DateISO;
  if (rule.freq === 'DAILY') date = addDays(dtstart.date, k * n * step);
  else if (rule.freq === 'WEEKLY') date = addDays(dtstart.date, k * n * 7);
  else if (rule.freq === 'MONTHLY') {
    const at = year * 12 + (month - 1) + k * n;
    date = `${Math.floor(at / 12)}-${pad2((at % 12) + 1)}-01`;
  } else date = `${year + k * n}-01-01`;
  return { rule: { ...ex, count }, dtstart: { date, time: dtstart.time } };
}

/**
 * [from, to) に始まる回の開始（壁時計）。最大 limit 回で打ち切る（§11）。
 * dtstart は予定の開始（終日は '00:00'）。回がほとんど出ない規則（保存では拒む。§24 D39）は展開しない
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
  if (!denseEnough(rule, dtstart)) return [];
  const moved = rebased(rule, dtstart, from);
  if (moved === 'ended') return [];
  const base = moved ?? { rule, dtstart };
  const out: Wall[] = [];
  let last = Number.NaN;
  toRRule(base.rule, base.dtstart).between(fromD, toD, true, (d) => {
    if (d.getTime() >= toD.getTime()) return false;
    // BYSETPOS の位置が同じ日を指すと rrule は同じ日時を続けて 2 回出す。同じ回は 1 回にする
    if (d.getTime() === last) return true;
    last = d.getTime();
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

/** さかのぼる期間の数（回の出ない期間が続いてよい数＋2。毎日は曜日の一回り、毎週は 2 週） */
const LOOKBACK_PERIODS: Record<RuleFreq, number> = {
  DAILY: 8,
  WEEKLY: 2,
  MONTHLY: MAX_EMPTY_PERIODS.MONTHLY + 2,
  YEARLY: MAX_EMPTY_PERIODS.YEARLY + 2,
};

/** rid の直前の回（なければ null＝rid が初回）。直前の回は数期間さかのぼれば見つかるので、そこから展開する */
export function previousStart(rule: RuleParts, dtstart: Wall, rid: Wall): Wall | null {
  const span = LOOKBACK_PERIODS[rule.freq] * rule.interval;
  const { year, month } = parseDate(rid.date);
  let back: DateISO;
  if (rule.freq === 'DAILY') back = addDays(rid.date, -span);
  else if (rule.freq === 'WEEKLY') back = addDays(rid.date, -span * 7);
  else if (rule.freq === 'MONTHLY') {
    const at = Math.max(1900 * 12, year * 12 + (month - 1) - span);
    back = `${Math.floor(at / 12)}-${pad2((at % 12) + 1)}-01`;
  } else back = `${Math.max(1900, year - span)}-01-01`;
  // 送った規則は、送った開始より後の回が元の規則と同じ。その中に直前の回があればそれが答え
  const base = denseEnough(rule, dtstart)
    ? rebased(rule, dtstart, { date: back, time: '00:00' })
    : null;
  if (base && base !== 'ended') {
    const near = toRRule(base.rule, base.dtstart).before(toFloating(rid), false);
    if (near) return fromFloating(near);
  }
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
  // WKST は画面で作れない（書く画面を通すと落ちて規則が変わるので「カスタム」にする）
  if (extra > 0 || rule.wkst !== null) return null;
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
 * 「すべて」「これ以降」で回の日付を from から to へ動かしたときの規則（§11・§24 D34）。
 * - 毎週: 曜日を同じ日数だけずらす
 * - 毎月の日付: 動かした先の日にする（月末（-1）の規則で、動かした先も月末なら月末のまま）
 * - 毎月の第 n 曜日: 動かした先の曜日と第 n にする（最終（-1）の規則で、先も最後の 7 日なら最終のまま）。
 *   複数の第 n（第2・第4）で第 n が変わるとき・毎月の規則で月をまたいで動かすときは決められないので null
 * - 毎日・毎年・画面で作れない形はそのまま（開始が動くだけ）
 * 動かした先がずらした規則の回にならないとき（呼び出し側で isOccurrenceOf で確かめる）は保存しない
 */
export function shiftRule(rule: RuleParts, from: DateISO, to: DateISO): RuleParts | null {
  const deltaDays = diffDays(from, to);
  if (deltaDays === 0) return rule;
  const kind = uiKind(rule);
  if (!kind) return rule;
  const { year, month, day } = parseDate(to);
  const last = daysInMonth(year, month);
  // 毎月の規則で月をまたいで動かすと、どの月の回をどこへ動かしたのかが決まらない
  const monthly = kind.kind === 'monthlyByDate' || kind.kind === 'monthlyByWeekday';
  if (monthly && from.slice(0, 7) !== to.slice(0, 7)) return null;
  if (kind.kind === 'weekly') {
    const shift = (w: Weekday) => ((((w + deltaDays) % 7) + 7) % 7) as Weekday;
    return { ...rule, byDay: rule.byDay.map((d) => ({ ...d, weekday: shift(d.weekday) })) };
  }
  if (kind.kind === 'monthlyByDate') {
    return { ...rule, byMonthDay: [kind.day === -1 && day === last ? -1 : day] };
  }
  if (kind.kind === 'monthlyByWeekday') {
    const weekday = weekdayOf(to);
    const nthTo = Math.ceil(day / 7);
    const inLastWeek = day + 7 > last;
    if (kind.nth.length === 1) {
      const nth = kind.nth[0] === -1 && inLastWeek ? -1 : nthTo;
      return { ...rule, byDay: [{ weekday, nth }] };
    }
    const nthFrom = Math.ceil(parseDate(from).day / 7);
    if (nthFrom !== nthTo) return null;
    return { ...rule, byDay: rule.byDay.map((d) => ({ ...d, weekday })) };
  }
  return rule;
}

/** 毎月の日付・第 n 曜日の規則か（「すべて」で日付を動かすと、開始をその月の回に置き直す） */
export function isMonthlyAnchored(rule: RuleParts): boolean {
  const kind = uiKind(rule);
  return kind?.kind === 'monthlyByDate' || kind?.kind === 'monthlyByWeekday';
}

/** 毎月の規則で、date の月（なければその後 12 か月のうち）の最初の回の日付 */
export function monthlyAnchor(rule: RuleParts, date: DateISO): DateISO | null {
  const first = `${date.slice(0, 7)}-01`;
  const open: RuleParts = { ...rule, count: null, until: null };
  const found = ruleStarts(
    open,
    { date: first, time: '00:00' },
    { date: first, time: '00:00' },
    { date: addDays(first, 400), time: '00:00' },
    1,
  );
  return found[0]?.date ?? null;
}

/**
 * 暗に決まる指定（毎週の曜日・毎月の日・毎年の月日は、書いていなければ開始から決まる）を書き足した規則。
 * 書き方が違っても回が同じ規則を、同じ文字列にして比べるために使う
 */
function withImplicit(rule: RuleParts, dtstartDate: DateISO): RuleParts {
  const { month, day } = parseDate(dtstartDate);
  const none =
    rule.byDay.length +
      rule.byMonthDay.length +
      rule.byMonth.length +
      rule.byYearDay.length +
      rule.byWeekNo.length ===
    0;
  if (rule.freq === 'WEEKLY' && rule.byDay.length === 0) {
    return { ...rule, byDay: [{ weekday: weekdayOf(dtstartDate), nth: null }] };
  }
  if (rule.freq === 'MONTHLY' && rule.byDay.length === 0 && rule.byMonthDay.length === 0) {
    return { ...rule, byMonthDay: [day] };
  }
  if (rule.freq === 'YEARLY' && none) return { ...rule, byMonth: [month], byMonthDay: [day] };
  return rule;
}

/**
 * 2 つの RRULE が同じ回を作るか（書き方・並びの違いは同じとみなす）。ignoreEnd なら COUNT・UNTIL を比べない
 */
export function sameRule(
  a: string | null,
  b: string | null,
  dtstartDate: DateISO,
  ignoreEnd = false,
): boolean {
  if (a === null || b === null) return a === b;
  const pa = parseRrule(a);
  const pb = parseRrule(b);
  if (!pa.ok || !pb.ok) return a === b;
  const canon = (r: RuleParts) =>
    formatRrule({
      ...withImplicit(r, dtstartDate),
      ...(ignoreEnd ? { count: null, until: null } : {}),
    });
  return canon(pa.rule) === canon(pb.rule);
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
