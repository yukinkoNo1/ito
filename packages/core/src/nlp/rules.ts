import {
  addDays,
  addMonths,
  type DateISO,
  daysInMonth,
  diffDays,
  isValidDate,
  minutesOfTime,
  parseDate,
  startOfWeek,
  type TimeHM,
  timeFromMinutes,
  todayJst,
  toJstParts,
  type Weekday,
  weekdayOf,
} from '../jst';
import type { RecurrencePreset } from '../recurrence';

/**
 * 一言入力のルール解析（SPEC §16。@ito/core/nlp/rules）。オフラインでも動き、AI が使えないときの結果になる。
 * 手順: NFKC 正規化 → 繰り返し → 日付 → 時刻 → 家族 → キーワード（終日・内緒・@場所）→ 残りを件名。
 * 見つけた語は空白に置き換えてから次を探す。人・キーワード・時刻の修飾語（午後・夜など）は空白で区切られた語だけを見る
 * （「夜釣り」の「夜」、「家族旅行」の「家族」を取らない）。曖昧さの規則は §16 の 7〜10 と同じ。期待値は §21 の表
 */

export interface NlpMember {
  id: string;
  name: string;
  mark: string;
  aliases: readonly string[];
}

export interface NlpContext {
  nowMs: number;
  weekStart: 0 | 1;
  /** 書いた人（「自分」「私」も） */
  writerId: string;
  /** 有効な家族（作成順） */
  members: readonly NlpMember[];
}

export interface NlpDraft {
  title: string;
  allDay: boolean;
  startDate: DateISO;
  endDate: DateISO;
  startTime: TimeHM | null;
  endTime: TimeHM | null;
  memberIds: string[];
  forEveryone: boolean;
  location: string | null;
  isPrivate: boolean;
  busy: boolean;
  recurrence: RecurrencePreset;
}

export type NlpAmbiguityField = 'date' | 'time' | 'members' | 'title' | 'recurrence';

/** 曖昧さ（options の value は date なら YYYY-MM-DD、time なら HH:MM か all_day、members なら家族の ID） */
export interface NlpAmbiguity {
  field: NlpAmbiguityField;
  question: string;
  options: { label: string; value: string }[];
}

export interface NlpResult {
  draft: NlpDraft;
  ambiguities: NlpAmbiguity[];
  /**
   * 一言に書いてあったもの（日付・時刻・人）。書いていないものは、書く画面で先に選んでいた日・時刻・人を残す
   * （画面から開いた日を「今日・明日」で上書きしない。§24 D37）
   */
  found: { date: boolean; time: boolean; members: boolean };
}

const WD: Record<string, Weekday> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };
const WD_LABEL = ['日', '月', '火', '水', '木', '金', '土'] as const;
const EVERYONE = new Set(['みんな', '全員', '家族', 'みなさん']);
const SELF = new Set(['自分', '私', 'わたし', '僕', 'ぼく', '俺', 'おれ']);
const PRIVATE = new Set(['内緒', '非公開', 'ひみつ', '秘密', 'ないしょ']);
/** 数字のない時間帯（§16 規則 3: 終日にして時刻を聞く） */
const PERIODS: Record<string, [TimeHM, TimeHM]> = {
  朝: ['07:00', '09:00'],
  午前: ['09:00', '11:00'],
  昼: ['12:00', '13:00'],
  午後: ['13:00', '15:00'],
  夕方: ['17:00', '18:00'],
  夜: ['19:00', '21:00'],
};

function md(date: DateISO): string {
  const { month, day } = parseDate(date);
  return `${month}/${day}(${WD_LABEL[weekdayOf(date)]})`;
}

function dateOption(date: DateISO): { label: string; value: string } {
  return { label: md(date), value: date };
}

