import {
  type ActivityDTO,
  addDays,
  canSeeContent,
  type DateISO,
  diffDays,
  type EventCreateInput,
  type EventDTO,
  expand,
  fromJst,
  fromPreset,
  type MemberDTO,
  type Occurrence,
  occurrenceTimes,
  parseIsoToMs,
  type TrashItemDTO,
  todayJst,
  toJstParts,
  toPreset,
  wallOfRecurrenceId,
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 予定の回を探す。recurrenceId があればその回（例外行で動かした回はその日時のまわり）だけを展開する
 * （長い繰り返しでも 2,000 回の打ち切りに当たらないように）。なければ最初の回
 */
export function findOccurrence(
  event: LocalEvent,
  overrides: LocalEvent[],
  recurrenceId: string | null,
): Occurrence<LocalEvent> | null {
  if (!recurrenceId) {
    const all = expand(event, overrides, fromJst('1970-01-01'), fromJst(addDays('2100-12-31', 1)));
    return all[0] ?? null;
  }
  const wall = wallOfRecurrenceId(recurrenceId);
  if (!wall) return null;
  const override = overrides.find((o) => o.recurrenceId === recurrenceId);
  const moved = override ? occurrenceTimes(override) : null;
  const center = moved?.startMs ?? fromJst(wall.date, wall.time);
  return (
    expand(event, overrides, center - 3 * DAY_MS, center + 3 * DAY_MS).find(
      (o) => o.recurrenceId === recurrenceId,
    ) ?? null
  );
}

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
    ...recurrenceOf(e),
    myReminders: [],
    isPrivate: e.visibility === 'private',
    busy: e.busy,
  };
}

/** 予定の繰り返し → 書く画面の形（§22 RecurrenceVM・RecurrenceEndVM） */
function recurrenceOf(e: EventDTO): Pick<EventDraftVM, 'recurrence' | 'recurrenceEnd'> {
  const start = e.allDay
    ? (e.startDate as string)
    : toJstParts(parseIsoToMs(e.startAt as string) ?? 0).date;
  const preset = toPreset(e.rrule, start);
  return { recurrence: preset.recurrence, recurrenceEnd: preset.end };
}

/** 下書き → 保存の本文（時刻ありは JST の ISO に。終わりが始まりより前の時刻なら翌日） */
export function draftToInput(d: EventDraftVM): EventCreateInput {
  // 繰り返し（§11）: なしは null、UI で作れない形（カスタム）は今のまま（本文に入れない）
  const rrule = fromPreset(d.recurrence, d.recurrenceEnd, d.allDay);
  const base = {
    ...(rrule === undefined ? {} : { rrule }),
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
    // 時刻ありの予定は開始日の翌日までに終わる（§10）。終わりの時刻が始まり以前なら翌日、
    // 明示的に翌日を選んでいれば翌日、それ以外は同じ日（開始日を動かしたあとの古い終わりの日は使わない）
    const nextDay = addDays(d.startDate, 1);
    const endDate = d.endTime <= startTime || d.endDate === nextDay ? nextDay : d.startDate;
    endAt = `${endDate}T${d.endTime}:00+09:00`;
  }
  return { ...base, allDay: false, startAt, endAt };
}
