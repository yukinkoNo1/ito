import {
  type Clock,
  canSeeContent,
  type EventChanges,
  type EventCreate,
  type EventDTO,
  type EventRecord,
  fieldsFromChanges,
  fieldsFromCreate,
  projectEvent,
  uuidv7,
} from '@ito/core';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { events, type MemberRow, members } from '../db/schema';
import { ApiError } from '../errors';
import { validationError } from '../lib/validate';
import { describeDiff, memberNames, recordActivity } from './activity';
import { insertRecord, loadEvent, loadExceptions, recordChange, updateRecord } from './records';

export const TRASH_DAYS = 30;

export interface EventResult {
  status: 200 | 201;
  body: { event: EventDTO } | { id: string; version: number };
}

function activeMemberIds(db: DbLike): Set<string> {
  return new Set(
    db
      .select({ id: members.id })
      .from(members)
      .where(isNull(members.disabledAt))
      .all()
      .map((m) => m.id),
  );
}

/** 担当者 ID をメンバーの作成順（created_at、同じなら id）に並べる */
function orderMemberIds(db: DbLike, ids: string[]): string[] {
  const order = new Map(
    db
      .select({ id: members.id })
      .from(members)
      .orderBy(asc(members.createdAt), asc(members.id))
      .all()
      .map((m, i) => [m.id, i]),
  );
  return [...ids].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
}

/** 新しく担当に入れる人は有効なメンバーだけ（今までの担当が無効化されていても、そのままなら拒否しない） */
function checkMembers(db: DbLike, memberIds: string[], previous: string[] = []): void {
  const active = activeMemberIds(db);
  const prev = new Set(previous);
  const bad = memberIds.filter((id) => !active.has(id) && !prev.has(id));
  if (bad.length > 0)
    throw validationError([{ field: 'memberIds', message: '家族にいない人は選べません' }]);
}

/** 繰り返しは Phase 3 で受け付ける。それまでは rrule・例外行を拒否する */
function rejectRecurrence(rrule: string | null | undefined): void {
  if (rrule) throw validationError([{ field: 'rrule', message: '繰り返しはまだ使えません' }]);
}

/** 他人の非公開は中身も操作も持ち主だけ（§14）。認可は If-Match より先に確かめる */
export function authorize(record: EventRecord, me: MemberRow): void {
  if (!canSeeContent(record, me.id))
    throw new ApiError(403, 'forbidden', 'ほかの家族の内緒の予定は変えられません');
}

function checkVersion(record: EventRecord, ifMatch: number | null, me: MemberRow): void {
  if (ifMatch === null) throw new ApiError(428, 'precondition_required');
  if (Number.isNaN(ifMatch)) {
    throw validationError([{ field: 'If-Match', message: 'If-Match は版の数にしてください' }]);
  }
  if (ifMatch !== record.version) {
    // 409 の本文にも projectEvent を通した最新版を返す（§10）
    throw new ApiError(409, 'conflict', undefined, { event: projectEvent(record, me.id) });
  }
}

function loadForWrite(db: DbLike, id: string): EventRecord {
  const record = loadEvent(db, id);
  if (!record) throw new ApiError(404, 'not_found');
  if (record.deletedAt !== null) throw new ApiError(410, 'gone');
  return record;
}

