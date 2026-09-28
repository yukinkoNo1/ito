import {
  addDays,
  canSeeContent,
  expandAll,
  formatMonthDay,
  fromJst,
  type Occurrence,
  WEEKDAY_LABELS,
  weekdayOf,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import type { SearchGroupVM } from '../ui/types';
import { matchesFilter, toOccurrenceVM, type VmContext } from './occurrence';

/**
 * 検索（§6 S-10・§5 F-19）。端末の DB（IndexedDB）の予定を、件名・場所・メモの部分一致で探す。
 * - 大文字小文字・全角半角を区別しない（NFKC）。空白で区切った語はすべて含むもの（AND）
 * - 他人の非公開は中身を持たないので探さない（「予定あり」も出さない。§18 T5）
 * - 探す範囲は今日の前後 1 年。繰り返しはシリーズごとに 1 回だけ出す（これからの最初の回、なければ最後の回）。
 *   「この回だけ変更」の回は、その回の中身で探す
 * - 並びはこれからの回を近い順に、そのあとに過ぎた回を新しい順に。最大 50 件
 */

export const SEARCH_RANGE_DAYS = 366;
export const SEARCH_MAX_RESULTS = 50;
export const RECENT_QUERIES_MAX = 5;

export function normalizeSearchText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function searchTerms(query: string): string[] {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function matches(e: LocalEvent, terms: readonly string[]): boolean {
  const hay = normalizeSearchText([e.title ?? '', e.location ?? '', e.note ?? ''].join('\n'));
  return terms.every((t) => hay.includes(t));
}

/** '10月3日(土)' */
function dateLabel(date: string): string {
  return `${formatMonthDay(date)}(${WEEKDAY_LABELS[weekdayOf(date)]})`;
}

export function searchOccurrences(
  events: readonly LocalEvent[],
  query: string,
  filter: string[] | null,
  ctx: VmContext,
): SearchGroupVM[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const visible = events.filter((e) => canSeeContent(e, ctx.meId));
  const from = fromJst(addDays(ctx.today, -SEARCH_RANGE_DAYS));
  const to = fromJst(addDays(ctx.today, SEARCH_RANGE_DAYS + 1));
  const todayMs = fromJst(ctx.today);
  // これからの回か（終わりは含まないので、昨日の終日・きのう 24:00 に終わった予定は過ぎた回）
  const upcoming = (o: Occurrence<LocalEvent>) =>
    o.endMs !== null ? o.endMs > todayMs : o.startMs >= todayMs;
  // シリーズごとに 1 回（これからの最初の回、なければ最後の回）。人の絞り込みは回ごとに先に当てる
  // （「この回だけ」別の人にした回があっても、シリーズのほかの回で出す）
  const bySeries = new Map<
    string,
    { o: Occurrence<LocalEvent>; vm: ReturnType<typeof toOccurrenceVM> }
  >();
  for (const o of expandAll(visible, from, to)) {
    if (!matches(o.event, terms)) continue;
    const vm = toOccurrenceVM(o, ctx);
    if (!matchesFilter(vm, filter)) continue;
    const current = bySeries.get(o.seriesId);
    // expandAll は開始の順なので、これからの回は最初のもの、過ぎた回は最後のものを残す
    if (!current || (!upcoming(current.o) && (upcoming(o) || o.startMs > current.o.startMs))) {
      bySeries.set(o.seriesId, { o, vm });
    }
  }
  const vms = [...bySeries.values()];
  const soon = vms.filter(({ o }) => upcoming(o)).sort((x, y) => x.o.startMs - y.o.startMs);
  const past = vms.filter(({ o }) => !upcoming(o)).sort((x, y) => y.o.startMs - x.o.startMs);
  const groups: SearchGroupVM[] = [];
  for (const { vm } of [...soon, ...past].slice(0, SEARCH_MAX_RESULTS)) {
    const label = dateLabel(vm.startDate);
    const last = groups[groups.length - 1];
    if (last && last.dateLabel === label) last.items.push(vm);
    else groups.push({ dateLabel: label, items: [vm] });
  }
  return groups;
}

/** 最近の検索語（新しい順、重なりなし、最大 5） */
export function rememberQuery(list: readonly string[], query: string): string[] {
  const q = query.trim().slice(0, 100);
  if (!q) return [...list];
  return [q, ...list.filter((x) => x !== q)].slice(0, RECENT_QUERIES_MAX);
}
