/**
 * ギャラリーと E2E が共有する見本のデータ（import なしの素のデータ。E2E は同じ予定を API で入れて、
 * ギャラリーの状態と本番の画面のスクリーンショットを比べる。§23 Phase 6・§24 D31）。
 * 日付は、ほかの E2E が作る予定（実際の日付の近く）と重ならないように先の年にしている。
 */

export const MOCK_TODAY = '2030-09-29'; // 日曜日
export const MOCK_NOW_ISO = '2030-09-29T14:18:00+09:00';

export type MockMemberKey = 'papa' | 'mama' | 'haruto' | 'saki';

export interface MockMember {
  key: MockMemberKey;
  id: string; // ギャラリーで使う ID（E2E ではサーバーの ID に読み替える）
  login: string;
  name: string;
  mark: string;
  color: 'yamabuki' | 'wakakusa' | 'wakatake' | 'asagi' | 'fuji' | 'momo' | 'ruri' | 'kaki';
  role: 'admin' | 'member';
}

/** 家族（並びは登録順。自分＝お父さん。E2E の開発ログインの既定の本人と同じ） */
export const MOCK_MEMBERS: MockMember[] = [
  {
    key: 'papa',
    id: '0192f5a0-1c00-7000-8000-00000000a001',
    login: 'papa@example.com',
    name: 'お父さん',
    mark: '父',
    color: 'yamabuki',
    role: 'admin',
  },
  {
    key: 'mama',
    id: '0192f5a0-1c00-7000-8000-00000000a002',
    login: 'mama@example.com',
    name: 'お母さん',
    mark: '母',
    color: 'wakatake',
    role: 'member',
  },
  {
    key: 'haruto',
    id: '0192f5a0-1c00-7000-8000-00000000a003',
    login: 'haruto@example.com',
    name: 'はると',
    mark: 'は',
    color: 'asagi',
    role: 'member',
  },
  {
    key: 'saki',
    id: '0192f5a0-1c00-7000-8000-00000000a004',
    login: 'saki@example.com',
    name: 'さき',
    mark: 'さ',
    color: 'momo',
    role: 'member',
  },
];

export const MOCK_ME: MockMemberKey = 'papa';

/** 予定（POST /api/events の本文と同じ形。人は key で書く） */
export interface MockEvent {
  key: string;
  by: MockMemberKey; // 作った人（非公開はこの人の予定）
  title: string;
  allDay: boolean;
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endAt?: string;
  members: MockMemberKey[] | 'everyone';
  location?: string;
  note?: string;
  visibility?: 'family' | 'private';
  busy?: boolean;
}

/** POST /api/events の本文にする（人の key を ID に読み替える。E2E もこれで同じ予定を入れる） */
export function toCreateBody(
  e: MockEvent,
  idOf: (key: MockMemberKey) => string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: e.title,
    allDay: e.allDay,
    memberIds: e.members === 'everyone' ? [] : e.members.map(idOf),
    forEveryone: e.members === 'everyone',
    visibility: e.visibility ?? 'family',
  };
  if (e.allDay) Object.assign(body, { startDate: e.startDate, endDate: e.endDate });
  else Object.assign(body, { startAt: e.startAt, endAt: e.endAt ?? null });
  if (e.location) body.location = e.location;
  if (e.note) body.note = e.note;
  if (e.busy !== undefined) body.busy = e.busy;
  return body;
}

export const MOCK_EVENTS: MockEvent[] = [
  {
    key: 'piano',
    by: 'saki',
    title: 'ピアノ',
    allDay: false,
    startAt: '2030-09-28T15:00:00+09:00',
    endAt: '2030-09-28T16:00:00+09:00',
    members: ['saki'],
  },
  {
    key: 'practice',
    by: 'haruto',
    title: '朝練',
    allDay: false,
    startAt: '2030-09-29T07:00:00+09:00',
    endAt: '2030-09-29T08:00:00+09:00',
    members: ['haruto'],
    location: '中学校',
  },
  {
    key: 'yoga',
    by: 'mama',
    title: 'ヨガ',
    allDay: false,
    startAt: '2030-09-29T10:00:00+09:00',
    endAt: '2030-09-29T11:30:00+09:00',
    members: ['mama'],
    location: '市民センター',
  },
  {
    key: 'dinner',
    by: 'mama',
    title: '夕食',
    allDay: false,
    startAt: '2030-09-29T18:00:00+09:00',
    endAt: '2030-09-29T20:00:00+09:00',
    members: 'everyone',
    location: '祖父母の家',
  },
  {
    key: 'saki-private',
    by: 'saki',
    title: 'さきの内緒',
    allDay: false,
    startAt: '2030-09-29T19:30:00+09:00',
    members: ['saki'],
    visibility: 'private',
  },
  {
    key: 'trip',
    by: 'papa',
    title: '出張（大阪）',
    allDay: true,
    startDate: '2030-09-30',
    endDate: '2030-10-02',
    members: ['papa'],
  },
  {
    key: 'dentist',
    by: 'mama',
    title: '歯医者',
    allDay: false,
    startAt: '2030-09-30T16:00:00+09:00',
    endAt: '2030-09-30T16:30:00+09:00',
    members: ['haruto'],
    location: '駅前歯科',
    note: '保険証を持っていく https://example.com/dentist',
  },
  {
    key: 'pta',
    by: 'mama',
    title: 'PTA 会議',
    allDay: false,
    startAt: '2030-10-01T19:00:00+09:00',
    members: ['mama'],
  },
  {
    key: 'sportsday',
    by: 'papa',
    title: '運動会',
    allDay: false,
    startAt: '2030-10-05T09:00:00+09:00',
    endAt: '2030-10-05T15:00:00+09:00',
    members: 'everyone',
    location: '小学校',
  },
  {
    key: 'kanazawa',
    by: 'papa',
    title: '家族旅行（金沢）',
    allDay: true,
    startDate: '2030-10-12',
    endDate: '2030-10-14',
    members: 'everyone',
  },
];
