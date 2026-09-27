import type { EventDTO } from '@ito/core';
import { members } from '../src/db/schema';
import { send, type TestContext } from './helpers';

export const IDS = {
  papa: '0192f5a0-1c00-7000-8000-000000000001',
  mama: '0192f5a0-1c00-7000-8000-000000000002',
  yuki: '0192f5a0-1c00-7000-8000-000000000003',
  haru: '0192f5a0-1c00-7000-8000-000000000004',
} as const;

export type Who = keyof typeof IDS;

export const LOGINS: Record<Who, string> = {
  papa: 'papa@example.com',
  mama: 'mama@example.com',
  yuki: 'yuki@example.com',
  haru: 'haru@example.com',
};

/** 例のファイル（§13.1）と同じ家族。作成順は 父 → 母 → ゆき → はる */
export function seedFamily(ctx: TestContext): void {
  const base = ctx.clock.now() - 10 * 24 * 60 * 60 * 1000;
  const rows = [
    {
      id: IDS.papa,
      login: LOGINS.papa,
      name: 'お父さん',
      mark: '父',
      color: 'kaki',
      role: 'admin',
    },
    {
      id: IDS.mama,
      login: LOGINS.mama,
      name: 'お母さん',
      mark: '母',
      color: 'wakatake',
      role: 'member',
    },
    { id: IDS.yuki, login: LOGINS.yuki, name: 'ゆき', mark: 'ゆ', color: 'fuji', role: 'member' },
    { id: IDS.haru, login: LOGINS.haru, name: 'はる', mark: 'は', color: 'asagi', role: 'member' },
  ];
  rows.forEach((r, i) => {
    ctx.database.db
      .insert(members)
      .values({
        ...r,
        aliases: '[]',
        settings: '{}',
        activityReadAt: 0,
        createdAt: base + i,
        updatedAt: base + i,
        disabledAt: null,
      })
      .run();
  });
}

/** 開発モードの X-Dev-Login でその人として送る */
export function as(who: Who): Record<string, string> {
  return { 'x-dev-login': LOGINS[who] };
}

let keySeq = 0;

export async function createEvent(
  ctx: TestContext,
  who: Who,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<{ res: Response; event: EventDTO }> {
  keySeq++;
  const res = await send(ctx, 'POST', '/api/events', {
    headers: { ...as(who), 'idempotency-key': `k-${keySeq}-${who}`, ...extraHeaders },
    body,
  });
  const json = (await res.clone().json()) as { event: EventDTO };
  return { res, event: json.event };
}

export async function patchEvent(
  ctx: TestContext,
  who: Who,
  id: string,
  version: number | null,
  changes: Record<string, unknown>,
  extra: Record<string, string> = {},
): Promise<Response> {
  return send(ctx, 'PATCH', `/api/events/${id}`, {
    headers: { ...as(who), ...(version !== null ? { 'if-match': String(version) } : {}), ...extra },
    body: { scope: 'all', changes },
  });
}

export async function deleteEvent(
  ctx: TestContext,
  who: Who,
  id: string,
  version: number | null,
): Promise<Response> {
  return send(ctx, 'DELETE', `/api/events/${id}`, {
    headers: { ...as(who), ...(version !== null ? { 'if-match': String(version) } : {}) },
  });
}

export async function syncAs(ctx: TestContext, who: Who, cursor = 0) {
  const res = await send(ctx, 'GET', `/api/sync?cursor=${cursor}`, { headers: as(who) });
  return (await res.json()) as {
    cursor: number;
    full: boolean;
    events: EventDTO[];
    deletedEventIds: string[];
    members: { id: string; name: string }[];
    unreadActivity: number;
  };
}

export const timed = (
  date: string,
  start: string,
  end: string | null,
  extra: Record<string, unknown> = {},
) => ({
  title: '予定',
  allDay: false,
  startAt: `${date}T${start}:00+09:00`,
  endAt: end ? `${date}T${end}:00+09:00` : null,
  ...extra,
});

export const allDay = (
  startDate: string,
  endDate: string,
  extra: Record<string, unknown> = {},
) => ({
  title: '終日',
  allDay: true,
  startDate,
  endDate,
  ...extra,
});
