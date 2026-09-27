import { addDays, type DateISO, fromJst, parseIsoToMs, type TimeHM, toJstParts } from './jst';

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
  /** 繰り返しなしは eventId、繰り返しは `親の ID@recurrenceId`（例外行でも同じ。§24 D23） */
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
 * 予定を [fromMs, toMs) の回に展開する（§11）。サーバー（通知・表示用フィード）と PWA（表示）で共有する。
 * overrides はこの予定の例外行（「この回だけ変更」）。繰り返しは Phase 3 で recurrence.ts が受け持つ。
 */
export function expand<E extends OccurrenceSource>(
  event: E,
  _overrides: readonly E[],
  fromMs: number,
  toMs: number,
): Occurrence<E>[] {
  const times = occurrenceTimes(event);
  if (!times) return [];
  const occ: Occurrence<E> = {
    key: event.id,
    seriesId: event.id,
    recurrenceId: null,
    event,
    ...times,
  };
  return overlapsRange(occ, fromMs, toMs) ? [occ] : [];
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
