import {
  dtoToRecord,
  type EventCreateInput,
  isSeriesOccurrence,
  normalizeRrule,
  occurrenceFields,
  parseIsoToMs,
  recordToDto,
} from '@ito/core';
import type { LocalEvent } from '../data/db';

/**
 * 繰り返しの回の編集・削除（§11）で画面が使う計算。範囲（C-04）で消える件数、回の今の中身、送る変更
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

/** 変更で回の開始の日時が変わるか（「すべて」で例外・取り消しがリセットされるか。§11） */
export function changesStart(base: LocalEvent, input: EventCreateInput): boolean {
  if (input.allDay !== base.allDay) return true;
  if (input.allDay) return (input.startDate ?? null) !== (base.startDate ?? null);
  const a = input.startAt ? parseIsoToMs(input.startAt) : null;
  const b = base.startAt ? parseIsoToMs(base.startAt) : null;
  return a !== b;
}

/**
 * C-04 に出す、その範囲を選ぶと消える個別の変更（例外行）・取り消しの件数（§11）。
 * これ以降: その回以降のもの。すべて: 編集で回の開始が変わるときだけ全部（削除はシリーズごとゴミ箱で、元に戻せる）
 */
export function lostCounts(
  master: LocalEvent,
  overrides: LocalEvent[],
  recurrenceId: string,
  opts: { action: 'edit' | 'delete'; startsChange: boolean },
): { following: number; all: number } {
  const later = (rid: string | null) => rid !== null && rid >= recurrenceId;
  const following =
    overrides.filter((o) => later(o.recurrenceId)).length +
    master.exdates.filter((d) => later(d)).length;
  const all =
    opts.action === 'edit' && opts.startsChange ? overrides.length + master.exdates.length : 0;
  return { following, all };
}

/**
 * 範囲ごとに送る変更。この回だけは繰り返しを変えられないので rrule を外す。
 * これ以降・すべては、繰り返しを変えていなければ rrule を送らない（日付を動かしたら曜日もずらすのはサーバーが行う）
 */
export function changesForScope(
  master: LocalEvent,
  input: EventCreateInput,
  scope: Scope,
): EventCreateInput {
  const { rrule, ...rest } = input;
  if (scope === 'this' || rrule === undefined) return rest;
  const same = (rrule === null ? null : normalizeRrule(rrule)) === master.rrule;
  return same ? rest : { ...rest, rrule };
}
