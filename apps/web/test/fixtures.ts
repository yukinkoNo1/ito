import type { EventDTO, MemberDTO } from '@ito/core';
import type { LocalEvent } from '../src/data/db';
import type { VmContext } from '../src/viewmodels/occurrence';

export const M = {
  papa: '0192f5a0-1c00-7000-8000-000000000001',
  mama: '0192f5a0-1c00-7000-8000-000000000002',
  yuki: '0192f5a0-1c00-7000-8000-000000000003',
  haru: '0192f5a0-1c00-7000-8000-000000000004',
};

export const members: MemberDTO[] = [
  {
    id: M.papa,
    name: 'お父さん',
    mark: '父',
    color: 'kaki',
    role: 'admin',
    disabled: false,
    createdAt: '2026-09-01T00:00:00+09:00',
  },
  {
    id: M.mama,
    name: 'お母さん',
    mark: '母',
    color: 'wakatake',
    role: 'member',
    disabled: false,
    createdAt: '2026-09-01T00:00:01+09:00',
  },
  {
    id: M.yuki,
    name: 'ゆき',
    mark: 'ゆ',
    color: 'fuji',
    role: 'member',
    disabled: false,
    createdAt: '2026-09-01T00:00:02+09:00',
  },
  {
    id: M.haru,
    name: 'はる',
    mark: 'は',
    color: 'asagi',
    role: 'member',
    disabled: false,
    createdAt: '2026-09-01T00:00:03+09:00',
  },
];

let n = 0;
export function ev(extra: Partial<EventDTO> & { title?: string | null }): LocalEvent {
  n++;
  const id = `0192f5b1-0000-7000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    version: 1,
    title: '予定',
    note: null,
    location: null,
    allDay: false,
    startAt: '2026-09-29T10:00:00+09:00',
    endAt: null,
    rrule: null,
    exdates: [],
    parentId: null,
    recurrenceId: null,
    memberIds: [M.mama],
    forEveryone: false,
    busy: true,
    visibility: 'family',
    ownerId: M.mama,
    createdBy: M.mama,
    updatedBy: M.mama,
    createdAt: '2026-09-20T10:00:00+09:00',
    updatedAt: '2026-09-20T10:00:00+09:00',
    sync: 'synced',
    ...extra,
  } as LocalEvent;
}

export function allDayEv(
  startDate: string,
  endDate: string,
  extra: Partial<EventDTO> = {},
): LocalEvent {
  const e = ev({ allDay: true, busy: startDate !== endDate, ...extra });
  delete (e as Partial<EventDTO>).startAt;
  delete (e as Partial<EventDTO>).endAt;
  return { ...e, startDate, endDate };
}

/** 2026-09-29(火) 07:30、お父さんとして */
export function ctx(extra: Partial<VmContext> = {}): VmContext {
  return {
    nowMs: Date.UTC(2026, 8, 28, 22, 30),
    today: '2026-09-29',
    meId: M.papa,
    members,
    freshSince: null,
    ...extra,
  };
}
