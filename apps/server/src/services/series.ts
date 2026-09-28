import {
  type Clock,
  allScopeChanges as coreAllScopeChanges,
  dropUnchangedTimes,
  type EventChanges,
  type EventRecord,
  fieldsFromChanges,
  formatMdW,
  formatRrule,
  hasTimeChange,
  isAtOrAfter,
  isOccurrenceOf,
  isSeriesOccurrence,
  occurrenceFields,
  parseRrule,
  projectEvent,
  seriesLoss,
  shiftRule,
  splitSeries,
  toJstParts,
  uuidv7,
  wallOfRecurrenceId,
} from '@ito/core';
import { eq } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { events, type MemberRow } from '../db/schema';
import { ApiError } from '../errors';
import { validationError } from '../lib/validate';
import { describeDiff, hideActivityOf, memberNames, recordActivity } from './activity';
import { hidePendingNoticesOf } from './family-notices';
import { insertRecord, loadExceptions, recordChange, updateRecord } from './records';
import { copyReminderPrefs } from './reminders';
import { assertSeriesRoom } from './series-limit';

/**
 * 繰り返しの編集・削除の範囲（§11・§13）。`:id` は親（マスター）、If-Match は親の version（シリーズ単位の楽観ロック。
 * この回だけの変更・取り消しでも親の version を上げる。§24 D33）
 */

export type Scope = 'this' | 'following' | 'all';

export interface Discarded {
  exceptions: number;
  exdates: number;
}

const MOVE_ERROR = 'この日付には繰り返しを動かせません。繰り返しを選び直してください';

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
  if (!times) throw new ApiError(404, 'occurrence_not_found');
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

/**
 * 例外行を破棄する（§11「以降の例外は破棄」・「すべて」のリセット）。ゴミ箱には入れずに消す
 * （利用者が消したものではなく、C-04 で件数を見せて確かめたうえでシリーズの変更に置き換えたもの。
 * ゴミ箱に残すと「この回だけ削除」の取り消しで戻ってしまう。§24 D34）。同期には changes で消えたことを伝える
 */
function discardExceptions(
  db: DbLike,
  master: EventRecord,
  lost: (rid: string) => boolean,
  now: number,
): number {
  let n = 0;
  for (const ex of loadExceptions(db, master.id)) {
    if (ex.deletedAt !== null || !ex.recurrenceId || !lost(ex.recurrenceId)) continue;
    db.delete(events).where(eq(events.id, ex.id)).run();
    recordChange(db, 'event', ex.id, now);
    n++;
  }
  return n;
}

/** rid がシリーズの回か、有効な例外行のある回か（なければ 404） */
function requireOccurrence(db: DbLike, master: EventRecord, rid: string): void {
  if (isSeriesOccurrence(master, rid)) return;
  // 例外行で動かした回でも、元の回がシリーズにあればよい
  const hasException = loadExceptions(db, master.id).some(
    (e) => e.recurrenceId === rid && e.deletedAt === null,
  );
  if (!hasException) throw new ApiError(404, 'occurrence_not_found');
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

/** 1 つの繰り返しで取り消せる回の数（作るときの exdates の上限と同じ。§13） */
export const MAX_EXDATES = 1000;

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
  // 取り消した回は作るときと同じく 1000 回まで（行が際限なく大きくならないように。総点検 B3）
  if (exdates.length > MAX_EXDATES) {
    throw validationError([
      { field: 'recurrenceId', message: `この繰り返しで取り消せる回は ${MAX_EXDATES} 回までです` },
    ]);
  }
  const next = bumpMaster(db, me, master, now, { exdates });
  recordActivity(db, clock, me.id, 'delete', base, [`${ridLabel(rid)} の回だけ`]);
  return { status: 200, body: { event: projectEvent(next, me.id) } };
}

/**
 * 「この回だけ変更」を元に戻す（§6.1 の「元に戻す」。§24 D34）: 例外行を消して、シリーズどおりの回に戻す。
 * 例外行がなければ何もしない
 */
