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
import { describeDiff, hideActivityOf, memberNames, recordActivity } from './activity';
import { insertRecord, loadEvent, loadExceptions, recordChange, updateRecord } from './records';
import {
  allScopeChanges,
  type Discarded,
  deleteFollowing,
  deleteThisOccurrence,
  resetIfStartsChange,
  type Scope,
  updateFollowing,
  updateThisOccurrence,
} from './series';

export const TRASH_DAYS = 30;

export interface EventResult {
  status: 200 | 201;
  body:
    | { event: EventDTO; exception?: EventDTO; created?: EventDTO; discarded?: Discarded }
    | { id: string; version: number };
}

/** PATCH /api/events/:id の本文（§13） */
export interface EventPatch {
  scope: Scope;
  recurrenceId?: string | null | undefined;
  exceptionId?: string | undefined;
  changes: EventChanges;
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
  if (record.parentId !== null) {
    // 例外行は、親の予定に scope=this で変える（owner・visibility を親から複製するため。§10）
    throw validationError([
      { field: 'id', message: 'この回の変更は、繰り返しの予定に scope=this で送ってください' },
    ]);
  }
  return record;
}

function requireRecurrenceId(rid: string | null | undefined): string {
  if (!rid) {
    throw validationError([
      { field: 'recurrenceId', message: 'どの回かを recurrenceId で指定してください' },
    ]);
  }
  return rid;
}

