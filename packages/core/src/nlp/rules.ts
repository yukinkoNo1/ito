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
  found: {
    date: boolean;
    time: boolean;
    members: boolean;
    /** 「内緒」などを書いたか（書いていなければ画面で選んだ公開・非公開を残す。§24 D37） */
    private: boolean;
    /** 繰り返しを書いたか（書いていなければ画面で選んだ繰り返しを残す） */
    recurrence: boolean;
  };
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
/** 今日を指す時間帯（「今夜」「今朝」は今日の夜・朝） */
const TODAY_PERIODS: Record<string, string> = { 今夜: '夜', 今朝: '朝' };
/** 時刻の前に付く語（長いものから。「深夜」を「夜」より先に見る） */
const MODIFIERS = [
  '深夜',
  '夜中',
  '早朝',
  '今朝',
  '今夜',
  '午前',
  '午後',
  '夕方',
  '朝',
  '昼',
  '夜',
] as const;
const MOD = `(${MODIFIERS.join('|')})?`;

/** プロトタイプのキー（toString など）を拾わない */
function own<T extends object>(o: T, key: string): key is Extract<keyof T, string> {
  return Object.hasOwn(o, key);
}

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

/**
 * 時（午前・午後・夜などと、1〜6 時は午後という規則。§16 規則 2）。
 * 夜・深夜の 12 時と 1〜4 時（深夜は 5 時まで）は、その夜の 0〜5 時（late: 日付を書いたときは次の日）
 */
function hourOf(raw: number, modifier: string | undefined): { hour: number; late: boolean } {
  switch (modifier) {
    case '午前':
    case '朝':
    case '早朝':
    case '今朝':
      return { hour: raw === 12 ? 0 : raw, late: false };
    case '午後':
    case '夕方':
      return { hour: raw < 12 ? raw + 12 : raw, late: false };
    case '昼':
      return { hour: raw >= 1 && raw <= 6 ? raw + 12 : raw, late: false };
    case '夜':
    case '今夜':
    case '深夜':
    case '夜中': {
      const early = modifier === '深夜' || modifier === '夜中' ? 5 : 4;
      if (raw === 12 || raw === 24 || raw === 0) return { hour: 0, late: true };
      if (raw <= early) return { hour: raw, late: true };
      return { hour: raw < 12 ? raw + 12 : raw, late: false };
    }
    default:
      return { hour: raw >= 1 && raw <= 6 ? raw + 12 : raw, late: false };
  }
}

/**
 * 終わりの時刻（開始からみて決める）。翌が付けば次の日。修飾語があればそれで決め、開始以前なら次の日。
 * 修飾語がなければ、開始より後になる近いほう（raw か raw+12。「13時〜3時」は 15 時）、どちらも開始以前なら
 * 次の日の raw（「22時〜1時」は翌 1 時）。24 時（ちょうど）は次の日の 0 時
 */
