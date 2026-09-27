import {
  type DateISO,
  type EventDTO,
  expandAll,
  fromJst,
  type MemberDTO,
  type Occurrence,
  parseIsoToMs,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import type { MemberVM, OccurrenceVM } from '../ui/types';

export interface VmContext {
  nowMs: number;
  today: DateISO;
  meId: string;
  /** 有効なメンバー（作成順） */
  members: MemberDTO[];
  /** この端末で前回開いた時刻（新着の印。F-21）。null なら印を付けない */
  freshSince: number | null;
  /** 繰り返しの説明（Phase 3 で describe をつなぐ） */
  describeRrule?: (rrule: string) => string | null;
}

export function activeMembers(members: MemberDTO[]): MemberDTO[] {
  return members.filter((m) => !m.disabled);
}

export function toMemberVMs(members: MemberDTO[], meId: string): MemberVM[] {
  return activeMembers(members).map((m) => ({
    id: m.id,
    name: m.name,
    mark: m.mark,
    color: m.color,
    isMe: m.id === meId,
  }));
}

/** 家族が追加・変更した予定か（updatedAt が前回開いた時刻より新しく、updatedBy が自分でない。§12 F-21） */
export function isFresh(e: EventDTO, ctx: Pick<VmContext, 'freshSince' | 'meId'>): boolean {
  if (ctx.freshSince === null || e.updatedAt === null || e.updatedBy === ctx.meId) return false;
  const at = parseIsoToMs(e.updatedAt);
  return at !== null && at > ctx.freshSince;
}

export function toOccurrenceVM(occ: Occurrence<LocalEvent>, ctx: VmContext): OccurrenceVM {
  const e = occ.event;
  const allIds = activeMembers(ctx.members).map((m) => m.id);
  return {
    key: occ.key,
    eventId: occ.seriesId,
    title: e.title,
    allDay: occ.allDay,
    startDate: occ.startDate,
    endDate: occ.endDate,
    startTime: occ.startTime,
    endTime: occ.endTime,
    memberIds: e.forEveryone ? allIds : [...e.memberIds],
    forEveryone: e.forEveryone,
    location: e.location,
    note: e.note,
    recurrenceLabel: e.rrule && ctx.describeRrule ? ctx.describeRrule(e.rrule) : null,
    isPrivate: e.visibility === 'private',
    busy: e.busy,
    sync: e.sync,
    fresh: isFresh(e, ctx),
  };
}

/** [from, to) の日付の範囲の回（並べ済み） */
export function occurrencesBetween(
  events: LocalEvent[],
  from: DateISO,
  to: DateISO,
): Occurrence<LocalEvent>[] {
  return expandAll(events, fromJst(from), fromJst(to));
}

/** 絞り込み: null = 全員 / [id] = その人（全員の予定を含む） */
export function matchesFilter(
  o: Pick<OccurrenceVM, 'memberIds' | 'forEveryone'>,
  filter: string[] | null,
): boolean {
  if (!filter || filter.length === 0) return true;
  if (o.forEveryone) return true;
  return o.memberIds.some((id) => filter.includes(id));
}
