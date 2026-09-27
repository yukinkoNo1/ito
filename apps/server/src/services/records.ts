import type { EventRecord, Visibility } from '@ito/core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { changes, type EventRow, eventMembers, events } from '../db/schema';

function parseExdates(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToRecord(row: EventRow, memberIds: string[]): EventRecord {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    note: row.note,
    location: row.location,
    allDay: row.allDay,
    startAt: row.startAt,
    endAt: row.endAt,
    startDate: row.startDate,
    endDate: row.endDate,
    rrule: row.rrule,
    exdates: parseExdates(row.exdates),
    parentId: row.parentId,
    recurrenceId: row.recurrenceId,
    memberIds,
    forEveryone: row.forEveryone,
    busy: row.busy,
    visibility: row.visibility as Visibility,
    ownerId: row.ownerId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    deletedBy: row.deletedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

/** 担当者 ID を、メンバーの作成順（created_at、同じなら id）で */
function memberIdsByEvent(db: DbLike, eventIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (eventIds.length === 0) return out;
  // SQLite の変数の上限を避けるため 500 件ずつ
  for (let i = 0; i < eventIds.length; i += 500) {
    const chunk = eventIds.slice(i, i + 500);
    const rows = db.all<{ event_id: string; member_id: string }>(sql`
      SELECT em.event_id, em.member_id FROM event_members em
      JOIN members m ON m.id = em.member_id
      WHERE em.event_id IN (${sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `,
      )})
      ORDER BY m.created_at, m.id`);
    for (const r of rows) {
      const list = out.get(r.event_id) ?? [];
      list.push(r.member_id);
      out.set(r.event_id, list);
    }
  }
  return out;
}

export function toRecords(db: DbLike, rows: EventRow[]): EventRecord[] {
  const map = memberIdsByEvent(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => rowToRecord(r, map.get(r.id) ?? []));
}

export function loadEvent(db: DbLike, id: string): EventRecord | null {
  const row = db.select().from(events).where(eq(events.id, id)).get();
  if (!row) return null;
  return toRecords(db, [row])[0] ?? null;
}

export function loadEventsByIds(db: DbLike, ids: string[]): EventRecord[] {
  const out: EventRow[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(
      ...db
        .select()
        .from(events)
        .where(inArray(events.id, ids.slice(i, i + 500)))
        .all(),
    );
  }
  return toRecords(db, out);
}

/** ゴミ箱にない予定（親と例外行） */
export function loadActiveEvents(db: DbLike): EventRecord[] {
  return toRecords(db, db.select().from(events).where(isNull(events.deletedAt)).all());
}

/** 例外行（この回だけ変更） */
export function loadExceptions(db: DbLike, parentId: string): EventRecord[] {
  return toRecords(db, db.select().from(events).where(eq(events.parentId, parentId)).all());
}

export function loadActiveExceptions(db: DbLike, parentId: string): EventRecord[] {
  return toRecords(
    db,
    db
      .select()
      .from(events)
      .where(and(eq(events.parentId, parentId), isNull(events.deletedAt)))
      .all(),
  );
}

/** 担当者を置き換える */
export function writeMembers(db: DbLike, eventId: string, memberIds: string[]): void {
  db.delete(eventMembers).where(eq(eventMembers.eventId, eventId)).run();
  for (const memberId of memberIds) db.insert(eventMembers).values({ eventId, memberId }).run();
}

/** 差分同期の元に積む */
export function recordChange(
  db: DbLike,
  entity: 'event' | 'member',
  entityId: string,
  now: number,
): void {
  db.insert(changes).values({ entity, entityId, createdAt: now }).run();
}

export function recordToRow(r: EventRecord): typeof events.$inferInsert {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    location: r.location,
    allDay: r.allDay,
    startAt: r.startAt,
    endAt: r.endAt,
    startDate: r.startDate,
    endDate: r.endDate,
    rrule: r.rrule,
    exdates: JSON.stringify(r.exdates),
    parentId: r.parentId,
    recurrenceId: r.recurrenceId,
    forEveryone: r.forEveryone,
    busy: r.busy,
    visibility: r.visibility,
    ownerId: r.ownerId,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    deletedBy: r.deletedBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    version: r.version,
  };
}

export function insertRecord(db: DbLike, r: EventRecord): void {
  db.insert(events).values(recordToRow(r)).run();
  writeMembers(db, r.id, r.forEveryone ? [] : r.memberIds);
}

export function updateRecord(db: DbLike, r: EventRecord, membersChanged: boolean): void {
  const { id: _id, ...rest } = recordToRow(r);
  db.update(events).set(rest).where(eq(events.id, r.id)).run();
  if (membersChanged) writeMembers(db, r.id, r.forEveryone ? [] : r.memberIds);
}
