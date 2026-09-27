import {
  type ActivityDTO,
  addDays,
  canSeeContent,
  type DateISO,
  diffDays,
  type EventCreateInput,
  type EventDTO,
  fromJst,
  type MemberDTO,
  type Occurrence,
  parseIsoToMs,
  type TrashItemDTO,
  todayJst,
  toJstParts,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import type { ActivityVM, EventDetailVM, EventDraftVM, TrashItemVM } from '../ui/types';
import {
  dayGroupLabel,
  detailDateLabel,
  detailTimeLabel,
  relativeTimeLabel,
  updatedLabel,
} from './labels';
import { toOccurrenceVM, type VmContext } from './occurrence';

function nameOf(members: MemberDTO[], id: string): string {
  return members.find((m) => m.id === id)?.name ?? '？';
}

/** 予定の詳細（S-04）。他人の非公開は編集できない（§14） */
export function buildDetail(
  occ: Occurrence<LocalEvent>,
  ctx: VmContext,
  allMembers: MemberDTO[],
  myReminders: number[] = [],
  reminderOptions: number[] = [],
): EventDetailVM {
  const vm = toOccurrenceVM(occ, ctx);
  const e = occ.event;
  return {
    occ: vm,
    dateLabel: detailDateLabel(vm.startDate, vm.endDate, vm.allDay),
    timeLabel: detailTimeLabel(vm.allDay, vm.startDate, vm.startTime, vm.endDate, vm.endTime),
    createdByName: nameOf(allMembers, e.createdBy),
    updatedLabel: updatedLabel(e.updatedAt ? nameOf(allMembers, e.updatedBy) : null, e.updatedAt),
    myReminders,
    reminderOptions,
    canEdit: canSeeContent(e, ctx.meId),
  };
}

export function buildActivity(items: ActivityDTO[], nowMs: number): ActivityVM[] {
  const today = todayJst(nowMs);
  return items.map((a) => {
    const ms = parseIsoToMs(a.createdAt) ?? nowMs;
    return {
      id: a.id,
      actorId: a.actorId,
      action: a.action,
      eventId: a.eventId,
      title: a.title,
      detail: a.detail,
      dayLabel: dayGroupLabel(toJstParts(ms).date, today),
      atLabel: relativeTimeLabel(ms, nowMs),
      unread: a.unread,
    };
  });
}

const TRASH_DAYS = 30;

function whenLabel(e: EventDTO): string {
  if (e.allDay) {
    const s = e.startDate as string;
    const d = toJstParts(fromJst(s));
    return `${d.month}/${d.day}(${'日月火水木金土'[d.weekday]})`;
  }
  const p = toJstParts(parseIsoToMs(e.startAt as string) ?? 0);
  return `${p.month}/${p.day}(${'日月火水木金土'[p.weekday]}) ${p.time}`;
}

export function buildTrash(
  items: TrashItemDTO[],
  members: MemberDTO[],
  nowMs: number,
): TrashItemVM[] {
  const today = todayJst(nowMs);
  return items.map((t) => {
    const deletedMs = parseIsoToMs(t.deletedAt) ?? nowMs;
    const deletedDay = toJstParts(deletedMs).date;
    const purgeDay: DateISO = addDays(deletedDay, TRASH_DAYS);
    const p = toJstParts(deletedMs);
    return {
      eventId: t.event.id,
      title: t.event.title ?? '予定あり',
      whenLabel: whenLabel(t.event),
      deletedByName: nameOf(members, t.deletedBy),
      deletedLabel: `${p.month}/${p.day} に削除`,
      daysLeft: Math.max(0, diffDays(today, purgeDay)),
    };
  });
}

/* ───────── 入力（S-05 の詳しく入力）───────── */

/** 空の下書き（日付・時刻を選んだ状態で開く。§16 の書く画面の決まり） */
export function emptyDraft(
  date: DateISO,
  meId: string,
  startTime: string | null = null,
): EventDraftVM {
  return {
    title: '',
    allDay: startTime === null,
    startDate: date,
    endDate: date,
    startTime,
    endTime: null,
    memberIds: [meId],
    forEveryone: false,
    location: '',
    note: '',
    recurrence: { kind: 'none' },
    recurrenceEnd: { kind: 'never' },
    myReminders: [],
    isPrivate: false,
    busy: startTime !== null,
  };
}

export function eventToDraft(e: EventDTO): EventDraftVM {
  const start = e.allDay ? null : toJstParts(parseIsoToMs(e.startAt as string) ?? 0);
  const end = e.allDay || !e.endAt ? null : toJstParts(parseIsoToMs(e.endAt) ?? 0);
  return {
    title: e.title ?? '',
    allDay: e.allDay,
    startDate: e.allDay ? (e.startDate as string) : (start?.date as string),
    endDate: e.allDay ? (e.endDate as string) : (end?.date ?? (start?.date as string)),
    startTime: start?.time ?? null,
    endTime: end?.time ?? null,
    memberIds: [...e.memberIds],
    forEveryone: e.forEveryone,
    location: e.location ?? '',
    note: e.note ?? '',
    recurrence: { kind: 'none' },
    recurrenceEnd: { kind: 'never' },
    myReminders: [],
    isPrivate: e.visibility === 'private',
    busy: e.busy,
  };
}

/** 下書き → 保存の本文（時刻ありは JST の ISO に。終わりが始まりより前の時刻なら翌日） */
export function draftToInput(d: EventDraftVM): EventCreateInput {
  const base = {
    title: d.title,
    note: d.note,
    location: d.location,
    memberIds:
      d.forEveryone || d.isPrivate ? (d.isPrivate ? d.memberIds.slice(0, 1) : []) : d.memberIds,
    forEveryone: d.isPrivate ? false : d.forEveryone,
    busy: d.busy,
    visibility: d.isPrivate ? ('private' as const) : ('family' as const),
  };
  if (d.allDay) {
    return {
      ...base,
      allDay: true,
      startDate: d.startDate,
      endDate: d.endDate < d.startDate ? d.startDate : d.endDate,
    };
  }
  const startTime = d.startTime ?? '09:00';
  const startAt = `${d.startDate}T${startTime}:00+09:00`;
  let endAt: string | null = null;
  if (d.endTime) {
    const endDate =
      d.endDate > d.startDate
        ? d.endDate
        : d.endTime <= startTime
          ? addDays(d.startDate, 1)
          : d.startDate;
    endAt = `${endDate}T${d.endTime}:00+09:00`;
  }
  return { ...base, allDay: false, startAt, endAt };
}
