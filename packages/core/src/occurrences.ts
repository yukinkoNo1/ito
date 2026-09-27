import { addDays, type DateISO, fromJst, parseIsoToMs, type TimeHM, toJstParts } from './jst';
import { MAX_OCCURRENCES_PER_EXPAND, parseRrule, recurrenceIdOf, ruleStarts } from './recurrence';

/** 展開に使う予定の項目（EventDTO の一部。サーバーも PWA も EventDTO で渡す） */
export interface OccurrenceSource {
  id: string;
  allDay: boolean;
  startAt?: string | undefined;
  endAt?: string | null | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  rrule: string | null;
  exdates: string[];
  parentId: string | null;
  recurrenceId: string | null;
}

/** 表示単位の「1 回分」（§3） */
export interface Occurrence<E extends OccurrenceSource = OccurrenceSource> {
  /** 繰り返しなしは eventId、繰り返しは `親の ID@recurrenceId`（例外行でも同じ。§3・§24 D33） */
  key: string;
  /** 親（マスター）の ID。繰り返しなしは自分の ID */
  seriesId: string;
  recurrenceId: string | null;
  /** 中身を持つ行（「この回だけ変更」の回は例外行） */
  event: E;
  allDay: boolean;
  /** 時刻あり: 開始の時刻。終日: 開始日の 0:00（JST） */
  startMs: number;
  /** 時刻あり: 終了（なしは null）。終日: 最終日の翌日 0:00（JST、含まない） */
  endMs: number | null;
  startDate: DateISO;
  /** 終日: 最終日（含む）。時刻あり: 終わる日（日付をまたぐと翌日。終了なしは開始日） */
  endDate: DateISO;
  startTime: TimeHM | null;
  endTime: TimeHM | null;
}

/** 回の開始・終了（ミリ秒）と日付 */
export function occurrenceTimes(
  src: OccurrenceSource,
): Omit<Occurrence, 'key' | 'seriesId' | 'recurrenceId' | 'event'> | null {
  if (src.allDay) {
    if (!src.startDate) return null;
    const endDate = src.endDate ?? src.startDate;
    return {
      allDay: true,
      startMs: fromJst(src.startDate),
      endMs: fromJst(addDays(endDate, 1)),
      startDate: src.startDate,
      endDate,
      startTime: null,
      endTime: null,
    };
  }
  const startMs = src.startAt ? parseIsoToMs(src.startAt) : null;
  if (startMs === null) return null;
  const endMs = src.endAt ? parseIsoToMs(src.endAt) : null;
  const s = toJstParts(startMs);
  const e = endMs === null ? null : toJstParts(endMs);
  return {
    allDay: false,
    startMs,
    endMs,
    startDate: s.date,
    endDate: e ? e.date : s.date,
    startTime: s.time,
    endTime: e ? e.time : null,
  };
}

/**
 * 回が [fromMs, toMs) に少しでもかかるか（§13.1）。
 * 終了なしの時刻予定は開始が範囲内のものだけ。ちょうど fromMs に終わる予定は入れない。
 */
export function overlapsRange(
  o: { startMs: number; endMs: number | null },
  fromMs: number,
  toMs: number,
): boolean {
  if (o.endMs === null) return o.startMs >= fromMs && o.startMs < toMs;
  return o.startMs < toMs && o.endMs > fromMs;
}

