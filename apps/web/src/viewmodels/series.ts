import {
  allScopeChanges,
  applyChangesLocally,
  dtoToRecord,
  type EventChangesInput,
  type EventCreateInput,
  eventChangesSchema,
  type FieldError,
  fieldsFromChanges,
  isAtOrAfter,
  isSeriesOccurrence,
  occurrenceFields,
  parseIsoToMs,
  recordToDto,
  recurrenceIdOf,
  sameRule,
  seriesLoss,
  splitSeries,
  toJstParts,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import { diffChanges } from '../data/diff';

/**
 * 繰り返しの回の編集・削除（§11）で画面が使う計算。範囲（C-04）で消える件数、回の今の中身、送る変更。
 * 件数と送る変更は、サーバーと同じ core の計算（allScopeChanges・seriesLoss）で出す（§24 D34）
 */

export type Scope = 'this' | 'following' | 'all';

/** その回の今の中身（例外行があればそれ、なければ親をその回の日時に置いたもの） */
export function occurrenceEvent(
  master: LocalEvent,
  overrides: LocalEvent[],
  recurrenceId: string,
): LocalEvent | null {
  const exception = overrides.find((o) => o.recurrenceId === recurrenceId);
  if (exception) return exception;
  const record = dtoToRecord(master);
  if (!isSeriesOccurrence(record, recurrenceId)) return null;
  const times = occurrenceFields(record, recurrenceId);
  if (!times) return null;
  return {
    ...recordToDto({
      ...record,
      ...times,
      rrule: null,
      exdates: [],
      parentId: master.id,
      recurrenceId,
    }),
    sync: master.sync,
  };
}

function startDateOf(e: { allDay: boolean; startDate?: string; startAt?: string }): string {
  if (e.allDay) return e.startDate ?? '';
  return toJstParts(parseIsoToMs(e.startAt ?? '') ?? 0).date;
}

/** 回の変更の下書き（書く画面・項目の直しの全部の項目、またはその一部） */
export type OccurrenceInput = EventChangesInput & { id?: string | undefined };

/** 繰り返しを変えたか（書き方・並びの違いは同じとみなす。§24 D34） */
export function rruleChanged(master: LocalEvent, rrule: string | null | undefined): boolean {
  return rrule !== undefined && !sameRule(rrule, master.rrule, startDateOf(master));
}

/**
 * 範囲ごとに送る変更（§11・§24 D34）: その回の今の中身（base）と下書きの差分だけ。日時は変えたときだけ入る
 * （例外で動かした回から件名だけ直しても、シリーズを動かさない）。繰り返しは「この予定だけ」では送らず、
 * ほかは規則が変わったときだけ送る
 */
export function occurrenceChanges(
  master: LocalEvent,
  base: LocalEvent,
  input: OccurrenceInput,
  scope: Scope,
): { ok: true; changes: EventChangesInput } | { ok: false; errors: FieldError[] } {
  const { rrule, id: _id, ...rest } = input;
  const parsed = eventChangesSchema.safeParse(rest);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    };
  }
  const applied = applyChangesLocally(base, parsed.data, base.updatedBy, 0);
  if ('errors' in applied) return { ok: false, errors: applied.errors };
  const changes = diffChanges(base, { ...applied.value, rrule: base.rrule });
  if (scope !== 'this' && rruleChanged(master, rrule)) changes.rrule = rrule ?? null;
  return { ok: true, changes };
}

/** 「この予定だけ」を選べない理由（公開・非公開や繰り返しはシリーズ全体で変える。レビュー P3-web-04・11） */
export function thisScopeBlock(master: LocalEvent, input: OccurrenceInput): string | null {
  if ((input.visibility ?? master.visibility) !== master.visibility) {
    return '公開・非公開は、繰り返しの予定全体で変えてください';
  }
  if (rruleChanged(master, input.rrule)) {
    return '繰り返しの変更は「これ以降すべて」か「すべて」で保存してください';
  }
  return null;
}

/** 「すべて」の変更で消える例外・取り消しの件数（サーバーの discarded と同じ計算） */
function allLoss(
  master: LocalEvent,
  overrides: LocalEvent[],
  recurrenceId: string,
  changes: EventChangesInput,
): number {
  const record = dtoToRecord(master);
  const base = occurrenceEvent(master, overrides, recurrenceId);
  const parsed = eventChangesSchema.safeParse(changes);
  if (!base || !parsed.success) return 0;
  const scoped = allScopeChanges(record, recurrenceId, dtoToRecord(base), parsed.data);
  if ('errors' in scoped) return 0;
  const next = fieldsFromChanges(record, scoped.changes);
  if ('errors' in next) return 0;
  const rids = overrides.flatMap((o) => (o.recurrenceId ? [o.recurrenceId] : []));
  const loss = seriesLoss(record, next.value, rids);
  return loss.exceptions.length + loss.exdates.length;
}

/**
 * C-04 に出す、その範囲を選ぶと消える個別の変更（例外行）・取り消しの件数（§11・§24 D34）。
 * これ以降: その回以降のもの（最初の回なら「すべて」と同じ。削除はシリーズごとゴミ箱で元に戻せるので 0）。
 * すべて: 編集では core の seriesLoss（開始が変われば全部、規則だけなら回でなくなるもの）。削除は 0（元に戻せる）
 */
export function lostCounts(
  master: LocalEvent,
  overrides: LocalEvent[],
  recurrenceId: string,
  opts: { action: 'edit' | 'delete'; changes?: EventChangesInput },
): { following: number; all: number } {
  const all =
    opts.action === 'edit' ? allLoss(master, overrides, recurrenceId, opts.changes ?? {}) : 0;
  if (splitSeries(dtoToRecord(master), recurrenceId) === null) return { following: all, all };
  const later = (rid: string | null) => rid !== null && isAtOrAfter(rid, recurrenceId);
  const following =
    overrides.filter((o) => later(o.recurrenceId)).length +
    master.exdates.filter((d) => later(d)).length;
  return { following, all };
}

/** 保存したあとの回（日時を動かしたら recurrenceId も変わる。詳細をその回に移すのに使う） */
export function movedRecurrenceId(base: LocalEvent, changes: EventChangesInput): string {
  const allDay = changes.allDay ?? base.allDay;
  if (allDay) return changes.startDate ?? base.startDate ?? '';
  const p = toJstParts(parseIsoToMs(changes.startAt ?? base.startAt ?? '') ?? 0);
  return recurrenceIdOf({ date: p.date, time: p.time }, false);
}

/**
 * 範囲ごとに送る変更（旧: 書く画面の全部の項目を送っていた）。rrule だけを扱い、差分は occurrenceChanges で取る
 */
export function changesForScope(
  master: LocalEvent,
  input: EventCreateInput,
  scope: Scope,
): EventCreateInput {
  const { rrule, ...rest } = input;
  if (scope === 'this' || !rruleChanged(master, rrule)) return rest;
  return { ...rest, rrule };
}