export function createEvent(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  input: EventCreate,
): EventResult {
  rejectRecurrence(input.rrule);
  if (input.parentId || input.recurrenceId || (input.exdates && input.exdates.length > 0)) {
    throw validationError([
      { field: 'parentId', message: '例外行は PATCH（scope=this）で作ってください' },
    ]);
  }
  const fields = fieldsFromCreate(input, me.id);
  if ('errors' in fields) throw validationError(fields.errors);
  const f = { ...fields.value, memberIds: orderMemberIds(db, fields.value.memberIds) };
  checkMembers(db, f.memberIds);
  const now = clock.now();
  const id = input.id ?? uuidv7(now);
  if (db.select({ id: events.id }).from(events).where(eq(events.id, id)).get()) {
    throw validationError([{ field: 'id', message: 'この ID はもう使われています' }]);
  }
  const record: EventRecord = {
    id,
    version: 1,
    ...f,
    exdates: [],
    parentId: null,
    recurrenceId: null,
    ownerId: me.id,
    createdBy: me.id,
    updatedBy: me.id,
    deletedBy: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  insertRecord(db, record);
  recordActivity(db, clock, me.id, 'create', record);
  recordChange(db, 'event', id, now);
  return { status: 201, body: { event: projectEvent(record, me.id) } };
}

export function updateEvent(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  id: string,
  ifMatch: number | null,
  changes: EventChanges,
): EventResult {
  const current = loadForWrite(db, id);
  authorize(current, me);
  if (
    changes.visibility !== undefined &&
    changes.visibility !== current.visibility &&
    current.ownerId !== me.id
  ) {
    throw new ApiError(403, 'forbidden', '公開・非公開を変えられるのは作った人だけです');
  }
  checkVersion(current, ifMatch, me);
  rejectRecurrence(changes.rrule ?? current.rrule);

  const fields = fieldsFromChanges(current, changes);
  if ('errors' in fields) throw validationError(fields.errors);
  const f = { ...fields.value, memberIds: orderMemberIds(db, fields.value.memberIds) };
  checkMembers(db, f.memberIds, current.memberIds);

  const now = clock.now();
  const next: EventRecord = {
    ...current,
    ...f,
    version: current.version + 1,
    updatedBy: me.id,
    updatedAt: now,
  };
  const membersChanged =
    next.forEveryone !== current.forEveryone ||
    next.memberIds.join(',') !== current.memberIds.join(',');
  updateRecord(db, next, membersChanged);
  propagateToExceptions(db, next, now);
  const diff = describeDiff(current, next, memberNames(db));
  recordActivity(db, clock, me.id, 'update', next, diff);
  recordChange(db, 'event', id, now);
  return { status: 200, body: { event: projectEvent(next, me.id) } };
}

/**
 * 例外行の owner_id・visibility は常に親から複製する（§10）。親が変わったら同じトランザクションで例外行も更新し、changes に積む。
 */
export function propagateToExceptions(db: DbLike, parent: EventRecord, now: number): void {
  for (const ex of loadExceptions(db, parent.id)) {
    if (ex.visibility === parent.visibility && ex.ownerId === parent.ownerId) continue;
    const next: EventRecord = {
      ...ex,
      visibility: parent.visibility,
      ownerId: parent.ownerId,
      forEveryone: parent.visibility === 'private' ? false : ex.forEveryone,
      memberIds: parent.visibility === 'private' ? [parent.ownerId] : ex.memberIds,
      version: ex.version + 1,
      updatedAt: now,
    };
    updateRecord(db, next, true);
    recordChange(db, 'event', ex.id, now);
  }
}

export function deleteEvent(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  id: string,
  ifMatch: number | null,
): EventResult {
  const current = loadForWrite(db, id);
  authorize(current, me);
  checkVersion(current, ifMatch, me);
  const now = clock.now();
  const next: EventRecord = {
    ...current,
    version: current.version + 1,
    deletedAt: now,
    deletedBy: me.id,
    updatedAt: now,
    updatedBy: me.id,
  };
  updateRecord(db, next, false);
  // 例外行も一緒にゴミ箱へ（同じ時刻で。復元で一緒に戻す）
  for (const ex of loadExceptions(db, id)) {
    if (ex.deletedAt !== null) continue;
    updateRecord(
      db,
      { ...ex, version: ex.version + 1, deletedAt: now, deletedBy: me.id, updatedAt: now },
      false,
    );
    recordChange(db, 'event', ex.id, now);
  }
  recordActivity(db, clock, me.id, 'delete', next);
  recordChange(db, 'event', id, now);
  return { status: 200, body: { id, version: next.version } };
}

export function restoreEvent(db: DbLike, clock: Clock, me: MemberRow, id: string): EventResult {
  const current = loadEvent(db, id);
  if (!current || current.parentId !== null) throw new ApiError(404, 'not_found');
  authorize(current, me);
  if (current.deletedAt === null)
    return { status: 200, body: { event: projectEvent(current, me.id) } };
  if (current.deletedAt <= clock.now() - TRASH_DAYS * 24 * 60 * 60 * 1000)
    throw new ApiError(410, 'gone');
  const now = clock.now();
  const deletedAt = current.deletedAt;
  const next: EventRecord = {
    ...current,
    version: current.version + 1,
    deletedAt: null,
    deletedBy: null,
    updatedAt: now,
    updatedBy: me.id,
  };
  updateRecord(db, next, false);
  for (const ex of loadExceptions(db, id)) {
    if (ex.deletedAt !== deletedAt) continue;
    updateRecord(
      db,
      { ...ex, version: ex.version + 1, deletedAt: null, deletedBy: null, updatedAt: now },
      false,
    );
    recordChange(db, 'event', ex.id, now);
  }
  recordActivity(db, clock, me.id, 'restore', next);
  recordChange(db, 'event', id, now);
  return { status: 200, body: { event: projectEvent(next, me.id) } };
}

/** ゴミ箱（見てよいもの。他人の非公開は出さない。§24 D21） */
export function listTrash(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
): { event: EventDTO; deletedAt: number; deletedBy: string }[] {
  const since = clock.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
  const rows = db
    .select({ id: events.id })
    .from(events)
    .where(and(isNull(events.parentId), gt(events.deletedAt, since)))
    .all();
  const out: { event: EventDTO; deletedAt: number; deletedBy: string }[] = [];
  for (const row of rows) {
    const record = loadEvent(db, row.id);
    if (!record || !canSeeContent(record, me.id)) continue;
    out.push({
      event: projectEvent(record, me.id),
      deletedAt: record.deletedAt as number,
      deletedBy: record.deletedBy ?? record.updatedBy,
    });
  }
  out.sort((a, b) => b.deletedAt - a.deletedAt);
  return out;
}
