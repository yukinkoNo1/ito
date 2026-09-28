import {
  addDays,
  canSeeContent,
  compareOccurrences,
  expandAll,
  formatMonthDay,
  fromJst,
  type Occurrence,
  occurrenceTimes,
  overlapsRange,
  parseRrule,
  untilDate,
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

/**
 * 回の並び（§13.1）の回から 1 回を選ぶ: これからの最初の回、なければ開始がいちばん遅い過ぎた回（開始が同じなら
 * 並びで先のもの）
 */
function pick(
  sorted: readonly Occurrence<LocalEvent>[],
  upcoming: (o: Occurrence<LocalEvent>) => boolean,
): Occurrence<LocalEvent> | null {
  let best: Occurrence<LocalEvent> | null = null;
  for (const o of sorted) {
    if (upcoming(o)) return o;
    if (!best || o.startMs > best.startMs) best = o;
  }
  return best;
}

/** 過ぎた回を探す窓の起点（規則が UNTIL で today より前に終わっていれば、その翌日。そうでなければ today） */
function backwardAnchor(master: LocalEvent, today: string): string {
  const parsed = master.rrule ? parseRrule(master.rrule) : null;
  if (!parsed?.ok || parsed.rule.until === null) return today;
  const next = addDays(untilDate(parsed.rule.until), 1);
  return next < today ? next : today;
}

/**
 * 本体の規則を展開せずに、「この回だけ変更」の行の回だけを作る（core の expand と同じ決まり: 本体に日時と読める
 * 規則があること、同じ recurrenceId は後の行、取り消した回は出さない、自分の日時で [from, to) にかかるもの）。
 * 合う行（ok）の回だけを、回の並びで返す
 */
function exceptionOccurrences(
  master: LocalEvent,
  rows: readonly LocalEvent[],
  ok: ReadonlySet<LocalEvent>,
  fromMs: number,
  toMs: number,
): Occurrence<LocalEvent>[] {
  if (!occurrenceTimes(master) || !master.rrule || !parseRrule(master.rrule).ok) return [];
  const overridden = new Map<string, LocalEvent>();
  for (const e of rows)
    if (e.parentId !== null && e.recurrenceId) overridden.set(e.recurrenceId, e);
  const exdates = new Set(master.exdates);
  const out: Occurrence<LocalEvent>[] = [];
  for (const [rid, e] of overridden) {
    if (exdates.has(rid) || !ok.has(e)) continue;
    const t = occurrenceTimes(e);
    if (!t) continue;
    const occ: Occurrence<LocalEvent> = {
      key: `${master.id}@${rid}`,
      seriesId: master.id,
      recurrenceId: rid,
      event: e,
      ...t,
    };
    if (overlapsRange(occ, fromMs, toMs)) out.push(occ);
  }
  return out.sort(compareOccurrences);
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
  // 行ごとに 1 回だけ確かめる: 文字の一致と人の絞り込みは、どちらも行の中身で決まる（回ごとに長いメモを正規化しない）。
  // 人の絞り込みは回ごとに当ててからシリーズの 1 回を選ぶ（「この回だけ」別の人にした回があっても、シリーズの
  // ほかの回で出す）。絞り込みの見る担当（memberIds・forEveryone）は行にあり、全員の予定はいつも合う
  const okRows = new Set<LocalEvent>();
  for (const e of visible) if (matches(e, terms) && matchesFilter(e, filter)) okRows.add(e);
  // 先に絞る: 本体か「この回だけ変更」のどれかが文字にも人にも合うシリーズ（と、繰り返しでない予定）だけを展開する
  // （1 年分を全部展開してから探すと、繰り返しが多いと 1 文字ごとに秒単位になる。総点検のレビュー 5 回目 G2・
  // 7 回目 I1）
  const hit = new Set<string>();
  for (const e of okRows) hit.add(e.parentId ?? e.id);
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
  const ok = (o: Occurrence<LocalEvent>) => okRows.has(o.event);
  const rangeFrom = fromJst(addDays(ctx.today, -SEARCH_RANGE_DAYS));
  const rangeTo = fromJst(addDays(ctx.today, SEARCH_RANGE_DAYS + 1));
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
    const master = rows.find((e) => e.parentId === null);
    // 親のない例外行は展開しない（expandAll と同じ）
    if (!master) continue;
    let found: Occurrence<LocalEvent> | null = null;
    if (!okRows.has(master)) {
      // 本体が合わなければ、合う回は「この回だけ変更」の行の回だけ。規則は展開しない（7 回目 I2）
      found = pick(exceptionOccurrences(master, rows, okRows, rangeFrom, rangeTo), upcoming);
    } else {
      for (const d of FORWARD_WINDOWS) {
        const to = fromJst(addDays(ctx.today, d));
        found = expandAll(rows, todayMs, to).find((o) => upcoming(o) && ok(o)) ?? null;
        if (found) break;
      }
      if (!found) {
        // 過ぎた回の窓は、規則が UNTIL で今日より前に終わっていればその翌日から前へ広げる（終わったあとの空の期間を
        // 展開しない）。窓の始まりがどこでも上の理由で答えは同じで、最後の窓はいつも前後 1 年
        const end = backwardAnchor(master, ctx.today);
        for (const d of BACKWARD_WINDOWS) {
          const from =
            d === SEARCH_RANGE_DAYS ? rangeFrom : Math.max(rangeFrom, fromJst(addDays(end, -d)));
          // 今日ちょうどに始まって終わる回も過ぎた回なので、終わりは今日の 0:00 の直後まで
          const best = pick(
            expandAll(rows, from, todayMs + 1).filter((o) => !upcoming(o) && ok(o)),
            upcoming,
          );
          if (best && (best.startMs > from || d === SEARCH_RANGE_DAYS)) {
            found = best;
            break;
          }
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
