import {
  createLocally,
  type EventDTO,
  eventCreateSchema,
  expandAll,
  fromJst,
} from '../../src/index';

/**
 * 繰り返しの展開を 3 通り（core を直接・サーバーの API 経由・PWA の viewmodel 経由）で比べるための共通のデータ（RUNBOOK 7. Phase 3）。
 * 作る人の ID は呼び出し側で決める（ownerId）
 */

export const RECURRING_WINDOW = { from: '2026-10-01', to: '2026-11-01' } as const;

const id = (n: number) => `0192f5d0-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;

export const RECURRING_BODIES: Record<string, unknown>[] = [
  {
    id: id(1),
    title: '燃えるゴミ',
    allDay: false,
    startAt: '2026-09-28T07:30:00+09:00',
    endAt: '2026-09-28T08:00:00+09:00',
    rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    forEveryone: true,
  },
  {
    id: id(2),
    title: '資源ゴミ',
    allDay: false,
    startAt: '2026-10-14T07:30:00+09:00',
    rrule: 'FREQ=MONTHLY;BYDAY=2WE,4WE',
    forEveryone: true,
  },
  {
    id: id(3),
    title: 'フィルター掃除',
    allDay: true,
    startDate: '2026-10-01',
    endDate: '2026-10-01',
    rrule: 'FREQ=MONTHLY;BYMONTHDAY=1',
    forEveryone: true,
  },
  {
    id: id(4),
    title: '出張',
    allDay: true,
    startDate: '2026-10-10',
    endDate: '2026-10-11',
    rrule: 'FREQ=MONTHLY;COUNT=2',
    forEveryone: true,
  },
  {
    id: id(5),
    title: '夜勤',
    allDay: false,
    startAt: '2026-10-02T22:00:00+09:00',
    endAt: '2026-10-03T06:00:00+09:00',
    rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR',
    forEveryone: true,
  },
  {
    id: id(6),
    title: '散歩',
    allDay: false,
    startAt: '2026-10-28T07:00:00+09:00',
    // 時刻ありの日付だけの UNTIL は、保存のときに 23:59:59 にする（最終日の回が残る）
    rrule: 'FREQ=DAILY;UNTIL=20261031',
    forEveryone: true,
  },
];

/** 回の比べ方（key・開始・終わり） */
export function summarize(occ: ReturnType<typeof expandAll>): string[] {
  return occ.map(
    (o) =>
      `${o.key} ${o.startDate}${o.startTime ? ` ${o.startTime}` : ''} → ${o.endDate}${o.endTime ? ` ${o.endTime}` : ''}`,
  );
}

/** core を直接（サーバーを通さずに作った予定を展開） */
export function expandDirect(ownerId: string): string[] {
  const events: EventDTO[] = RECURRING_BODIES.map((body) => {
    const input = eventCreateSchema.parse(body);
    const made = createLocally(input, input.id as string, ownerId, fromJst('2026-09-27'));
    if (!('value' in made)) throw new Error(JSON.stringify(made.errors));
    return made.value;
  });
  return summarize(expandAll(events, fromJst(RECURRING_WINDOW.from), fromJst(RECURRING_WINDOW.to)));
}