function resolveEnd(
  startMin: number,
  raw: number,
  minute: number,
  modifier: string | undefined,
  next: boolean,
): { min: number; next: boolean } | null {
  if (minute > 59) return null;
  if (raw === 24 && minute === 0) return { min: 0, next: true };
  if (raw > 23) return null;
  if (next) {
    const pm =
      modifier === '午後' || modifier === '夕方' || modifier === '夜' || modifier === '今夜';
    return { min: (pm && raw < 12 ? raw + 12 : raw) * 60 + minute, next: true };
  }
  if (modifier) {
    const min = hourOf(raw, modifier).hour * 60 + minute;
    return { min, next: min <= startMin };
  }
  for (const h of raw < 12 ? [raw, raw + 12] : [raw]) {
    const min = h * 60 + minute;
    if (min > startMin) return { min, next: false };
  }
  return { min: raw * 60 + minute, next: true };
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
  /** 夜の 0〜5 時（書いた日の夜＝次の日の朝） */
  late: boolean;
  /** 日付に添えた曜日（「10/3(土)」）。日付と合わなければ聞く */
  statedWeekday: Weekday | null;
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
    late: false,
    statedWeekday: null,
  };
  const ambiguities: NlpAmbiguity[] = [];
  /** 見つけた語を空白に置き換える。fn が false を返したら置き換えない */
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | undefined): void => {
    const m = re.exec(s);
    if (!m) return;
    if (fn(m) === false) return;
    s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
  };
  const days = (text: string): Weekday[] =>
    [...text].flatMap((c) => (own(WD, c) ? [WD[c] as Weekday] : []));
  // 日付・曜日のあとの助詞（「明日の10時」「土曜は」）も一緒に取る
  const PARTICLE = '(?:の|は|に)?';
  // 曜日の並び（「月木」「火曜・金曜」「月曜と木曜」「土曜 日曜」）。曜日の字のあとは曜・次の曜日・区切り・空白・数字だけ
  // （「金魚」の「金」を曜日にしない）
  const WEEKDAY_LIST =
    '((?:[日月火水木金土](?:曜日|曜|(?=[日月火水木金土・,、と\\s\\d]|$))(?:\\s*[・,、と]\\s*|\\s+)?)+)';

  /* ── 繰り返し ── */
  take(new RegExp(`毎週\\s*${WEEKDAY_LIST}`), (m) => {
    const wds = days(m[1] as string);
    if (wds.length === 0) return false;
    f.recurrence = { kind: 'weekly', interval: 1, weekdays: sortWeekdays(wds) };
  });
  take(new RegExp(`隔週\\s*${WEEKDAY_LIST}`), (m) => {
    const wds = days(m[1] as string);
    if (wds.length === 0) return false;
    f.recurrence = { kind: 'weekly', interval: 2, weekdays: sortWeekdays(wds) };
  });
  // 第n曜日（「第2・第4水曜」「第2・4水曜」「最終金曜」）
  take(
    /(?:毎月\s*)?((?:第\s*[1-5]|最終)(?:\s*[・,、と]\s*(?:第\s*)?(?:[1-5]|最終))*)\s*の?\s*([日月火水木金土])曜日?/,
    (m) => {
      const nth = [
        ...new Set(
          [...(m[1] as string).matchAll(/[1-5]|最終/g)].map((x) =>
            x[0] === '最終' ? -1 : Number(x[0]),
          ),
        ),
      ].sort((a, b) => (a === -1 ? 1 : b === -1 ? -1 : a - b));
      f.recurrence = { kind: 'monthlyByWeekday', nth, weekday: WD[m[2] as string] as Weekday };
    },
  );
  take(/毎月\s*(?:(\d{1,2})日|末)/, (m) => {
    const day = m[1] ? Number(m[1]) : -1;
    if (day !== -1 && (day < 1 || day > 31)) return false;
    f.recurrence = { kind: 'monthlyByDate', day };
  });
  take(/毎年/, () => {
    f.recurrence = { kind: 'yearly' };
    f.yearly = true;
  });
  take(/毎日/, () => {
    f.recurrence = { kind: 'daily', interval: 1 };
  });
  // 毎朝・毎晩は毎日。時間帯の語を残して、あとの時刻の修飾語にする（「毎晩9時」は 21 時）
  if (f.recurrence.kind === 'none') {
    const m = /毎(朝|晩|夜)/.exec(s);
    if (m) {
      f.recurrence = { kind: 'daily', interval: 1 };
      s = `${s.slice(0, m.index)} ${m[1] === '朝' ? '朝' : '夜'} ${s.slice(m.index + m[0].length)}`;
    }
  }

  /* ── 日付 ── */
  const relDay = (w: string): DateISO =>
    w === '今日' ? today : w === '明日' ? addDays(today, 1) : addDays(today, 2);
  // 日付に添えた曜日（「10/3(土)」）
  const WD_SUFFIX = '(?:\\s*\\(([日月火水木金土])\\))?';
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
    take(new RegExp(`(\\d{1,2})/(\\d{1,2})(?!\\d)${WD_SUFFIX}${PARTICLE}`), (m) => {
      const r = resolveMonthDay(Number(m[1]), Number(m[2]), today);
      if (!r) return false;
      f.date = r.date;
      f.dateAlt = f.yearly ? null : r.alt;
      if (m[3]) f.statedWeekday = WD[m[3]] as Weekday;
    });
  }
  if (!f.date) {
    take(new RegExp(`(\\d{1,2})月(\\d{1,2})日${WD_SUFFIX}${PARTICLE}`), (m) => {
      const r = resolveMonthDay(Number(m[1]), Number(m[2]), today);
      if (!r) return false;
      f.date = r.date;
      f.dateAlt = f.yearly ? null : r.alt;
      if (m[3]) f.statedWeekday = WD[m[3]] as Weekday;
    });
  }
  if (!f.date) {
    take(new RegExp(`(今日|明日|あさって|明後日)${PARTICLE}`), (m) => {
      f.date = relDay(m[1] as string);
    });
  }
  if (!f.date) {
    take(new RegExp(`(今週|来週|再来週)の?([日月火水木金土])曜日?${PARTICLE}`), (m) => {
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
    take(new RegExp(`([日月火水木金土])曜日?${PARTICLE}`), (m) => {
      f.bareWeekday = WD[m[1] as string] as Weekday;
    });
  }

  /* ── 時刻 ── */
  const setStart = (raw: number, minute: number, modifier: string | undefined): boolean => {
    const { hour, late } = hourOf(raw, modifier);
    if (hour > 23 || minute > 59) return false;
    f.startMin = hour * 60 + minute;
    f.late = late;
    if (modifier && own(TODAY_PERIODS, modifier) && f.date === null && f.bareWeekday === null)
      f.date = today;
    return true;
  };
  const setEnd = (end: { min: number; next: boolean } | null): boolean => {
    if (!end) return false;
    f.endMin = end.min;
    f.endNextDay = end.next;
    return true;
  };
  // 「19〜20時」「22〜翌1時」（始まりに「時」がない。「9:00〜」の分の数字を拾わない）
  take(/(?<![\d:])(\d{1,2})\s*[〜-]\s*(翌)?\s*(\d{1,2})時(半)?(?![間\d])/, (m) => {
    const { hour, late } = hourOf(Number(m[1]), undefined);
    if (hour > 23) return false;
    const end = resolveEnd(hour * 60, Number(m[3]), m[4] ? 30 : 0, undefined, m[2] === '翌');
    if (!end) return false;
    f.startMin = hour * 60;
    f.late = late;
    setEnd(end);
  });
  const clock = '(?<![\\d:])(\\d{1,2})(?::(\\d{2})|時(?:(半)|(\\d{1,2})分)?)';
  const minuteOf = (mm?: string, half?: string, mins?: string) =>
    mm ? Number(mm) : half ? 30 : mins ? Number(mins) : 0;
  if (f.startMin === null) {
    // 始まり（午前・午後・夜などと時刻。あいだの空白もよい）と終わり。「から2時間」を「から2時」より先に見る。
    // 終わりのない「19時〜」「19時から」の〜・からも取る
    const re = new RegExp(
      `${MOD}\\s*${clock}(?:から(\\d{1,2})時間(半)?|\\s*(?:[-〜]|から)\\s*(翌)?\\s*${MOD}\\s*${clock}(?:まで)?|\\s*(?:〜|から)(?!\\s*(?:翌|\\d)))?`,
    );
    take(re, (m) => {
      const [, smod, sh, smm, shalf, smin, dur, dhalf, next, emod, eh, emm, ehalf, emin] = m;
      const startMinute = minuteOf(smm, shalf, smin);
      const { hour } = hourOf(Number(sh), smod);
      if (hour > 23 || startMinute > 59) return false;
      const startAt = hour * 60 + startMinute;
      let end: { min: number; next: boolean } | null = null;
      if (dur !== undefined) {
        const endAt = startAt + Number(dur) * 60 + (dhalf ? 30 : 0);
        end = { min: endAt % 1440, next: endAt >= 1440 };
      } else if (eh !== undefined) {
        end = resolveEnd(startAt, Number(eh), minuteOf(emm, ehalf, emin), emod, next === '翌');
        // 終わりが読めない（25時など）なら、この形では取らない（始まりだけを下で取り直す）
        if (!end) return false;
      }
      setStart(Number(sh), startMinute, smod);
      if (end) setEnd(end);
    });
  }
  if (f.startMin === null) {
    take(new RegExp(`${MOD}\\s*${clock}`), (m) => {
      const [, smod, sh, smm, shalf, smin] = m;
      return setStart(Number(sh), minuteOf(smm, shalf, smin), smod);
    });
  }
  if (f.startMin !== null && f.endMin === null) {
    // 「〜15時」（離れて書いた終わり）
    take(new RegExp(`〜\\s*(翌)?\\s*${MOD}\\s*(\\d{1,2})(?::(\\d{2})|時(半)?)`), (m) => {
      const end = resolveEnd(
        f.startMin as number,
        Number(m[3]),
        minuteOf(m[4], m[5]),
        m[2],
        m[1] === '翌',
      );
      return setEnd(end);
    });
  }

  /* ── 語（空白で区切った語だけ） ── */
  const words = s.split(' ').filter((w) => w.length > 0);
  const rest: string[] = [];
  const memberIds = new Set<string>();
  let everyone = false;
  let isPrivate = false;
  let location: string | null = null;
  // 人を指す語（呼び名・名前・略称と「みんな」「自分」）。長い順に照合する（「はると」を「はる」より先に）
  const people: { text: string; id: string | 'everyone' }[] = [
    ...ctx.members.flatMap((m) =>
      [m.name, m.mark, ...m.aliases].map((a) => ({ text: a.normalize('NFKC'), id: m.id })),
    ),
    ...[...EVERYONE].map((text) => ({ text, id: 'everyone' as const })),
    ...[...SELF].map((text) => ({ text, id: ctx.writerId })),
  ]
    .filter((a) => a.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length);
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
    // 時間帯の語: 時刻がなければ時刻を聞く（規則 3）。時刻があれば修飾語として使ったので件名に残さない
    const period = own(TODAY_PERIODS, w) ? TODAY_PERIODS[w] : own(PERIODS, w) ? w : null;
    if (period) {
      if (own(TODAY_PERIODS, w) && f.date === null && f.bareWeekday === null) f.date = today;
      if (f.startMin === null && f.period === null) f.period = period;
      continue;
    }
    const who = matchPeople(w, people);
    if (who) {
      for (const id of who) {
        if (id === 'everyone') everyone = true;
        else memberIds.add(id);
      }
      continue;
    }
    rest.push(w);
  }

  /* ── 日付を決める（規則 6・8・9） ── */
  const timed = f.startMin !== null && !f.allDayWord;
  // 書いた日の夜の 0〜5 時（「金曜の深夜2時」）は次の日の朝
  const lateShift = timed && f.late ? 1 : 0;
  let date: DateISO;
  if (f.recurrence.kind !== 'none' && !(f.yearly && f.date)) {
    date = firstOccurrence(
      f.recurrence,
      f.date ?? today,
      timed ? (f.startMin as number) : null,
      today,
      nowMin,
    );
  } else if (f.yearly && f.date) {
    // 毎年: 今日より前（今日で時刻が過ぎた）なら来年の同じ日から（規則 6）
    const past = f.date < today || (f.date === today && timed && (f.startMin as number) <= nowMin);
    date = past ? addMonths(f.date, 12) : f.date;
  } else if (f.date) {
    date = addDays(f.date, lateShift);
    if (f.dateAlt) ambiguities.push(dateAmbiguity(date, addDays(f.dateAlt, lateShift)));
    // 添えた曜日が日付と合わなければ聞く（「10/4(土)」は 10/4 か、その週の土曜か）
    if (f.statedWeekday !== null && f.statedWeekday !== weekdayOf(f.date) && !f.dateAlt) {
      let diff = (f.statedWeekday - weekdayOf(f.date) + 7) % 7;
      if (diff > 3) diff -= 7;
      ambiguities.push(dateAmbiguity(date, addDays(date, diff)));
    }
  } else if (f.bareWeekday !== null && lateShift) {
    const wd = f.bareWeekday;
    date = addDays(today, ((wd - weekdayOf(today) + 7) % 7) + 1);
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
      private: isPrivate,
      recurrence: f.recurrence.kind !== 'none',
    },
  };
}

/**
 * 1 語が人を指すか（「父」「お母さん」「みんなで」「父と母」「さき・はると」）。長い順に照合し、語の全体が
 * 人（と区切り「と・、,」）でできているときだけ。最後の助詞（で・が・は・も・と・に）は、名前が 2 字以上か
 * 2 人以上のときだけ許す（「さも」の「さ」を人にしない）
 */
function matchPeople(
  word: string,
  people: readonly { text: string; id: string }[],
): string[] | null {
  const exact = people.find((p) => p.text === word);
  if (exact) return [exact.id];
  const ids: string[] = [];
  let i = 0;
  while (i < word.length) {
    const p = people.find((c) => word.startsWith(c.text, i));
    if (!p) return null;
    ids.push(p.id);
    i += p.text.length;
    if (i >= word.length) break;
    const rest = word.slice(i);
    if (/^[でがはもとに]$/.test(rest)) {
      if (p.text.length < 2 && ids.length < 2) return null;
      break;
    }
    if (!/^[と・、,]./.test(rest)) return null;
    i += 1;
  }
  return ids;
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
