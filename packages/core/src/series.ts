/**
 * 繰り返しの編集・削除の範囲（§11）。サーバーの PATCH・DELETE（scope）が使う計算。
 * - この回のみ: 例外行（parent_id＋recurrence_id）／取り消し（親の exdates）
 * - これ以降: 元のシリーズの COUNT を外して UNTIL=前の回。この回を開始とする新シリーズ（元が COUNT なら残りの回数）
 * - すべて: マスターを更新。日時の変更は「選んだ回の元の日時からの差分」をマスターに当てる
 */
import type { EventRecord } from './events';
import { addDays, diffDays, fromJst, toJstParts } from './jst';
import {
  countBefore,
  formatRrule,
  isOccurrenceOf,
  parseRrule,
  previousStart,
  type RuleParts,
  recurrenceIdOf,
  shiftRule,
  untilFor,
  type Wall,
  wallOfRecurrenceId,
} from './recurrence';

function ruleOf(master: EventRecord): RuleParts | null {
  if (!master.rrule) return null;
  const r = parseRrule(master.rrule);
  return r.ok ? r.rule : null;
}

/** マスターの開始（壁時計。終日は '00:00'） */
export function dtstartOf(master: EventRecord): Wall | null {
  if (master.allDay) return master.startDate ? { date: master.startDate, time: '00:00' } : null;
  if (master.startAt === null) return null;
  const p = toJstParts(master.startAt);
  return { date: p.date, time: p.time };
}

/** rid がシリーズの回か（取り消した回は false） */
export function isSeriesOccurrence(master: EventRecord, rid: string): boolean {
  const rule = ruleOf(master);
  const dtstart = dtstartOf(master);
  const wall = wallOfRecurrenceId(rid);
  if (!rule || !dtstart || !wall || master.exdates.includes(rid)) return false;
  if ((wall.time !== '00:00' || rid.includes('T')) === master.allDay) return false;
  return isOccurrenceOf(rule, dtstart, wall);
}

/** その回の元の日時に置いた、親の中身（例外行を作るときの元） */
export function occurrenceFields(
  master: EventRecord,
  rid: string,
): Pick<EventRecord, 'allDay' | 'startAt' | 'endAt' | 'startDate' | 'endDate'> | null {
  const wall = wallOfRecurrenceId(rid);
  if (!wall) return null;
  if (master.allDay) {
    if (!master.startDate || !master.endDate) return null;
    const span = diffDays(master.startDate, master.endDate);
    return {
      allDay: true,
      startAt: null,
      endAt: null,
      startDate: wall.date,
      endDate: addDays(wall.date, span),
    };
  }
  if (master.startAt === null) return null;
  const startAt = fromJst(wall.date, wall.time);
  return {
    allDay: false,
    startAt,
    endAt: master.endAt === null ? null : startAt + (master.endAt - master.startAt),
    startDate: null,
    endDate: null,
  };
}

export interface SplitResult {
  /** 元のシリーズの新しい rrule（UNTIL=前の回。COUNT は外す） */
  headRrule: string;
  /** 元のシリーズに残す取り消し（rid より前） */
  headExdates: string[];
  /** 新シリーズの rrule（元が COUNT なら残りの回数） */
  tailRrule: string;
  /** 捨てる取り消し（rid 以降。§11「以降の例外は破棄」） */
  discardedExdates: string[];
}

/** rid 以降の recurrenceId か（同じ形の文字列なので、文字列の順で比べられる） */
export function isAtOrAfter(rid: string, from: string): boolean {
  return rid >= from;
}

/**
 * 「これ以降」の分割。rid が初回なら null（「すべて」と同じ扱い。§11）
 */
export function splitSeries(master: EventRecord, rid: string): SplitResult | null {
  const rule = ruleOf(master);
  const dtstart = dtstartOf(master);
  const wall = wallOfRecurrenceId(rid);
  if (!rule || !dtstart || !wall) return null;
  const prev = previousStart(rule, dtstart, wall);
  if (!prev) return null;
  const head: RuleParts = { ...rule, count: null, until: untilFor(prev.date, master.allDay) };
  const tail: RuleParts = {
    ...rule,
    count: rule.count === null ? null : Math.max(1, rule.count - countBefore(rule, dtstart, wall)),
  };
  return {
    headRrule: formatRrule(head),
    headExdates: master.exdates.filter((d) => !isAtOrAfter(d, rid)),
    tailRrule: formatRrule(tail),
    discardedExdates: master.exdates.filter((d) => isAtOrAfter(d, rid)),
  };
}

/**
 * 「すべて」の日時の変更（§11）: 選んだ回（rid）の元の開始から新しい開始への差分を、マスターの開始・終了に当てる。
 * 終わりは新しい回の長さにする。曜日・日の指定も同じ日数だけずらす（毎週の曜日など）。
 * 後の回から開いて時刻を変えても、前の回が消えない
 */
export function shiftSeries(
  master: EventRecord,
  rid: string,
  occ: Pick<EventRecord, 'allDay' | 'startAt' | 'endAt' | 'startDate' | 'endDate'>,
): Pick<EventRecord, 'allDay' | 'startAt' | 'endAt' | 'startDate' | 'endDate' | 'rrule'> | null {
  const original = occurrenceFields(master, rid);
  const dtstart = dtstartOf(master);
  if (!original || !dtstart) return null;
  const rule = ruleOf(master);
  if (occ.allDay) {
    if (!occ.startDate || !occ.endDate) return null;
    const originalDate = original.startDate ?? toJstParts(original.startAt ?? 0).date;
    const delta = diffDays(originalDate, occ.startDate);
    const start = addDays(dtstart.date, delta);
    return {
      allDay: true,
      startAt: null,
      endAt: null,
      startDate: start,
      endDate: addDays(start, diffDays(occ.startDate, occ.endDate)),
      rrule: rule ? formatRrule(shiftRule(rule, delta)) : master.rrule,
    };
  }
  if (occ.startAt === null) return null;
  const originalStart = original.startAt ?? fromJst(original.startDate ?? dtstart.date);
  const deltaMs = occ.startAt - originalStart;
  const masterStart = master.allDay ? fromJst(dtstart.date) : (master.startAt ?? 0);
  const startAt = masterStart + deltaMs;
  const deltaDays = diffDays(toJstParts(originalStart).date, toJstParts(occ.startAt).date);
  return {
    allDay: false,
    startAt,
    endAt: occ.endAt === null ? null : startAt + (occ.endAt - occ.startAt),
    startDate: null,
    endDate: null,
    rrule: rule ? formatRrule(shiftRule(rule, deltaDays)) : master.rrule,
  };
}

/** 回の開始の日時が変わるか（例外・取り消しをリセットするかの判定。§11） */
export function startsChange(
  master: EventRecord,
  next: Pick<EventRecord, 'allDay' | 'startAt' | 'startDate' | 'rrule'>,
): boolean {
  return (
    master.allDay !== next.allDay ||
    master.startAt !== next.startAt ||
    master.startDate !== next.startDate ||
    master.rrule !== next.rrule
  );
}

/** 回の recurrenceId（例外行の元の回） */
export function recurrenceIdAt(
  master: EventRecord,
  startAt: number | null,
  startDate: string | null,
): string | null {
  if (master.allDay) return startDate;
  if (startAt === null) return null;
  const p = toJstParts(startAt);
  return recurrenceIdOf({ date: p.date, time: p.time }, false);
}
