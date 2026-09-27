/**
 * 繰り返しの編集・削除の範囲（§11）。サーバーの PATCH・DELETE（scope）が使う計算。
 * - この回のみ: 例外行（parent_id＋recurrence_id）／取り消し（親の exdates）
 * - これ以降: 元のシリーズの COUNT を外して UNTIL=前の回。この回を開始とする新シリーズ（元が COUNT なら残りの回数）
 * - すべて: マスターを更新。日時の変更は「選んだ回の元の日時からの差分」をマスターに当てる
 */
import { type EventRecord, type FieldError, fieldsFromChanges } from './events';
import { addDays, diffDays, fromJst, toIsoJst, toJstParts } from './jst';
import {
  countBefore,
  formatRrule,
  isMonthlyAnchored,
  isOccurrenceOf,
  monthlyAnchor,
  parseRrule,
  previousStart,
  type RuleParts,
  recurrenceIdOf,
  sameRule,
  shiftRule,
  untilFor,
  type Wall,
  wallOfRecurrenceId,
} from './recurrence';
import type { EventChanges } from './schemas';

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

type Times = Pick<EventRecord, 'allDay' | 'startAt' | 'endAt' | 'startDate' | 'endDate'>;

export type ShiftResult = Times & { rrule: string | null };

const MOVE_ERROR = 'この日付には繰り返しを動かせません。繰り返しを選び直してください';

/**
 * 「すべて」の日時の変更（§11）: 選んだ回（rid）の元の開始から新しい開始への差分を、マスターの開始・終了に当てる。
 * 終わりは新しい回の長さにする。曜日・日の指定も動かした先に合わせる（shiftRule）。
 * 後の回から開いて時刻を変えても、前の回が消えない。動かした先がずらした規則の回にならなければ error
 */
export function shiftSeries(
  master: EventRecord,
  rid: string,
  occ: Times,
): ShiftResult | { error: string } | null {
  const original = occurrenceFields(master, rid);
  const dtstart = dtstartOf(master);
  if (!original || !dtstart) return null;
  const rule = ruleOf(master);
  const originalDate = original.startDate ?? toJstParts(original.startAt ?? 0).date;
  let out: ShiftResult;
  let movedWall: Wall;
  // 毎月の日付・第 n 曜日は、開始を「元の開始の月の、新しい規則の回」に置き直す（日数の差は月の長さで変わるため）
  const anchor = (shifted: RuleParts | null, fallback: string): string | null =>
    shifted && isMonthlyAnchored(shifted) ? monthlyAnchor(shifted, dtstart.date) : fallback;
  if (occ.allDay) {
    if (!occ.startDate || !occ.endDate) return null;
    const delta = diffDays(originalDate, occ.startDate);
    const shifted = rule ? shiftRule(rule, originalDate, occ.startDate) : null;
    if (rule && !shifted) return { error: MOVE_ERROR };
    const start = anchor(shifted, addDays(dtstart.date, delta));
    if (!start) return { error: MOVE_ERROR };
    out = {
      allDay: true,
      startAt: null,
      endAt: null,
      startDate: start,
      endDate: addDays(start, diffDays(occ.startDate, occ.endDate)),
      rrule: shifted ? formatRrule(shifted) : master.rrule,
    };
    movedWall = { date: occ.startDate, time: '00:00' };
  } else {
    if (occ.startAt === null) return null;
    const originalStart = original.startAt ?? fromJst(original.startDate ?? dtstart.date);
    const deltaMs = occ.startAt - originalStart;
    const masterStart = master.allDay ? fromJst(dtstart.date) : (master.startAt ?? 0);
    const moved = toJstParts(occ.startAt);
    const shifted = rule ? shiftRule(rule, originalDate, moved.date) : null;
    if (rule && !shifted) return { error: MOVE_ERROR };
    const anchored = shifted && isMonthlyAnchored(shifted) ? anchor(shifted, dtstart.date) : null;
    if (shifted && isMonthlyAnchored(shifted) && !anchored) return { error: MOVE_ERROR };
    const startAt = anchored ? fromJst(anchored, moved.time) : masterStart + deltaMs;
    out = {
      allDay: false,
      startAt,
      endAt: occ.endAt === null ? null : startAt + (occ.endAt - occ.startAt),
      startDate: null,
      endDate: null,
      rrule: shifted ? formatRrule(shifted) : master.rrule,
    };
    movedWall = { date: moved.date, time: moved.time };
  }
  // ずらした規則で、新しい開始と動かした回が回になるか（ならなければ保存しない。§24 D34）
  const nextRule = out.rrule ? parseRrule(out.rrule) : null;
  const nextStart = dtstartOf({ ...master, ...out });
  if (nextRule?.ok && nextStart) {
    if (
      !isOccurrenceOf(nextRule.rule, nextStart, nextStart) ||
      !isOccurrenceOf(nextRule.rule, nextStart, movedWall)
    ) {
      return { error: MOVE_ERROR };
    }
  }
  return out;
}

