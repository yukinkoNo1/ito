import {
  type Clock,
  diffDays,
  type EventChanges,
  type EventRecord,
  fieldsFromChanges,
  formatMdW,
  formatRrule,
  isAtOrAfter,
  isSeriesOccurrence,
  occurrenceFields,
  parseRrule,
  projectEvent,
  shiftRule,
  shiftSeries,
  splitSeries,
  startsChange,
  toIsoJst,
  toJstParts,
  uuidv7,
  wallOfRecurrenceId,
} from '@ito/core';
import { eq } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { events, type MemberRow } from '../db/schema';
import { ApiError } from '../errors';
import { validationError } from '../lib/validate';
import { describeDiff, memberNames, recordActivity } from './activity';
import { insertRecord, loadExceptions, recordChange, updateRecord } from './records';
import { copyReminderPrefs } from './reminders';

/**
 * 繰り返しの編集・削除の範囲（§11・§13）。`:id` は親（マスター）、If-Match は親の version（シリーズ単位の楽観ロック。
 * この回だけの変更・取り消しでも親の version を上げる。§24 D33）
 */

export type Scope = 'this' | 'following' | 'all';

export interface Discarded {
  exceptions: number;
  exdates: number;
}

const TIME_KEYS = ['allDay', 'startAt', 'endAt', 'startDate', 'endDate'] as const;

function hasTimeChange(changes: EventChanges): boolean {
  return TIME_KEYS.some((k) => changes[k] !== undefined);
}

function ridLabel(rid: string): string {
  const wall = wallOfRecurrenceId(rid);
  return wall ? formatMdW(wall.date) : rid;
}

/** その回の今の中身（例外行があればそれ、なければ親をその回の日時に置いたもの） */
export function currentOccurrence(
  db: DbLike,
  master: EventRecord,
  rid: string,
): { base: EventRecord; exception: EventRecord | null } {
  const exception =
    loadExceptions(db, master.id).find((e) => e.recurrenceId === rid && e.deletedAt === null) ??
    null;
  if (exception) return { base: exception, exception };
  const times = isSeriesOccurrence(master, rid) ? occurrenceFields(master, rid) : null;
  if (!times) throw new ApiError(404, 'not_found', 'この回は見つかりません');
  return {
    base: {
      ...master,
      ...times,
      rrule: null,
      exdates: [],
      parentId: master.id,
      recurrenceId: rid,
    },
    exception: null,
  };
}

/** rid 以降の例外行をゴミ箱へ（§11「以降の例外は破棄」。rid なしならすべて） */
function discardExceptions(
  db: DbLike,
  me: MemberRow,
  master: EventRecord,
  from: string | null,
  now: number,
): number {
  let n = 0;
  for (const ex of loadExceptions(db, master.id)) {
    if (ex.deletedAt !== null || !ex.recurrenceId) continue;
    if (from !== null && !isAtOrAfter(ex.recurrenceId, from)) continue;
    updateRecord(
      db,
      { ...ex, version: ex.version + 1, deletedAt: now, deletedBy: me.id, updatedAt: now },
      false,
    );
    recordChange(db, 'event', ex.id, now);
    n++;
  }
  return n;
}

function bumpMaster(
  db: DbLike,
  me: MemberRow,
  master: EventRecord,
  now: number,
  patch: Partial<EventRecord> = {},
): EventRecord {
  const next: EventRecord = {
    ...master,
    ...patch,
    version: master.version + 1,
    updatedBy: me.id,
    updatedAt: now,
  };
  updateRecord(db, next, false);
  recordChange(db, 'event', master.id, now);
  return next;
}

function checkUnusedId(db: DbLike, id: string): void {
  if (db.select({ id: events.id }).from(events).where(eq(events.id, id)).get()) {
    throw validationError([{ field: 'exceptionId', message: 'この ID はもう使われています' }]);
  }
}

/* ───────── この回のみ ───────── */

