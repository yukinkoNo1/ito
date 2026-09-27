import {
  addDays,
  type DateISO,
  diffDays,
  formatMdW,
  holidayName,
  type Occurrence,
  parseDate,
  startOfWeek,
  weekdayOf,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import type { DayVM, FlowItem, MonthCellVM, OccurrenceVM, SpanPosition } from '../ui/types';
import {
  activeMembers,
  matchesFilter,
  occurrencesBetween,
  toOccurrenceVM,
  type VmContext,
} from './occurrence';

export interface DayOccurrences {
  allDay: { occ: OccurrenceVM; raw: Occurrence<LocalEvent> }[];
  timed: { occ: OccurrenceVM; raw: Occurrence<LocalEvent> }[];
}

/**
 * 日付ごとに回を振り分ける。終日は各日に、時刻ありは開始日にだけ（日付をまたぐ予定も。§11）。
 */
export function groupByDay(
  events: LocalEvent[],
  from: DateISO,
  to: DateISO,
  ctx: VmContext,
  filter: string[] | null,
): Map<DateISO, DayOccurrences> {
  const out = new Map<DateISO, DayOccurrences>();
  const get = (d: DateISO) => {
    let v = out.get(d);
    if (!v) {
      v = { allDay: [], timed: [] };
      out.set(d, v);
    }
    return v;
  };
  for (const raw of occurrencesBetween(events, from, to)) {
    const occ = toOccurrenceVM(raw, ctx);
    if (!matchesFilter(occ, filter)) continue;
    if (raw.allDay) {
      const first = raw.startDate < from ? from : raw.startDate;
      const last = raw.endDate >= to ? addDays(to, -1) : raw.endDate;
      for (let d = first; d <= last; d = addDays(d, 1)) get(d).allDay.push({ occ, raw });
    } else if (raw.startDate >= from && raw.startDate < to) {
      get(raw.startDate).timed.push({ occ, raw });
    }
  }
  return out;
}

function spanOf(date: DateISO, o: OccurrenceVM): SpanPosition {
  if (o.startDate === o.endDate) return 'single';
  if (date === o.startDate) return 'start';
  if (date === o.endDate) return 'end';
  return 'middle';
}

export function buildDay(date: DateISO, occs: DayOccurrences | undefined, ctx: VmContext): DayVM {
  const allDay = (occs?.allDay ?? []).map(({ occ }) => ({ occ, span: spanOf(date, occ) }));
  const timedRaw = occs?.timed ?? [];
  const timed = timedRaw.map(({ occ, raw }) => ({
    occ,
    past: (raw.endMs ?? raw.startMs) <= ctx.nowMs,
  }));
  let nowIndex: number | null = null;
  if (date === ctx.today) {
    const i = timedRaw.findIndex(({ raw }) => raw.startMs > ctx.nowMs);
    nowIndex = i === -1 ? timedRaw.length : i;
  }
  // 複数日の終日予定が続いている家族（この日の区間は糸を太くする。§22）
  const ongoing = new Set<string>();
  for (const { occ } of occs?.allDay ?? []) {
    if (occ.startDate !== occ.endDate) for (const id of occ.memberIds) ongoing.add(id);
  }
  const order = activeMembers(ctx.members).map((m) => m.id);
  return {
    date,
    weekday: weekdayOf(date),
    holiday: holidayName(date),
    isToday: date === ctx.today,
    isPast: date < ctx.today,
    allDay,
    timed,
    nowIndex,
    ongoingMemberIds: order.filter((id) => ongoing.has(id)),
  };
}

function hasContent(day: DayVM): boolean {
  return day.allDay.length > 0 || day.timed.length > 0 || day.holiday !== null;
}

/**
 * 「これから」の並び（§6.3 S-01）。月の区切り見出し、予定のある日（今日は予定がなくても出す）、
 * 予定のない日をまとめた 1 行。
 */
export function buildFlowItems(
  events: LocalEvent[],
  from: DateISO,
  to: DateISO,
  ctx: VmContext,
  filter: string[] | null,
): FlowItem[] {
  const byDay = groupByDay(events, from, to, ctx, filter);
  const items: FlowItem[] = [];
  let lastMonth = '';
  let gapStart: DateISO | null = null;
  const flushGap = (until: DateISO) => {
    if (gapStart === null) return;
    const last = addDays(until, -1);
    const days = diffDays(gapStart, until);
    items.push({
      kind: 'gap',
      key: `gap:${gapStart}`,
      from: gapStart,
      to: last,
      days,
      label:
        days === 1
          ? `${formatMdW(gapStart)} 予定なし`
          : `${formatMdW(gapStart)} – ${formatMdW(last)} 予定なし`,
    });
    gapStart = null;
  };
  for (let d = from; d < to; d = addDays(d, 1)) {
    const ym = d.slice(0, 7);
    const day = buildDay(d, byDay.get(d), ctx);
    const show = hasContent(day) || d === ctx.today;
    if (!show) {
      gapStart ??= d;
      continue;
    }
    flushGap(d);
    if (ym !== lastMonth) {
      const { year, month } = parseDate(d);
      items.push({ kind: 'month', key: `month:${ym}`, year, month, label: `${year}年${month}月` });
      lastMonth = ym;
    }
    items.push({ kind: 'day', key: `day:${d}`, day });
  }
  flushGap(to);
  return items;
}

/**
 * 今日のまとめ（§6.3）。最大 4 つ: ①今日 n件 ②家族全員の予定の最初の 1 件 ③複数日の終日予定（busy）で留守の人 ④新しい予定 n件
 */
export function buildSummary(
  today: DayVM,
  members: VmContext['members'],
  freshCount: number,
): string[] {
  const out: string[] = [];
  const count = today.allDay.length + today.timed.length;
  out.push(`今日 ${count}件`);
  const everyone = [...today.allDay.map((a) => a.occ), ...today.timed.map((t) => t.occ)].find(
    (o) => o.forEveryone,
  );
  if (everyone) {
    const title = everyone.title ?? '予定あり';
    out.push(everyone.startTime ? `${everyone.startTime} 全員で${title}` : `全員で${title}`);
  }
  const away: string[] = [];
  for (const { occ } of today.allDay) {
    if (!occ.busy || occ.startDate === occ.endDate || occ.forEveryone) continue;
    const endDay = parseDate(occ.endDate).day;
    for (const id of occ.memberIds) {
      const m = members.find((x) => x.id === id);
      if (m) away.push(`${m.mark}は${occ.title ? `${occ.title}中` : '予定あり'}（〜${endDay}日）`);
    }
  }
  if (away.length > 0) out.push(away.slice(0, 2).join('・'));
  if (freshCount > 0) out.push(`新しい予定 ${freshCount}件`);
  return out.slice(0, 4);
}

/** 週の帯（7 日）。月のセルと同じ形 */
export function buildWeek(
  events: LocalEvent[],
  selected: DateISO,
  weekStart: 0 | 1,
  ctx: VmContext,
  filter: string[] | null,
  toCell: (date: DateISO, occs: DayOccurrences | undefined, inMonth: boolean) => MonthCellVM,
): MonthCellVM[] {
  const start = startOfWeek(selected, weekStart);
  const end = addDays(start, 7);
  const byDay = groupByDay(events, start, end, ctx, filter);
  const out: MonthCellVM[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) out.push(toCell(d, byDay.get(d), true));
  return out;
}
