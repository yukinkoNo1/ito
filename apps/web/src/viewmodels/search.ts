import {
  addDays,
  canSeeContent,
  compareOccurrences,
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
 * - 並びはこれからの回を近い順に、そのあとに過ぎた回を新しい順に。開始が同じならカレンダーと同じ回の並び（§13.1）。最大 50 件
 */

export const SEARCH_RANGE_DAYS = 366;
/** 探す窓（今日から何日先まで・何日前まで）。最後はそれぞれ前後 1 年（今日の前 366 日から、後 367 日目の 0:00 まで） */
const FORWARD_WINDOWS = [7, 35, 120, SEARCH_RANGE_DAYS + 1] as const;
const BACKWARD_WINDOWS = [7, 35, 120, SEARCH_RANGE_DAYS] as const;
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
  // 先に文字で絞る: 本体か「この回だけ変更」のどれかが合うシリーズ（と、繰り返しでない予定）だけを展開する
  // （1 年分を全部展開してから探すと、繰り返しが多いと 1 文字ごとに秒単位になる。総点検のレビュー 5 回目 G2）。
  // 回ごとの中身の一致は、展開したあとでも確かめる
  const hit = new Set<string>();
  for (const e of visible) if (matches(e, terms)) hit.add(e.parentId ?? e.id);
  const rowsBySeries = new Map<string, LocalEvent[]>();
  for (const e of visible) {
    const id = e.parentId ?? e.id;
    if (!hit.has(id)) continue;
    const rows = rowsBySeries.get(id);
    if (rows) rows.push(e);
    else rowsBySeries.set(id, [e]);
  }
  const todayMs = fromJst(ctx.today);
  // これからの回か（終わりは含まないので、昨日の終日・きのう 24:00 に終わった予定は過ぎた回）
  const upcoming = (o: Occurrence<LocalEvent>) =>
    o.endMs !== null ? o.endMs > todayMs : o.startMs >= todayMs;
  // 行ごとに 1 回だけ確かめる（文字の一致と人の絞り込みはどちらも行の中身で決まる。長いメモを回ごとに正規化しない）。
  // 人の絞り込みは回ごとに先に当てる（「この回だけ」別の人にした回があっても、シリーズのほかの回で出す）
  const rowOk = new Map<LocalEvent, boolean>();
  const ok = (o: Occurrence<LocalEvent>) => {
    let v = rowOk.get(o.event);
    if (v === undefined) {
      v = matches(o.event, terms) && matchesFilter(toOccurrenceVM(o, ctx), filter);
      rowOk.set(o.event, v);
    }
    return v;
  };
  // シリーズごとに 1 回（これからの最初の回、なければ最後の回）。前後 1 年を全部展開せず、今日から近い順に
  // 広げていく窓で探す（合うシリーズが多いと 1 文字ごとに秒単位になる。総点検のレビュー 6 回目 H1）。
  // 窓の外に答えがないことは次のとおり: これからの回は [今日, 今日 + d) にかかるので、窓で最初に合った回より
  // 早い回はすべて窓に入る。過ぎた回は、窓 [今日 - d, 今日] で開始がいちばん遅い合う回の開始が 今日 - d より後なら、
  // それより遅い過ぎた回もすべて窓に入る。最後の窓は前のやり方の範囲（今日の前後 1 年）と同じ
  const bySeries = new Map<
    string,
    { o: Occurrence<LocalEvent>; vm: ReturnType<typeof toOccurrenceVM> }
  >();
  for (const [seriesId, rows] of rowsBySeries) {
    let found: Occurrence<LocalEvent> | null = null;
    for (const d of FORWARD_WINDOWS) {
      const to = fromJst(addDays(ctx.today, d));
      found = expandAll(rows, todayMs, to).find((o) => upcoming(o) && ok(o)) ?? null;
      if (found) break;
    }
    if (!found) {
      for (const d of BACKWARD_WINDOWS) {
        const from = fromJst(addDays(ctx.today, -d));
        // 今日ちょうどに始まって終わる回も過ぎた回なので、終わりは今日の 0:00 の直後まで
        let best: Occurrence<LocalEvent> | null = null;
        for (const o of expandAll(rows, from, todayMs + 1)) {
          // expandAll は開始の順なので、開始が同じなら最初のものを残す
          if (!upcoming(o) && ok(o) && (!best || o.startMs > best.startMs)) best = o;
        }
        if (best && (best.startMs > from || d === SEARCH_RANGE_DAYS)) {
          found = best;
          break;
        }
      }
    }
    if (found) bySeries.set(seriesId, { o: found, vm: toOccurrenceVM(found, ctx) });
  }
  const vms = [...bySeries.values()];
  const soon = vms.filter(({ o }) => upcoming(o)).sort((x, y) => compareOccurrences(x.o, y.o));
  const past = vms
    .filter(({ o }) => !upcoming(o))
    .sort((x, y) => y.o.startMs - x.o.startMs || compareOccurrences(x.o, y.o));
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