/** 「この回だけ変更」: 例外行を作る（あれば更新する）。owner・visibility は親から複製（§10） */
export function updateThisOccurrence(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  master: EventRecord,
  rid: string,
  exceptionId: string | undefined,
  changes: EventChanges,
  ordered: (ids: string[]) => string[],
  checkMembers: (ids: string[], previous: string[]) => void,
): {
  status: 200;
  body: { event: ReturnType<typeof projectEvent>; exception: ReturnType<typeof projectEvent> };
} {
  if (changes.rrule !== undefined) {
    throw validationError([
      { field: 'rrule', message: 'この回だけの変更では、繰り返しは変えられません' },
    ]);
  }
  if (changes.visibility !== undefined && changes.visibility !== master.visibility) {
    throw validationError([
      { field: 'visibility', message: '公開・非公開は、繰り返しの予定全体で変えてください' },
    ]);
  }
  const { base, exception } = currentOccurrence(db, master, rid);
  const fields = fieldsFromChanges(base, changes);
  if ('errors' in fields) throw validationError(fields.errors);
  const f = { ...fields.value, memberIds: ordered(fields.value.memberIds) };
  checkMembers(f.memberIds, base.memberIds);
  const now = clock.now();
  const id = exception?.id ?? exceptionId ?? uuidv7(now);
  if (!exception) checkUnusedId(db, id);
  const row: EventRecord = {
    ...base,
    ...f,
    id,
    version: exception ? exception.version + 1 : 1,
    rrule: null,
    exdates: [],
    parentId: master.id,
    recurrenceId: rid,
    ownerId: master.ownerId,
    visibility: master.visibility,
    createdBy: exception?.createdBy ?? me.id,
    createdAt: exception?.createdAt ?? now,
    updatedBy: me.id,
    updatedAt: now,
    deletedBy: null,
    deletedAt: null,
  };
  if (exception) {
    const membersChanged =
      row.forEveryone !== exception.forEveryone ||
      row.memberIds.join(',') !== exception.memberIds.join(',');
    updateRecord(db, row, membersChanged);
  } else {
    insertRecord(db, row);
  }
  recordChange(db, 'event', row.id, now);
  const next = bumpMaster(db, me, master, now);
  const diff = describeDiff(base, row, memberNames(db));
  recordActivity(db, clock, me.id, 'update', row, [`${ridLabel(rid)} の回だけ`, ...diff]);
  return {
    status: 200,
    body: { event: projectEvent(next, me.id), exception: projectEvent(row, me.id) },
  };
}

/** 「この回だけ削除」: 親の exdates に足す（その回の例外行はゴミ箱へ） */
export function deleteThisOccurrence(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  master: EventRecord,
  rid: string,
): { status: 200; body: { event: ReturnType<typeof projectEvent> } } {
  const { base, exception } = currentOccurrence(db, master, rid);
  const now = clock.now();
  if (exception) {
    updateRecord(
      db,
      {
        ...exception,
        version: exception.version + 1,
        deletedAt: now,
        deletedBy: me.id,
        updatedAt: now,
      },
      false,
    );
    recordChange(db, 'event', exception.id, now);
  }
  const exdates = [...new Set([...master.exdates, rid])].sort();
  const next = bumpMaster(db, me, master, now, { exdates });
  recordActivity(db, clock, me.id, 'delete', base, [`${ridLabel(rid)} の回だけ`]);
  return { status: 200, body: { event: projectEvent(next, me.id) } };
}

/* ───────── これ以降 ───────── */

/**
 * 「これ以降」を変更: 元のシリーズは UNTIL=前の回、この回を開始とする新シリーズを作る（元が COUNT なら残りの回数）。
 * 以降の例外・取り消しは破棄し、reminder_prefs を新シリーズに複製する。初回なら null（呼び出し側で「すべて」）
 */
