import {
  addDays,
  type DateISO,
  diffDays,
  firstOfMonth,
  holidayName,
  parseDate,
  startOfWeek,
  WEEKDAY_LABELS,
  weekdayOf,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import type { MonthCellVM, MonthSpanVM, MonthVM, Weekday } from '../ui/types';
import { type DayOccurrences, groupByDay } from './flow';
import { WAFU } from './labels';
import { activeMembers, type VmContext } from './occurrence';

/** 月のセル（各日に短い予定名 2 件と「+n」。§5 F-04） */
export function toMonthCell(
  date: DateISO,
  occs: DayOccurrences | undefined,
  inMonth: boolean,
  ctx: VmContext,
): MonthCellVM {
  const all = [...(occs?.allDay ?? []).map((a) => a.occ), ...(occs?.timed ?? []).map((t) => t.occ)];
  const order = activeMembers(ctx.members).map((m) => m.id);
  const ids = new Set<string>();
  let hasEveryone = false;
  for (const o of all) {
    if (o.forEveryone) hasEveryone = true;
    for (const id of o.memberIds) ids.add(id);
  }
  const items = all
    .slice(0, 2)
    .map((o) => ({ title: o.title, memberIds: o.memberIds, forEveryone: o.forEveryone }));
  return {
    date,
    day: parseDate(date).day,
    weekday: weekdayOf(date),
    inMonth,
    holiday: holidayName(date),
    isToday: date === ctx.today,
    memberIds: order.filter((id) => ids.has(id)),
    hasEveryone,
    count: all.length,
    items,
    more: Math.max(0, all.length - items.length),
  };
}

export function buildMonth(
  events: LocalEvent[],
  year: number,
  month: number,
  weekStart: 0 | 1,
  ctx: VmContext,
  filter: string[] | null = null,
): MonthVM {
  const first = firstOfMonth(year, month);
  const gridStart = startOfWeek(first, weekStart);
  const nextMonth = month === 12 ? firstOfMonth(year + 1, 1) : firstOfMonth(year, month + 1);
  // §22: 5〜6 行（4 行で収まる月も 5 行にする）
  const weeksCount = Math.max(5, Math.ceil(diffDays(gridStart, nextMonth) / 7));
  const gridEnd = addDays(gridStart, weeksCount * 7);
  const byDay = groupByDay(events, gridStart, gridEnd, ctx, filter);

  const weeks: MonthCellVM[][] = [];
  for (let w = 0; w < weeksCount; w++) {
    const row: MonthCellVM[] = [];
    for (let c = 0; c < 7; c++) {
      const d = addDays(gridStart, w * 7 + c);
      row.push(toMonthCell(d, byDay.get(d), d >= first && d < nextMonth, ctx));
    }
    weeks.push(row);
  }

  // 複数日の終日予定を週の行ごとに分けた線
  const spans: MonthSpanVM[] = [];
  const seen = new Set<string>();
  for (let d = gridStart; d < gridEnd; d = addDays(d, 1)) {
    for (const { occ } of byDay.get(d)?.allDay ?? []) {
      if (occ.startDate === occ.endDate || seen.has(occ.key)) continue;
      seen.add(occ.key);
      const from = occ.startDate < gridStart ? gridStart : occ.startDate;
      const to = occ.endDate >= gridEnd ? addDays(gridEnd, -1) : occ.endDate;
      for (let s = from; s <= to; ) {
        const offset = diffDays(gridStart, s);
        const week = Math.floor(offset / 7);
        const fromCol = offset % 7;
        const rowEnd = addDays(gridStart, week * 7 + 6);
        const e = to < rowEnd ? to : rowEnd;
        spans.push({
          key: `${occ.key}:${week}`,
          week,
          fromCol,
          toCol: diffDays(gridStart, e) % 7,
          memberIds: occ.memberIds,
          forEveryone: occ.forEveryone,
          title: occ.title,
        });
        s = addDays(e, 1);
      }
    }
  }

  const labels = Array.from(
    { length: 7 },
    (_, i) => WEEKDAY_LABELS[((i + weekStart) % 7) as Weekday],
  );
  return {
    year,
    month,
    label: `${year}年${month}月`,
    wafu: WAFU[month - 1] as string,
    weekStart,
    weekdayLabels: labels,
    weeks,
    spans,
  };
}
