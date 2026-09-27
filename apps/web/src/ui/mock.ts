import {
  type ActivityDTO,
  addDays,
  createLocally,
  dtoToRecord,
  eventCreateSchema,
  type MeDTO,
  type MemberDTO,
  memberSettingsSchema,
  parseIsoToMs,
  projectEvent,
  type TrashItemDTO,
  toIsoJst,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import { buildComposerVM, QUICK_TIMES, quickDates } from '../viewmodels/composer-vm';
import {
  buildActivity,
  buildDetail,
  buildTrash,
  emptyDraft,
  eventToDraft,
} from '../viewmodels/detail';
import {
  occurrencesBetween,
  toMemberVMs,
  toOccurrenceVM,
  type VmContext,
} from '../viewmodels/occurrence';
import { buildSettingsVM } from '../viewmodels/screens';
import {
  MOCK_EVENTS,
  MOCK_ME,
  MOCK_MEMBERS,
  MOCK_NOW_ISO,
  MOCK_TODAY,
  type MockMemberKey,
  toCreateBody,
} from './mock-data';
import type {
  AdminMemberVM,
  ComposerVM,
  EventDetailVM,
  FreeTimeVM,
  MemberVM,
  OccurrenceVM,
  SearchGroupVM,
  SettingsVM,
  TrashItemVM,
} from './types';

/**
 * ギャラリーの見本（§22 の型）。本番と同じ viewmodels で作る（ギャラリーと本番の画面を比べるため。§24 D31）。
 * 素のデータは mock-data.ts（E2E も同じ予定を API で入れる）
 */

export { MOCK_TODAY };
export const MOCK_NOW = parseIsoToMs(MOCK_NOW_ISO) ?? 0;

function memberId(key: MockMemberKey): string {
  const m = MOCK_MEMBERS.find((x) => x.key === key);
  if (!m) throw new Error(`見本の家族がいません: ${key}`);
  return m.id;
}

export const MOCK_ME_ID = memberId(MOCK_ME);

export const mockMembers: MemberDTO[] = MOCK_MEMBERS.map((m, i) => ({
  id: m.id,
  name: m.name,
  mark: m.mark,
  color: m.color,
  role: m.role,
  disabled: false,
  createdAt: `2030-09-01T00:00:0${i}.000+09:00`,
}));

export const mockMemberVMs: MemberVM[] = toMemberVMs(mockMembers, MOCK_ME_ID);

/** 8 人家族の見本（残りの 4 色と、5〜8 人の糸・札の並び。ギャラリーの flow-8 だけで使う） */
const EXTRA = [
  ['ばあば', 'ば', 'wakakusa'],
  ['じいじ', 'じ', 'fuji'],
  ['おば', 'お', 'ruri'],
  ['めい', 'め', 'kaki'],
] as const;

export const mockMembers8: MemberDTO[] = [
  ...mockMembers,
  ...EXTRA.map(([name, mark, color], i) => ({
    id: `0192f5a0-1c00-7000-8000-00000000a0${i + 5}0`,
    name,
    mark,
    color,
    role: 'member' as const,
    disabled: false,
    createdAt: `2030-09-01T00:00:1${i}.000+09:00`,
  })),
];

/** 8 人家族の見本の予定（足した 4 人にも今日と明日の予定を 1 件ずつ） */
export function mockEvents8(): LocalEvent[] {
  const extra = mockMembers8.slice(mockMembers.length).map((m, i) => {
    const body = eventCreateSchema.parse({
      title: `${m.name}の予定`,
      allDay: false,
      startAt: `2030-09-${29 + (i % 2)}T${String(9 + i).padStart(2, '0')}:00:00+09:00`,
      memberIds: [m.id],
    });
    const made = createLocally(
      body,
      `0192f5b0-0000-7000-8000-0000000008${i}0`,
      m.id,
      MOCK_NOW - 86_400_000,
    );
    if (!('value' in made)) throw new Error('見本の予定が作れません');
    return { ...made.value, version: 1, sync: 'synced' as const };
  });
  return [...mockEvents(), ...extra];
}

export const mockMe: MeDTO = {
  id: MOCK_ME_ID,
  name: 'お父さん',
  mark: '父',
  color: 'yamabuki',
  role: 'admin',
  aliases: ['父', 'パパ'],
  settings: memberSettingsSchema.parse({}),
  activityReadAt: null,
};

/** 「新」の見本に使う予定（家族が 30 分前に足した） */
const FRESH_KEYS = new Set(['dentist', 'pta']);

/** 見本の予定（自分＝お父さんから見た投影。他人の非公開は「予定あり」） */
export function mockEvents(): LocalEvent[] {
  return MOCK_EVENTS.map((e, i) => {
    const input = eventCreateSchema.parse(toCreateBody(e, memberId));
    const created = FRESH_KEYS.has(e.key) ? MOCK_NOW - 30 * 60_000 : MOCK_NOW - 7 * 86_400_000;
    const id = `0192f5b0-0000-7000-8000-${String(i + 1).padStart(12, '0')}`;
    const made = createLocally(input, id, memberId(e.by), created);
    if (!('value' in made)) throw new Error(`見本の予定が作れません: ${e.key}`);
    const projected = projectEvent(dtoToRecord({ ...made.value, version: 1 }), MOCK_ME_ID);
    return { ...projected, sync: 'synced' as const };
  });
}

export function mockEventId(key: string): string {
  const i = MOCK_EVENTS.findIndex((e) => e.key === key);
  return `0192f5b0-0000-7000-8000-${String(i + 1).padStart(12, '0')}`;
}

export function mockContext(extra: Partial<VmContext> = {}): VmContext {
  return {
    nowMs: MOCK_NOW,
    today: MOCK_TODAY,
    meId: MOCK_ME_ID,
    members: mockMembers,
    freshSince: null,
    ...extra,
  };
}

/** 「新」が付く見本（前回開いたのが 1 時間前） */
export const MOCK_FRESH_SINCE = MOCK_NOW - 60 * 60_000;

/* ───────── 詳細・競合・書く ───────── */

export function mockOccurrence(key: string, events: LocalEvent[] = mockEvents()) {
  const id = mockEventId(key);
  const occ = occurrencesBetween(events, addDays(MOCK_TODAY, -30), addDays(MOCK_TODAY, 60)).find(
    (o) => o.event.id === id,
  );
  if (!occ) throw new Error(`見本の回がありません: ${key}`);
  return occ;
}

export function mockDetail(key: string, events: LocalEvent[] = mockEvents()): EventDetailVM {
  return buildDetail(mockOccurrence(key, events), mockContext(), mockMembers);
}

/** 競合の見本: 家族（お母さん）は時刻を、自分は場所を変えた */
export function mockConflict(): { mine: OccurrenceVM; theirs: OccurrenceVM } {
  const base = toOccurrenceVM(mockOccurrence('dentist'), mockContext());
  return {
    mine: { ...base, location: '駅前歯科（2階）', sync: 'conflict' },
    theirs: { ...base, startTime: '17:00', endTime: '17:30', sync: 'synced' },
  };
}

export function mockComposer(extra: Partial<ComposerVM> = {}, editingKey?: string): ComposerVM {
  const events = mockEvents();
  const draft = editingKey
    ? eventToDraft(mockOccurrence(editingKey, events).event)
    : emptyDraft(MOCK_TODAY, MOCK_ME_ID);
  return {
    ...buildComposerVM({
      mode: 'quick',
      editing: Boolean(editingKey),
      text: editingKey ? draft.title : '',
      draft,
      today: MOCK_TODAY,
      nowMs: MOCK_NOW,
      events,
      members: mockMemberVMs,
      saving: false,
      error: null,
    }),
    ...extra,
  };
}

export const mockQuickDates = quickDates(MOCK_TODAY);
export const mockQuickTimes = QUICK_TIMES;

/* ───────── 空き時間（Phase 7 でつなぐ。形だけの見本） ───────── */

export function mockFreeTime(kind: 'found' | 'empty'): FreeTimeVM {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(MOCK_TODAY, i);
    return {
      date,
      weekday: ((i + 0) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      holiday: null,
      busy:
        kind === 'empty'
          ? [{ memberId: MOCK_ME_ID, startMin: 17 * 60, endMin: 24 * 60, label: '仕事' }]
          : i === 0
            ? [
                { memberId: memberId('mama'), startMin: 18 * 60, endMin: 20 * 60, label: '夕食' },
                {
                  memberId: memberId('saki'),
                  startMin: 19 * 60 + 30,
                  endMin: 20 * 60 + 30,
                  label: null,
                },
              ]
            : [],
      commonFree:
        kind === 'empty'
          ? []
          : i === 0
            ? [{ startMin: 20 * 60 + 30, endMin: 24 * 60 }]
            : [{ startMin: 17 * 60, endMin: 24 * 60 }],
    };
  });
  return {
    rangeLabel: '9/29(日) – 10/5(土)',
    preset: 'evenings',
    dayStartMin: 17 * 60,
    dayEndMin: 24 * 60,
    minDuration: 120,
    memberIds: MOCK_MEMBERS.map((m) => m.id),
    candidates:
      kind === 'empty'
        ? []
        : [
            {
              date: '2030-09-29',
              label: '9/29(日) 20:30–24:00',
              startMin: 20 * 60 + 30,
              endMin: 24 * 60,
            },
            {
              date: '2030-09-30',
              label: '9/30(月) 17:00–24:00',
              startMin: 17 * 60,
              endMin: 24 * 60,
            },
            {
              date: '2030-10-01',
              label: '10/1(火) 17:00–24:00',
              startMin: 17 * 60,
              endMin: 24 * 60,
            },
          ],
    days,
  };
}