export function createEvent(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  input: EventCreate,
): EventResult {
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

/**
 * 予定の更新（§13）。繰り返しの予定は scope で範囲を選ぶ（§11）: this＝この回だけ（例外行）、
 * following＝これ以降（分割）、all＝すべて（日時は選んだ回からの差分）。繰り返しなしは scope に関係なく全体
 */
export function updateEvent(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  id: string,
  ifMatch: number | null,
  patch: EventPatch,
): EventResult {
  const current = loadForWrite(db, id);
  authorize(current, me);
  const { changes: rawChanges } = patch;
  if (
    rawChanges.visibility !== undefined &&
    rawChanges.visibility !== current.visibility &&
    current.ownerId !== me.id
  ) {
    throw new ApiError(403, 'forbidden', '公開・非公開を変えられるのは作った人だけです');
  }
  checkVersion(current, ifMatch, me);
  const ordered = (ids: string[]) => orderMemberIds(db, ids);
  const check = (ids: string[], previous: string[]) => checkMembers(db, ids, previous);
  if (current.rrule !== null && patch.scope === 'this') {
    const rid = requireRecurrenceId(patch.recurrenceId);
    return updateThisOccurrence(
      db,
      clock,
      me,
      current,
      rid,
      patch.exceptionId,
      rawChanges,
      ordered,
      check,
    );
  }
  if (current.rrule !== null && patch.scope === 'following') {
    const rid = requireRecurrenceId(patch.recurrenceId);
    const split = updateFollowing(
      db,
      clock,
      me,
      current,
      rid,
      patch.exceptionId,
      rawChanges,
      ordered,
      check,
    );
    if (split) return split;
    // 初回の「これ以降」は「すべて」と同じ（§11）
  }
  const changes =
    current.rrule !== null
      ? allScopeChanges(db, current, patch.recurrenceId, rawChanges)
      : rawChanges;

  const fields = fieldsFromChanges(current, changes);
  if ('errors' in fields) throw validationError(fields.errors);
  const f = { ...fields.value, memberIds: orderMemberIds(db, fields.value.memberIds) };
  checkMembers(db, f.memberIds, current.memberIds);

  const now = clock.now();
  // 繰り返しの回の開始が変わるなら、例外・取り消しをリセットする（§11。件数を返す）
  const { next, discarded } = resetIfStartsChange(
    db,
    me,
    current,
    { ...current, ...f, version: current.version + 1, updatedBy: me.id, updatedAt: now },
    now,
  );
  const membersChanged =
    next.forEveryone !== current.forEveryone ||
    next.memberIds.join(',') !== current.memberIds.join(',');
  updateRecord(db, next, membersChanged);
  propagateToExceptions(db, next, now);
  const diff = describeDiff(current, next, memberNames(db));
  if (current.visibility === 'private' && next.visibility === 'family') {
    // 非公開だったときの件名・場所などを家族に見せない（T5）: 全部の差分は持ち主だけの行に、家族には「公開した」だけ
    recordActivity(db, clock, me.id, 'update', { ...next, visibility: 'private' }, diff);
    recordActivity(db, clock, me.id, 'update', next, ['家族に公開した']);
  } else {
    // 家族の予定を非公開にしたら、それまでの履歴もほかの家族から見えなくする（安全側。§24 D27）
    if (current.visibility === 'family' && next.visibility === 'private')
      hideActivityOf(db, id, next.ownerId);
    recordActivity(db, clock, me.id, 'update', next, diff);
  }
  recordChange(db, 'event', id, now);
  const event = projectEvent(next, me.id);
  return {
    status: 200,
    body: current.rrule !== null || next.rrule !== null ? { event, discarded } : { event },
  };
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

/**
 * 削除（ゴミ箱へ。§13）。繰り返しの予定は scope で範囲を選ぶ（§11）: this＝この回だけ（親の exdates に足す）、
 * following＝これ以降（前の回で終える。初回ならシリーズごと）、all＝シリーズごと
 */
export function deleteEvent(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  id: string,
  ifMatch: number | null,
  scope: Scope = 'all',
  recurrenceId: string | null = null,
): EventResult {
  const current = loadForWrite(db, id);
  authorize(current, me);
  checkVersion(current, ifMatch, me);
  if (current.rrule !== null && scope === 'this') {
    return deleteThisOccurrence(db, clock, me, current, requireRecurrenceId(recurrenceId));
  }
  if (current.rrule !== null && scope === 'following') {
    const r = deleteFollowing(db, clock, me, current, requireRecurrenceId(recurrenceId));
    if (r) return r;
  }
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

export function restoreEvent(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  id: string,
  recurrenceId: string | null = null,
): EventResult {
  const current = loadEvent(db, id);
  if (!current || current.parentId !== null) throw new ApiError(404, 'not_found');
  authorize(current, me);
  if (recurrenceId !== null) return restoreOccurrence(db, clock, me, current, recurrenceId);
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

/**
 * 「この回だけ削除」の取り消し（§6.1 の「元に戻す」）: 親の exdates から外し、その回の例外行をゴミ箱から戻す
 */
function restoreOccurrence(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  master: EventRecord,
  rid: string,
): EventResult {
  if (master.deletedAt !== null) throw new ApiError(410, 'gone');
  if (!master.exdates.includes(rid)) {
    return { status: 200, body: { event: projectEvent(master, me.id) } };
  }
  const now = clock.now();
  const since = now - TRASH_DAYS * 24 * 60 * 60 * 1000;
  const trashed = loadExceptions(db, master.id)
    .filter((e) => e.recurrenceId === rid && e.deletedAt !== null && e.deletedAt > since)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))[0];
  if (trashed) {
    updateRecord(
      db,
      {
        ...trashed,
        version: trashed.version + 1,
        deletedAt: null,
        deletedBy: null,
        updatedAt: now,
      },
      false,
    );
    recordChange(db, 'event', trashed.id, now);
  }
  const next: EventRecord = {
    ...master,
    exdates: master.exdates.filter((d) => d !== rid),
    version: master.version + 1,
    updatedAt: now,
    updatedBy: me.id,
  };
  updateRecord(db, next, false);
  recordActivity(db, clock, me.id, 'restore', next, [`${rid.slice(5, 10).replace('-', '/')} の回`]);
  recordChange(db, 'event', master.id, now);
  return { status: 200, body: { event: projectEvent(next, me.id) } };
}

/** ゴミ箱（見てよいもの。他人の非公開は出さない。§24 D22） */
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