/** 年を補った日付（§16 規則 10: 今日より前で 30 日以内なら今年＋来年を選べる、それより前なら来年） */
function resolveMonthDay(
  month: number,
  day: number,
  today: DateISO,
): { date: DateISO; alt: DateISO | null } | null {
  const year = parseDate(today).year;
  const make = (y: number) =>
    `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const thisYear = make(year);
  if (!isValidDate(thisYear) && !isValidDate(make(year + 1))) return null;
  if (isValidDate(thisYear) && thisYear >= today) return { date: thisYear, alt: null };
  const next = make(year + 1);
  if (isValidDate(thisYear) && diffDays(thisYear, today) <= 30) {
    return { date: thisYear, alt: isValidDate(next) ? next : null };
  }
  return isValidDate(next) ? { date: next, alt: null } : null;
}

/** 時（午前・午後・夜などと、1〜6 時は午後という規則。§16 規則 2） */
function hourOf(raw: number, modifier: string | undefined): number {
  if (modifier === '午前' || modifier === '朝') return raw % 12 === 0 && raw === 12 ? 0 : raw;
  if (modifier === '午後' || modifier === '夜' || modifier === '夕方')
    return raw < 12 ? raw + 12 : raw;
  if (raw >= 1 && raw <= 6) return raw + 12;
  return raw;
}

interface Found {
  /** 日付（なければ null。規則 9 で決める） */
  date: DateISO | null;
  dateAlt: DateISO | null;
  endDate: DateISO | null;
  /** 曜日だけ（今日と同じ曜日なら時刻で決める。規則 8） */
  bareWeekday: Weekday | null;
  startMin: number | null;
  endMin: number | null;
  /** 終わりが翌日 */
  endNextDay: boolean;
  allDayWord: boolean;
  period: string | null;
  recurrence: RecurrencePreset;
  /** 繰り返しの日付の条件（最初の回を探す） */
  yearly: boolean;
}

export function parseRules(input: string, ctx: NlpContext): NlpResult {
  let s = ` ${input
    .normalize('NFKC')
    .replace(/[～~〜]/g, '〜')
    .replace(/\s+/g, ' ')
    .trim()} `;
  const today = todayJst(ctx.nowMs);
  const nowMin = minutesOfTime(toJstParts(ctx.nowMs).time);
  const f: Found = {
    date: null,
    dateAlt: null,
    endDate: null,
    bareWeekday: null,
    startMin: null,
    endMin: null,
    endNextDay: false,
    allDayWord: false,
    period: null,
    recurrence: { kind: 'none' },
    yearly: false,
  };
  const ambiguities: NlpAmbiguity[] = [];
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | undefined): void => {
    const m = re.exec(s);
    if (!m) return;
    if (fn(m) === false) return;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
  };
  const days = (text: string): Weekday[] =>
    [...text].flatMap((c) => (c in WD ? [WD[c] as Weekday] : []));

  /* ── 繰り返し ── */
  take(/毎週([日月火水木金土・,、]+?)(?:曜日|曜)?(?=[\s\d]|$)/, (m) => {
    const wds = days(m[1] as string);
    if (wds.length === 0) return false;
    f.recurrence = { kind: 'weekly', interval: 1, weekdays: sortWeekdays(wds) };
  });
  take(/隔週([日月火水木金土・,、]+?)(?:曜日|曜)?(?=[\s\d]|$)/, (m) => {
    const wds = days(m[1] as string);
    if (wds.length === 0) return false;
    f.recurrence = { kind: 'weekly', interval: 2, weekdays: sortWeekdays(wds) };
  });
  take(/(?:毎月)?((?:(?:第[1-5]|最終)[・,、]?)+)([日月火水木金土])曜日?/, (m) => {
    const nth = [...(m[1] as string).matchAll(/第([1-5])|最終/g)].map((x) =>
      x[1] ? Number(x[1]) : -1,
    );
    f.recurrence = { kind: 'monthlyByWeekday', nth, weekday: WD[m[2] as string] as Weekday };
  });
  take(/毎月(?:(\d{1,2})日|末)/, (m) => {
    f.recurrence = { kind: 'monthlyByDate', day: m[1] ? Number(m[1]) : -1 };
  });
  take(/毎年/, () => {
    f.recurrence = { kind: 'yearly' };
    f.yearly = true;
  });
  take(/毎日/, () => {
    f.recurrence = { kind: 'daily', interval: 1 };
  });

  /* ── 日付 ── */
  const relDay = (w: string): DateISO =>
    w === '今日' ? today : w === '明日' ? addDays(today, 1) : addDays(today, 2);
  take(/(\d{1,2})\/(\d{1,2})\s*[-〜]\s*(\d{1,2})\/(\d{1,2})/, (m) => {
    const a = resolveMonthDay(Number(m[1]), Number(m[2]), today);
    const b = resolveMonthDay(Number(m[3]), Number(m[4]), a?.date ?? today);
    if (!a || !b) return false;
    f.date = a.date;
    f.endDate = b.date;
  });
  if (!f.date) {
    take(/(\d{1,2})月(\d{1,2})日\s*(?:から|[-〜])\s*(?:(\d{1,2})月)?(\d{1,2})日(?:まで)?/, (m) => {
      const a = resolveMonthDay(Number(m[1]), Number(m[2]), today);
      const b = resolveMonthDay(Number(m[3] ?? m[1]), Number(m[4]), a?.date ?? today);
      if (!a || !b) return false;
      f.date = a.date;
      f.endDate = b.date;
    });
  }
  if (!f.date) {
    take(/(今日|明日|あさって|明後日)から(\d{1,2})日間/, (m) => {
      const n = Number(m[2]);
      if (n < 1) return false;
      f.date = relDay(m[1] as string);
      f.endDate = addDays(f.date, n - 1);
    });
  }
  if (!f.date) {
    take(/(今月|来月|再来月)(\d{1,2})日/, (m) => {
      const shift = m[1] === '今月' ? 0 : m[1] === '来月' ? 1 : 2;
      const base = addMonths(`${today.slice(0, 7)}-01`, shift);
      const { year, month } = parseDate(base);
      const day = Number(m[2]);
      if (day < 1 || day > daysInMonth(year, month)) return false;
      f.date = `${base.slice(0, 8)}${String(day).padStart(2, '0')}`;
    });
  }
  if (!f.date) {
    take(/(\d{1,2})\/(\d{1,2})(?!\d)/, (m) => {
      const r = resolveMonthDay(Number(m[1]), Number(m[2]), today);
      if (!r) return false;
      f.date = r.date;
      f.dateAlt = f.yearly ? null : r.alt;
    });
  }
  if (!f.date) {
    take(/(\d{1,2})月(\d{1,2})日/, (m) => {
      const r = resolveMonthDay(Number(m[1]), Number(m[2]), today);
      if (!r) return false;
      f.date = r.date;
      f.dateAlt = f.yearly ? null : r.alt;
    });
  }
  if (!f.date) {
    take(/(今日|明日|あさって|明後日)/, (m) => {
      f.date = relDay(m[1] as string);
    });
  }
  if (!f.date) {
    take(/(今週|来週|再来週)の?([日月火水木金土])曜日?/, (m) => {
      const weeks = m[1] === '今週' ? 0 : m[1] === '来週' ? 1 : 2;
      const wd = WD[m[2] as string] as Weekday;
      const at = (start: 0 | 1) =>
        addDays(startOfWeek(today, start), weeks * 7 + ((wd - start + 7) % 7));
      const mine = at(ctx.weekStart);
      const other = at(ctx.weekStart === 0 ? 1 : 0);
      // 規則 7: 設定どおりの日が今日より前なら、もう一方の日を使う。違う日で今日以降なら選べるようにする
      if (mine < today) {
        f.date = other;
      } else {
        f.date = mine;
        if (other !== mine && other >= today) f.dateAlt = other;
      }
    });
  }
  if (!f.date && f.recurrence.kind === 'none') {
    take(/([日月火水木金土])曜日?/, (m) => {
      f.bareWeekday = WD[m[1] as string] as Weekday;
    });
  }

  /* ── 時刻 ── */
  // 「19〜20時」（始まりに「時」がない）
  take(/(\d{1,2})\s*[〜-]\s*(\d{1,2})時/, (m) => {
    const a = hourOf(Number(m[1]), undefined);
    const b = hourOf(Number(m[2]), undefined);
    if (a > 23 || b > 23) return false;
    f.startMin = a * 60;
    setEnd(f, b * 60, false);
  });
  if (f.startMin === null) {
    // 始まり（午前・午後などと時刻）と終わり。「から2時間」を「から2時」より先に見る
    const mod = '(午前|午後|朝|夜|夕方)?';
    const clock = '(\\d{1,2})(?::(\\d{2})|時(?:(半)|(\\d{1,2})分)?)';
    const re = new RegExp(
      `${mod}${clock}(?:から(\\d{1,2})時間(半)?|\\s*(?:[-〜]|から)\\s*(翌)?${mod}${clock}(?:まで)?)?`,
    );
    take(re, (m) => {
      const [, smod, sh, smm, shalf, smin, dur, dhalf, next, emod, eh, emm, ehalf, emin] = m;
      const h = hourOf(Number(sh), smod);
      const min = smm ? Number(smm) : shalf ? 30 : smin ? Number(smin) : 0;
      if (h > 23 || min > 59) return false;
      f.startMin = h * 60 + min;
      if (dur !== undefined) {
        const endAt = f.startMin + Number(dur) * 60 + (dhalf ? 30 : 0);
        f.endMin = endAt % 1440;
        f.endNextDay = endAt >= 1440;
      } else if (eh !== undefined) {
        const isNext = next === '翌';
        const raw = Number(eh);
        const hour = isNext
          ? emod === '午後' || emod === '夜'
            ? raw + 12
            : raw
          : hourOf(raw, emod);
        const em = emm ? Number(emm) : ehalf ? 30 : emin ? Number(emin) : 0;
        if (hour > 23 || em > 59) return false;
        setEnd(f, hour * 60 + em, isNext);
      }
    });
  }
  if (f.startMin !== null && f.endMin === null) {
    // 「〜15時」（離れて書いた終わり）
    take(/〜\s*(翌)?(\d{1,2})(?::(\d{2})|時(半)?)/, (m) => {
      const next = m[1] === '翌';
      const raw = Number(m[2]);
      const eh = next ? raw : hourOf(raw, undefined);
      const em = m[3] ? Number(m[3]) : m[4] ? 30 : 0;
      if (eh > 23 || em > 59) return false;
      setEnd(f, eh * 60 + em, next);
    });
  }

  /* ── 語（空白で区切った語だけ） ── */
  const words = s.split(' ').filter((w) => w.length > 0);
  const rest: string[] = [];
  const memberIds = new Set<string>();
  let everyone = false;
  let isPrivate = false;
  let location: string | null = null;
  const aliasList = ctx.members
    .flatMap((m) =>
      [m.name, m.mark, ...m.aliases].map((a) => ({ alias: a.normalize('NFKC'), id: m.id })),
    )
    .filter((a) => a.alias.length > 0)
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const w of words) {
    if (w.startsWith('@') && w.length > 1) {
      location = w.slice(1);
      continue;
    }
    if (w === '終日') {
      f.allDayWord = true;
      continue;
    }
    if (PRIVATE.has(w)) {
      isPrivate = true;
      continue;
    }
    if (EVERYONE.has(w)) {
      everyone = true;
      continue;
    }
    if (SELF.has(w)) {
      memberIds.add(ctx.writerId);
      continue;
    }
    if (f.startMin === null && w in PERIODS && f.period === null) {
      f.period = w;
      continue;
    }
    const member = aliasList.find((a) => a.alias === w);
    if (member) {
      memberIds.add(member.id);
      continue;
    }
    rest.push(w);
  }

  /* ── 日付を決める（規則 6・8・9） ── */
  const timed = f.startMin !== null && !f.allDayWord;
  let date: DateISO;
  if (f.recurrence.kind !== 'none' && !(f.yearly && f.date)) {
    date = firstOccurrence(
      f.recurrence,
      f.date ?? today,
      timed ? (f.startMin as number) : null,
      today,
      nowMin,
    );
  } else if (f.date) {
    date = f.date;
    if (f.dateAlt) ambiguities.push(dateAmbiguity(date, f.dateAlt));
  } else if (f.bareWeekday !== null) {
    const wd = f.bareWeekday;
    if (wd === weekdayOf(today)) {
      if (!timed || (f.startMin as number) > nowMin) {
        date = today;
        ambiguities.push(dateAmbiguity(today, addDays(today, 7)));
      } else {
        date = addDays(today, 7);
      }
    } else {
      date = addDays(today, (wd - weekdayOf(today) + 7) % 7);
    }
  } else {
    // 日付がまったくない: 時刻が今より後なら今日、そうでなければ明日。どちらかを聞く
    const later = !timed || (f.startMin as number) > nowMin;
    date = later ? today : addDays(today, 1);
    ambiguities.push(dateAmbiguity(date, later ? addDays(today, 1) : today));
  }

  /* ── 時間帯だけ（規則 3） ── */
  if (!timed && f.period && !f.allDayWord) {
    const [a, b] = PERIODS[f.period] as [TimeHM, TimeHM];
    ambiguities.push({
      field: 'time',
      question: `「${f.period}」は何時から？`,
      options: [
        { label: a.replace(/^0/, ''), value: a },
        { label: b.replace(/^0/, ''), value: b },
        { label: '終日のまま', value: 'all_day' },
      ],
    });
  }

  const startTime = timed ? timeFromMinutes(f.startMin as number) : null;
  const endTime = timed && f.endMin !== null ? timeFromMinutes(f.endMin) : null;
  let endDate: DateISO;
  if (timed) {
    endDate = endTime !== null && f.endNextDay ? addDays(date, 1) : date;
  } else {
    endDate = f.endDate && f.endDate >= date ? f.endDate : date;
  }
  const forEveryone = everyone && !isPrivate;
  const members = isPrivate
    ? [ctx.writerId]
    : forEveryone
      ? []
      : memberIds.size > 0
        ? ctx.members.filter((m) => memberIds.has(m.id)).map((m) => m.id)
        : [ctx.writerId];

  return {
    draft: {
      title: rest.join(' ').trim(),
      allDay: !timed,
      startDate: date,
      endDate,
      startTime,
      endTime,
      memberIds: members,
      forEveryone,
      location,
      isPrivate,
      // §10 の既定: 時刻あり＝予定あり、1 日の終日＝なし、複数日の終日＝あり
      busy: timed ? true : endDate !== date,
      recurrence: f.recurrence,
    },
    ambiguities,
    found: {
      date: f.date !== null || f.bareWeekday !== null || f.recurrence.kind !== 'none',
      time: f.startMin !== null || f.allDayWord || f.period !== null,
      members: memberIds.size > 0 || everyone || isPrivate,
    },
  };
}

function setEnd(f: Found, endMin: number, next: boolean): void {
  if (f.startMin === null) return;
  let e = endMin;
  let nextDay = next;
  if (!next && e <= f.startMin) {
    // 「13時〜3時」は 15 時、それでも前なら翌日
    if (e + 720 > f.startMin && e + 720 < 1440 && e < 720) e += 720;
    else nextDay = true;
  }
  f.endMin = e;
  f.endNextDay = nextDay;
}

function sortWeekdays(wds: Weekday[]): Weekday[] {
  const order: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((w) => wds.includes(w));
}

function dateAmbiguity(date: DateISO, alt: DateISO): NlpAmbiguity {
  return {
    field: 'date',
    question: 'どの日ですか？',
    options: [dateOption(date), dateOption(alt)],
  };
}

/** 繰り返しの最初の回（今日以降。時刻ありで今日の回の時刻が過ぎていれば次の回。§16 規則 6） */
function firstOccurrence(
  r: RecurrencePreset,
  from: DateISO,
  startMin: number | null,
  today: DateISO,
  nowMin: number,
): DateISO {
  for (let i = 0; i < 400; i++) {
    const d = addDays(from, i);
    if (d === today && startMin !== null && startMin <= nowMin) continue;
    if (matches(r, d)) return d;
  }
  return from;
}

function matches(r: RecurrencePreset, d: DateISO): boolean {
  const { year, month, day } = parseDate(d);
  switch (r.kind) {
    case 'daily':
      return true;
    case 'weekly':
      return r.weekdays.includes(weekdayOf(d));
    case 'monthlyByDate':
      return r.day === -1 ? day === daysInMonth(year, month) : day === r.day;
    case 'monthlyByWeekday': {
      if (weekdayOf(d) !== r.weekday) return false;
      const nth = Math.ceil(day / 7);
      const last = day + 7 > daysInMonth(year, month);
      return r.nth.includes(nth) || (last && r.nth.includes(-1));
    }
    default:
      return true;
  }
}
