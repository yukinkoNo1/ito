import { WEEKDAY_LABELS } from '@ito/core';
import type { DayVM, MemberVM, OccurrenceVM } from '../../ui/types';

function marks(o: OccurrenceVM, members: MemberVM[]): string {
  if (o.forEveryone) return '全員';
  return o.memberIds
    .map((id) => members.find((m) => m.id === id)?.mark)
    .filter(Boolean)
    .join('');
}

function when(o: OccurrenceVM): string {
  if (o.allDay) return '終日';
  const next = o.endDate > o.startDate ? '翌' : '';
  return o.endTime ? `${o.startTime}–${next}${o.endTime}` : (o.startTime ?? '');
}

/** 素朴な 1 日分の予定（Phase 6 で本番の UI に差し替える） */
export function DayBlock({
  day,
  members,
  onOpen,
  onCompose,
}: {
  day: DayVM;
  members: MemberVM[];
  onOpen: (key: string) => void;
  onCompose: (date: string) => void;
}) {
  const [, m, d] = day.date.split('-');
  const rows = [...day.allDay.map((a) => a.occ), ...day.timed.map((t) => t.occ)];
  return (
    <section
      aria-label={`${Number(m)}月${Number(d)}日`}
      data-date={day.date}
      className="border-b py-2"
    >
      <h3 className="flex items-center justify-between">
        <span>
          {Number(m)}/{Number(d)}({WEEKDAY_LABELS[day.weekday]}){day.isToday ? ' 今日' : ''}
          {day.holiday ? <span className="ml-2 text-red-700">{day.holiday}</span> : null}
        </span>
        <button
          type="button"
          aria-label={`${Number(m)}月${Number(d)}日に書く`}
          className="min-h-11 min-w-11"
          onClick={() => onCompose(day.date)}
        >
          ＋
        </button>
      </h3>
      <ul>
        {rows.map((o) => (
          <li key={o.key} data-fresh={o.fresh ? 'true' : undefined}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 text-left"
              onClick={() => onOpen(o.key)}
            >
              <span className="w-24 shrink-0 text-sm">{when(o)}</span>
              <span className="flex-1">{o.title ?? '予定あり'}</span>
              {o.fresh && <span title="新しい予定">新</span>}
              {o.sync !== 'synced' && (
                <span className="text-xs">{o.sync === 'pending' ? '未送信' : '競合'}</span>
              )}
              <span className="text-sm">{marks(o, members)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
