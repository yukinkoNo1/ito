import {
  type MeDTO,
  type MemberDTO,
  projectEvent,
  readMemberSettings,
  type SyncResponse,
  toIsoJst,
} from '@ito/core';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { DbLike } from '../db/client';
import { changes, type MemberRow } from '../db/schema';
import { countUnread } from './activity';
import { listAllMembers } from './members';
import { loadActiveEvents, loadEventsByIds } from './records';

export function toMemberDto(m: MemberRow): MemberDTO {
  return {
    id: m.id,
    name: m.name,
    mark: m.mark,
    color: m.color as MemberDTO['color'],
    role: m.role as MemberDTO['role'],
    disabled: m.disabledAt !== null,
    createdAt: toIsoJst(m.createdAt, true),
  };
}

export function toMeDto(m: MemberRow): MeDTO {
  let aliases: string[] = [];
  try {
    const v: unknown = JSON.parse(m.aliases);
    if (Array.isArray(v)) aliases = v.filter((x): x is string => typeof x === 'string');
  } catch {}
  return {
    id: m.id,
    name: m.name,
    mark: m.mark,
    color: m.color as MeDTO['color'],
    role: m.role as MeDTO['role'],
    aliases,
    settings: readMemberSettings(m.settings),
    activityReadAt: m.activityReadAt > 0 ? toIsoJst(m.activityReadAt, true) : null,
  };
}

/** 今のカーソル（changes の最後の seq。消したあとも sqlite_sequence に残る） */
function currentSeq(db: DbLike): number {
  const row = db.get<{ seq: number } | undefined>(
    sql`SELECT seq FROM sqlite_sequence WHERE name = 'changes'`,
  );
  return row?.seq ?? 0;
}

function minSeq(db: DbLike): number | null {
  const row = db.get<{ seq: number | null }>(sql`SELECT min(seq) AS seq FROM changes`);
  return row?.seq ?? null;
}

/**
 * 差分同期（§12）。cursor=0・古すぎる（changes が消えている）・未来のカーソルは全件（full: true）。
 * 予定は必ず projectEvent を通す。自分の reminder_prefs は Phase 4 で全件返す。
 */
export function buildSync(db: DbLike, me: MemberRow, cursor: number): SyncResponse {
  return db.transaction((tx) => {
    const seq = currentSeq(tx);
    const oldest = minSeq(tx);
    const full =
      cursor <= 0 || cursor > seq || (oldest === null ? cursor < seq : cursor < oldest - 1);

    let eventsOut: SyncResponse['events'] = [];
    const deletedEventIds: string[] = [];
    if (full) {
      eventsOut = loadActiveEvents(tx).map((r) => projectEvent(r, me.id));
    } else {
      const ids = tx
        .selectDistinct({ id: changes.entityId })
        .from(changes)
        .where(and(gt(changes.seq, cursor), eq(changes.entity, 'event')))
        .all()
        .map((r) => r.id);
      for (const r of loadEventsByIds(tx, ids)) {
        if (r.deletedAt !== null) deletedEventIds.push(r.id);
        else eventsOut.push(projectEvent(r, me.id));
      }
      // 完全に消えた予定（ゴミ箱の掃除のあと）も消す
      const found = new Set([...eventsOut.map((e) => e.id), ...deletedEventIds]);
      for (const id of ids) if (!found.has(id)) deletedEventIds.push(id);
    }

    return {
      cursor: seq,
      full,
      events: eventsOut,
      deletedEventIds,
      members: listAllMembers(tx).map(toMemberDto),
      myReminderPrefs: [],
      me: toMeDto(me),
      unreadActivity: countUnread(tx, me),
    };
  });
}
