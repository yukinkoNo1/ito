import type { EventChangesInput, EventCreateInput, EventDTO } from '@ito/core';

/**
 * 2 つの状態の差分を PATCH の changes にする（送信待ちを畳むとき・競合で自分の変更を送り直すとき）。
 * 終日と時刻ありが入れ替わったときは、新しい側の日時の組をそろえて送る。
 */
export function diffChanges(before: EventDTO, after: EventDTO): EventChangesInput {
  const out: EventChangesInput = {};
  if (before.title !== after.title && after.title !== null) out.title = after.title;
  if (before.note !== after.note) out.note = after.note;
  if (before.location !== after.location) out.location = after.location;
  if (before.allDay !== after.allDay) {
    out.allDay = after.allDay;
    if (after.allDay) {
      out.startDate = after.startDate ?? null;
      out.endDate = after.endDate ?? null;
    } else {
      out.startAt = after.startAt ?? null;
      out.endAt = after.endAt ?? null;
    }
  } else if (after.allDay) {
    if (before.startDate !== after.startDate) out.startDate = after.startDate ?? null;
    if (before.endDate !== after.endDate) out.endDate = after.endDate ?? null;
  } else {
    if (before.startAt !== after.startAt) out.startAt = after.startAt ?? null;
    if ((before.endAt ?? null) !== (after.endAt ?? null)) out.endAt = after.endAt ?? null;
  }
  if (before.rrule !== after.rrule) out.rrule = after.rrule;
  if (before.memberIds.join(',') !== after.memberIds.join(','))
    out.memberIds = [...after.memberIds];
  if (before.forEveryone !== after.forEveryone) out.forEveryone = after.forEveryone;
  if (before.busy !== after.busy) out.busy = after.busy;
  if (before.visibility !== after.visibility) out.visibility = after.visibility;
  return out;
}

/** 手元の予定 → 作成の本文（作成がまだ送られていないうちに変えたとき、作成 1 件に畳む） */
export function dtoToCreateBody(e: EventDTO): EventCreateInput {
  const base: EventCreateInput = {
    id: e.id,
    title: e.title ?? '',
    note: e.note,
    location: e.location,
    allDay: e.allDay,
    rrule: e.rrule,
    memberIds: [...e.memberIds],
    forEveryone: e.forEveryone,
    busy: e.busy,
    visibility: e.visibility,
  };
  return e.allDay
    ? { ...base, startDate: e.startDate ?? null, endDate: e.endDate ?? null }
    : { ...base, startAt: e.startAt ?? null, endAt: e.endAt ?? null };
}