/* ───────── 設定・家族の管理 ───────── */

export const mockAdminMembers: AdminMemberVM[] = MOCK_MEMBERS.map((m, i) => ({
  id: m.id,
  name: m.name,
  mark: m.mark,
  color: m.color,
  isMe: m.key === MOCK_ME,
  login: m.login,
  role: m.role,
  disabled: false,
  deviceCount: i === 3 ? 0 : 1,
}));

export function mockSettings(extra: Partial<SettingsVM> = {}): SettingsVM {
  return {
    ...buildSettingsVM({
      me: mockMe,
      members: mockMembers,
      adminMembers: mockAdminMembers,
      textSize: 'standard',
      permission: 'granted',
      devices: [{ id: 'd1', label: 'iPhone', lastUsedLabel: '今日', isThisDevice: true }],
      install: { platform: 'ios', installed: true },
      appVersion: '0.1.0',
    }),
    ...extra,
  };
}

/* ───────── 履歴・ゴミ箱・検索 ───────── */

function at(minutesAgo: number): string {
  return toIsoJst(MOCK_NOW - minutesAgo * 60_000, true);
}

export function mockActivity(read: boolean) {
  const items: ActivityDTO[] = [
    {
      id: '0192f5c0-0000-7000-8000-000000000001',
      actorId: memberId('mama'),
      action: 'create',
      eventId: mockEventId('dentist'),
      title: '歯医者',
      detail: null,
      createdAt: at(30),
      unread: !read,
    },
    {
      id: '0192f5c0-0000-7000-8000-000000000002',
      actorId: memberId('mama'),
      action: 'update',
      eventId: mockEventId('yoga'),
      title: 'ヨガ',
      detail: '開始 9:00 → 10:00',
      createdAt: at(180),
      unread: !read,
    },
    {
      id: '0192f5c0-0000-7000-8000-000000000003',
      actorId: memberId('saki'),
      action: 'delete',
      eventId: '0192f5b0-0000-7000-8000-000000000099',
      title: '買い物',
      detail: null,
      createdAt: at(26 * 60),
      unread: false,
    },
  ];
  return buildActivity(items, MOCK_NOW);
}

export function mockTrash(): TrashItemVM[] {
  const deleted = mockEvents()[0];
  if (!deleted) return [];
  const items: TrashItemDTO[] = [
    {
      event: { ...deleted, id: '0192f5b0-0000-7000-8000-000000000099', title: '買い物' },
      deletedAt: at(26 * 60),
      deletedBy: memberId('saki'),
    },
  ];
  return buildTrash(items, mockMembers, MOCK_NOW);
}

export function mockSearch(query: string): SearchGroupVM[] {
  const ctx = mockContext();
  const occs = occurrencesBetween(mockEvents(), addDays(MOCK_TODAY, -30), addDays(MOCK_TODAY, 60))
    .map((o) => toOccurrenceVM(o, ctx))
    .filter((o) => query && (o.title ?? '').includes(query));
  const groups = new Map<string, OccurrenceVM[]>();
  for (const o of occs) groups.set(o.startDate, [...(groups.get(o.startDate) ?? []), o]);
  return [...groups.entries()].map(([date, items]) => {
    const [, m, d] = date.split('-').map(Number);
    return { dateLabel: `${m}月${d}日`, items };
  });
}