export function revertThisOccurrence(
  db: DbLike,
  clock: Clock,
  me: MemberRow,
  master: EventRecord,
  rid: string,
): { status: 200; body: { event: ReturnType<typeof projectEvent> } } {
  const exception = loadExceptions(db, master.id).find(
    (e) => e.recurrenceId === rid && e.deletedAt === null,
  );
  if (!exception) return { status: 200, body: { event: projectEvent(master, me.id) } };
  const now = clock.now();
  db.delete(events).where(eq(events.id, exception.id)).run();
  recordChange(db, 'event', exception.id, now);
  const next = bumpMaster(db, me, master, now);
  recordActivity(db, clock, me.id, 'update', exception, [`${ridLabel(rid)} の回を元に戻した`]);
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
  requireOccurrence(db, master, rid);
  const split = splitSeries(master, rid);
  if (!split) return null;
  const times = occurrenceFields(master, rid);
  if (!times) throw new ApiError(404, 'occurrence_not_found');
  const tailBase: EventRecord = { ...master, ...times, rrule: split.tailRrule, exdates: [] };
  // 件名だけ直したときに、例外で動かした日時を変更と取り違えない（§24 D34）
  const { base } = currentOccurrence(db, master, rid);
  const dropped = dropUnchangedTimes(base, changes);
  if ('errors' in dropped) throw validationError(dropped.errors);
  // 日付を動かしたら、曜日・日の指定も動かした先に合わせる（rrule を変えていなければ）
  let tailChanges = dropped.changes;
  if (tailChanges.rrule === undefined && hasTimeChange(tailChanges)) {
    const moved = fieldsFromChanges(tailBase, tailChanges);
    if ('errors' in moved) throw validationError(moved.errors);
    const from = times.startDate ?? toJstParts(times.startAt ?? 0).date;
    const to = moved.value.startDate ?? toJstParts(moved.value.startAt ?? 0).date;
    const parsed = parseRrule(split.tailRrule);
    if (parsed.ok && from !== to) {
      const shifted = shiftRule(parsed.rule, from, to);
      if (!shifted) throw validationError([{ field: 'startAt', message: MOVE_ERROR }]);
      tailChanges = { ...tailChanges, rrule: formatRrule(shifted) };
    }
  }
  const fields = fieldsFromChanges(tailBase, tailChanges);
  if ('errors' in fields) throw validationError(fields.errors);
  const f = { ...fields.value, memberIds: ordered(fields.value.memberIds) };
  checkMembers(f.memberIds, master.memberIds);
  // 新しいシリーズの開始がその規則の回になるか（ならなければ、始まりの回がない予定になる）
  if (f.rrule) {
    const rule = parseRrule(f.rrule);
    const p = toJstParts(f.startAt ?? 0);
    const start = f.allDay
      ? { date: f.startDate ?? '', time: '00:00' }
      : { date: p.date, time: p.time };
    if (rule.ok && !isOccurrenceOf(rule.rule, start, start)) {
      throw validationError([{ field: 'startAt', message: MOVE_ERROR }]);
    }
  }
  const now = clock.now();
  const id = newId ?? uuidv7(now);
  checkUnusedId(db, id);
  // 「これ以降」は新しいシリーズ（持ち主は元のシリーズと同じ）を作る（持ち主ごとに 100 件まで。§24 D41）。
  // 繰り返しを外すなら増えない
  if (f.rrule) assertSeriesRoom(db, clock, master.ownerId, f);
  const exceptions = discardExceptions(db, master, (r) => isAtOrAfter(r, rid), now);
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
  // 何を変えたかは新しいシリーズの行に（見える人は新しいシリーズの公開・非公開に従う）
  const diff = [`${ridLabel(rid)} 以降を変更`, ...describeDiff(tailBase, created, memberNames(db))];
  if (master.visibility === 'private' && created.visibility === 'family') {
    // 非公開だったときの件名・場所などを家族に見せない（T5。scope=all と同じ。総点検 A7）:
    // 全部の差分は持ち主だけの行に、家族には「公開した」だけ
    recordActivity(db, clock, me.id, 'create', { ...created, visibility: 'private' }, diff);
    recordActivity(db, clock, me.id, 'create', created, [
      `${ridLabel(rid)} 以降を変更`,
      '家族に公開した',
    ]);
  } else {
    // 家族の繰り返しの「これ以降」を非公開にしたら、それまでの履歴もほかの家族から見えなくする
    // （回ごとの履歴はシリーズの ID に付くので、シリーズの履歴をまとめて持ち主だけにする。安全側。§24 D27・総点検 A9）
    if (master.visibility === 'family' && created.visibility === 'private') {
      hideActivityOf(db, master.id, master.ownerId);
      // 送る前のまとめ待ち（ほかの家族が書いた「この回だけ」の件名など）も伏せる（総点検のレビュー C4）
      hidePendingNoticesOf(db, master.id, master.ownerId);
    }
    recordActivity(db, clock, me.id, 'create', created, diff);
  }
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
  requireOccurrence(db, master, rid);
  const split = splitSeries(master, rid);
  if (!split) return null;
  const now = clock.now();
  const exceptions = discardExceptions(db, master, (r) => isAtOrAfter(r, rid), now);
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
 * 「すべて」の変更をマスターの changes にする（§11）。日時は回の今の中身と違うときだけ変更とし、
 * 選んだ回の元の日時からの差分をマスターに当てる（core の allScopeChanges。§24 D34）
 */
export function allScopeChanges(
  db: DbLike,
  master: EventRecord,
  rid: string | null | undefined,
  changes: EventChanges,
): EventChanges {
  if (!rid || !master.rrule) return changes;
  requireOccurrence(db, master, rid);
  const { base } = currentOccurrence(db, master, rid);
  const r = coreAllScopeChanges(master, rid, base, changes);
  if ('errors' in r) throw validationError(r.errors);
  return r.changes;
}

/**
 * 「すべて」の変更で消える例外・取り消しを消す（§11。件数を返す）。開始が変われば全部、規則だけが変われば
 * 新しい規則で回にならないものだけ（core の seriesLoss。C-04 の件数と同じ計算。§24 D34）
 */
export function resetIfStartsChange(
  db: DbLike,
  before: EventRecord,
  after: EventRecord,
  now: number,
): { next: EventRecord; discarded: Discarded } {
  if (!before.rrule) return { next: after, discarded: { exceptions: 0, exdates: 0 } };
  const active = loadExceptions(db, before.id).filter(
    (e) => e.deletedAt === null && e.recurrenceId !== null,
  );
  const loss = seriesLoss(
    before,
    after,
    active.map((e) => e.recurrenceId as string),
  );
  const lost = new Set(loss.exceptions);
  const exceptions = discardExceptions(db, before, (r) => lost.has(r), now);
  const lostExdates = new Set(loss.exdates);
  return {
    next: { ...after, exdates: before.exdates.filter((d) => !lostExdates.has(d)) },
    discarded: { exceptions, exdates: loss.exdates.length },
  };
}