export function updateFollowing(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  master: EventRecord,
  rid: string,
  newId: string | undefined,
  changes: EventChanges,
  ordered: (ids: string[]) => string[],
  checkMembers: (ids: string[], previous: string[]) => void,
): {
  status: 200;
  body: {
    event: ReturnType<typeof projectEvent>;
    created: ReturnType<typeof projectEvent>;
    discarded: Discarded;
  };
} | null {
  if (!isSeriesOccurrence(master, rid)) {
    // 例外行で動かした回でも、元の回がシリーズにあればよい
    const hasException = loadExceptions(db, master.id).some(
      (e) => e.recurrenceId === rid && e.deletedAt === null,
    );
    if (!hasException) throw new ApiError(404, 'not_found', 'この回は見つかりません');
  }
  const split = splitSeries(master, rid);
  if (!split) return null;
  const times = occurrenceFields(master, rid);
  if (!times) throw new ApiError(404, 'not_found', 'この回は見つかりません');
  const tailBase: EventRecord = { ...master, ...times, rrule: split.tailRrule, exdates: [] };
  // 日付を動かしたら、曜日・日の指定も同じだけずらす（rrule を変えていなければ）
  let tailChanges = changes;
  if (changes.rrule === undefined && hasTimeChange(changes)) {
    const moved = fieldsFromChanges(tailBase, changes);
    if ('errors' in moved) throw validationError(moved.errors);
    const from = times.startDate ?? toJstParts(times.startAt ?? 0).date;
    const to = moved.value.startDate ?? toJstParts(moved.value.startAt ?? 0).date;
    const parsed = parseRrule(split.tailRrule);
    if (parsed.ok && from !== to) {
      tailChanges = { ...changes, rrule: formatRrule(shiftRule(parsed.rule, diffDays(from, to))) };
    }
  }
  const fields = fieldsFromChanges(tailBase, tailChanges);
  if ('errors' in fields) throw validationError(fields.errors);
  const f = { ...fields.value, memberIds: ordered(fields.value.memberIds) };
  checkMembers(f.memberIds, master.memberIds);
  const now = clock.now();
  const id = newId ?? uuidv7(now);
  checkUnusedId(db, id);
  const exceptions = discardExceptions(db, me, master, rid, now);
  const head = bumpMaster(db, me, master, now, {
    rrule: split.headRrule,
    exdates: split.headExdates,
  });
  const created: EventRecord = {
    ...master,
    ...f,
    id,
    version: 1,
    exdates: [],
    parentId: null,
    recurrenceId: null,
    ownerId: master.ownerId,
    createdBy: me.id,
    updatedBy: me.id,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  insertRecord(db, created);
  recordChange(db, 'event', id, now);
  copyReminderPrefs(db, master.id, id);
  recordActivity(db, clock, me.id, 'update', head, [`${ridLabel(rid)} 以降を別の予定に分けた`]);
  recordActivity(db, clock, me.id, 'create', created);
  return {
    status: 200,
    body: {
      event: projectEvent(head, me.id),
      created: projectEvent(created, me.id),
      discarded: { exceptions, exdates: split.discardedExdates.length },
    },
  };
}

/** 「これ以降を削除」: 元のシリーズを前の回で終える（以降の例外・取り消しは破棄）。初回なら null（全体を削除） */
export function deleteFollowing(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  master: EventRecord,
  rid: string,
): { status: 200; body: { event: ReturnType<typeof projectEvent>; discarded: Discarded } } | null {
  const split = splitSeries(master, rid);
  if (!split) return null;
  const now = clock.now();
  const exceptions = discardExceptions(db, me, master, rid, now);
  const next = bumpMaster(db, me, master, now, {
    rrule: split.headRrule,
    exdates: split.headExdates,
  });
  recordActivity(db, clock, me.id, 'delete', next, [`${ridLabel(rid)} 以降`]);
  return {
    status: 200,
    body: {
      event: projectEvent(next, me.id),
      discarded: { exceptions, exdates: split.discardedExdates.length },
    },
  };
}

/* ───────── すべて ───────── */

/**
 * 「すべて」の日時の変更を、選んだ回の元の日時からの差分としてマスターの changes にする（§11）。
 * 日時を変えていなければ changes のまま
 */
export function allScopeChanges(
  db: DbLike,
  master: EventRecord,
  rid: string | null | undefined,
  changes: EventChanges,
): EventChanges {
  if (!rid || !master.rrule || !hasTimeChange(changes)) return changes;
  const { base } = currentOccurrence(db, master, rid);
  const original = occurrenceFields(master, rid);
  if (!original) return changes;
  const moved = fieldsFromChanges({ ...base, ...original }, changes);
  if ('errors' in moved) throw validationError(moved.errors);
  const shifted = shiftSeries(master, rid, moved.value);
  if (!shifted) return changes;
  const out: EventChanges = { ...changes, allDay: shifted.allDay };
  if (shifted.allDay) {
    out.startDate = shifted.startDate ?? undefined;
    out.endDate = shifted.endDate ?? undefined;
    delete out.startAt;
    delete out.endAt;
  } else {
    out.startAt = toIsoJst(shifted.startAt ?? 0);
    out.endAt = shifted.endAt === null ? null : toIsoJst(shifted.endAt);
    delete out.startDate;
    delete out.endDate;
  }
  if (changes.rrule === undefined && shifted.rrule !== master.rrule) out.rrule = shifted.rrule;
  return out;
}

/** 「すべて」で回の開始が変わるなら、例外・取り消しをリセットする（§11。件数を返す） */
export function resetIfStartsChange(
  db: DbLike,
  me: MemberRow,
  before: EventRecord,
  after: EventRecord,
  now: number,
): { next: EventRecord; discarded: Discarded } {
  if (!before.rrule || !startsChange(before, after)) {
    return { next: after, discarded: { exceptions: 0, exdates: 0 } };
  }
  const exceptions = discardExceptions(db, me, before, null, now);
  return {
    next: { ...after, exdates: [] },
    discarded: { exceptions, exdates: before.exdates.length },
  };
}