const TIME_KEYS = ['allDay', 'startAt', 'endAt', 'startDate', 'endDate'] as const;

export function hasTimeChange(changes: EventChanges): boolean {
  return TIME_KEYS.some((k) => changes[k] !== undefined);
}

function withoutTimes(changes: EventChanges): EventChanges {
  const out: EventChanges = { ...changes };
  for (const k of TIME_KEYS) delete out[k];
  return out;
}

function sameTimes(a: Times, b: Times): boolean {
  return (
    a.allDay === b.allDay &&
    a.startAt === b.startAt &&
    a.endAt === b.endAt &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate
  );
}

/**
 * 回の今の中身（base。例外行があればそれ）と日時が同じなら、日時の項目を外す（件名だけ直したときに、
 * 例外で動かした日時をシリーズの変更と取り違えないように。§24 D34）
 */
export function dropUnchangedTimes(
  base: EventRecord,
  changes: EventChanges,
): { changes: EventChanges } | { errors: FieldError[] } {
  if (!hasTimeChange(changes)) return { changes };
  const moved = fieldsFromChanges(base, changes);
  if ('errors' in moved) return { errors: moved.errors };
  return { changes: sameTimes(moved.value, base) ? withoutTimes(changes) : changes };
}

/**
 * 「すべて」の変更をマスターの変更にする（§11）。base はその回の今の中身（例外行があればそれ）。
 * 日時は base と違うときだけ変更とし、元の回の日時から新しい日時への差分をマスターに当てる（曜日・日もずらす）
 */
export function allScopeChanges(
  master: EventRecord,
  rid: string,
  base: EventRecord,
  changes: EventChanges,
): { changes: EventChanges } | { errors: FieldError[] } {
  const dropped = dropUnchangedTimes(base, changes);
  if ('errors' in dropped || !hasTimeChange(dropped.changes)) return dropped;
  const original = occurrenceFields(master, rid);
  if (!original) return dropped;
  const moved = fieldsFromChanges({ ...base, ...original }, dropped.changes);
  if ('errors' in moved) return { errors: moved.errors };
  const shifted = shiftSeries(master, rid, moved.value);
  if (!shifted) return dropped;
  if ('error' in shifted) return { errors: [{ field: 'startAt', message: shifted.error }] };
  const out: EventChanges = { ...withoutTimes(dropped.changes), allDay: shifted.allDay };
  if (shifted.allDay) {
    out.startDate = shifted.startDate ?? undefined;
    out.endDate = shifted.endDate ?? undefined;
  } else {
    out.startAt = toIsoJst(shifted.startAt ?? 0);
    out.endAt = shifted.endAt === null ? null : toIsoJst(shifted.endAt);
  }
  if (changes.rrule === undefined && shifted.rrule !== master.rrule) out.rrule = shifted.rrule;
  return { changes: out };
}

/**
 * 「すべて」で変えたあと、例外（この回だけ変更）・取り消しのうち消えるもの（§11・§24 D34）。
 * サーバーのリセットと C-04 の件数（PWA）で同じ計算を使う。
 * - 回の開始（終日か・開始の日時）が変わったら、すべて消える（どの回も recurrenceId が変わるため）
 * - 規則だけが変わったら（終わりの回数・日付を含む）、新しい規則でも回として残るものは残し、残らないものだけ消える
 * - 何も変わらなければ消えない
 */
export function seriesLoss(
  master: EventRecord,
  next: Pick<EventRecord, 'allDay' | 'startAt' | 'startDate' | 'rrule'>,
  exceptionRids: readonly string[],
): { exceptions: string[]; exdates: string[] } {
  const all = { exceptions: [...exceptionRids], exdates: [...master.exdates] };
  if (!master.rrule) return { exceptions: [], exdates: [] };
  const startMoved =
    master.allDay !== next.allDay ||
    master.startAt !== next.startAt ||
    master.startDate !== next.startDate;
  if (startMoved || next.rrule === null) return all;
  const dtstart = dtstartOf(master);
  if (!dtstart) return all;
  if (sameRule(master.rrule, next.rrule, dtstart.date)) return { exceptions: [], exdates: [] };
  const rule = parseRrule(next.rrule);
  if (!rule.ok) return all;
  const survives = (rid: string) => {
    const wall = wallOfRecurrenceId(rid);
    return wall !== null && isOccurrenceOf(rule.rule, dtstart, wall);
  };
  return {
    exceptions: exceptionRids.filter((r) => !survives(r)),
    exdates: master.exdates.filter((r) => !survives(r)),
  };
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