/** 回の並び: 開始の順 → 同じなら終日が先 → 終わりの早い順（終了なしは開始と同じ）→ key の順（§13.1） */
export function compareOccurrences(
  a: Pick<Occurrence, 'startMs' | 'endMs' | 'allDay' | 'key'>,
  b: Pick<Occurrence, 'startMs' | 'endMs' | 'allDay' | 'key'>,
): number {
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const ae = a.endMs ?? a.startMs;
  const be = b.endMs ?? b.startMs;
  if (ae !== be) return ae - be;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * 予定を [fromMs, toMs) にかかる回に展開する（§11）。サーバー（通知・表示用フィード）と PWA（表示）で共有する。
 * - 繰り返しなし: 予定そのものが 1 回（key は eventId）
 * - 繰り返し: rrule の回（key は `親の ID@recurrenceId`）。exdates の回は出さない。
 *   overrides はこの予定の例外行（「この回だけ変更」）で、同じ recurrenceId の回を置き換える（key は変えない。§3・§24 D33）。
 *   例外行は自分の日時で範囲にかかるかを見る（元の回が範囲の外でも、動かした先が範囲にあれば出す）
 * - 1 回の展開は最大 2,000 回で打ち切る
 */
export function expand<E extends OccurrenceSource>(
  event: E,
  overrides: readonly E[],
  fromMs: number,
  toMs: number,
): Occurrence<E>[] {
  const times = occurrenceTimes(event);
  if (!times) return [];
  const parsed = event.rrule ? parseRrule(event.rrule) : null;
  if (!parsed?.ok) {
    const occ: Occurrence<E> = {
      key: event.id,
      seriesId: event.id,
      recurrenceId: null,
      event,
      ...times,
    };
    return overlapsRange(occ, fromMs, toMs) ? [occ] : [];
  }
  const rule = parsed.rule;
  const allDay = times.allDay;
  const dtstart = { date: times.startDate, time: times.startTime ?? '00:00' };
  const length = times.endMs === null ? 0 : times.endMs - times.startMs;
  const exdates = new Set(event.exdates);
  const overridden = new Map<string, E>();
  for (const o of overrides) if (o.recurrenceId) overridden.set(o.recurrenceId, o);
  // 回の開始が [fromMs - 長さ, toMs) にあれば、範囲にかかりうる（壁時計の分の単位で広めに取る）
  const fromWall = toJstParts(fromMs - length - 60_000);
  const toWall = toJstParts(toMs + 60_000);
  const starts = ruleStarts(
    rule,
    dtstart,
    { date: fromWall.date, time: fromWall.time },
    { date: toWall.date, time: toWall.time },
  );
  const out: Occurrence<E>[] = [];
  for (const start of starts) {
    const rid = recurrenceIdOf(start, allDay);
    if (exdates.has(rid) || overridden.has(rid)) continue;
    const startMs = fromJst(start.date, allDay ? '00:00' : start.time);
    const endMs = times.endMs === null ? null : startMs + length;
    const end = endMs === null ? null : toJstParts(endMs);
    const occ: Occurrence<E> = {
      key: `${event.id}@${rid}`,
      seriesId: event.id,
      recurrenceId: rid,
      event,
      allDay,
      startMs,
      endMs,
      startDate: start.date,
      // 終日は最終日（含む）、時刻ありは終わる日
      endDate: allDay
        ? addDays(start.date, Math.round(length / 86_400_000) - 1)
        : (end?.date ?? start.date),
      startTime: allDay ? null : start.time,
      endTime: allDay || !end ? null : end.time,
    };
    if (overlapsRange(occ, fromMs, toMs)) out.push(occ);
  }
  for (const [rid, o] of overridden) {
    if (exdates.has(rid)) continue;
    const t = occurrenceTimes(o);
    if (!t) continue;
    const occ: Occurrence<E> = {
      key: `${event.id}@${rid}`,
      seriesId: event.id,
      recurrenceId: rid,
      event: o,
      ...t,
    };
    if (overlapsRange(occ, fromMs, toMs)) out.push(occ);
  }
  return out.slice(0, MAX_OCCURRENCES_PER_EXPAND);
}

/**
 * たくさんの予定をまとめて展開して並べる。例外行（parentId あり）は親といっしょに展開する。
 */
export function expandAll<E extends OccurrenceSource>(
  events: readonly E[],
  fromMs: number,
  toMs: number,
): Occurrence<E>[] {
  const overridesByParent = new Map<string, E[]>();
  for (const e of events) {
    if (e.parentId) {
      const list = overridesByParent.get(e.parentId) ?? [];
      list.push(e);
      overridesByParent.set(e.parentId, list);
    }
  }
  const out: Occurrence<E>[] = [];
  for (const e of events) {
    if (e.parentId) continue;
    out.push(...expand(e, overridesByParent.get(e.id) ?? [], fromMs, toMs));
  }
  out.sort(compareOccurrences);
  return out;
}
