import { canSeeContent } from './events';
import { holidayName } from './holidays';
import {
  addDays,
  type DateISO,
  diffDays,
  formatMdW,
  fromJst,
  MINUTE_MS,
  minutesOfTime,
  timeFromMinutes,
  todayJst,
  toJstParts,
  type Weekday,
  weekdayOf,
} from './jst';
import { expandAll, type OccurrenceSource } from './occurrences';

/**
 * 空き時間（SPEC §5 F-18・§6 S-06・§22 FreeTimeVM。RUNBOOK 3.・7. Phase 7）。PWA が端末の DB から作る。
 * - 時間帯のプリセット: 夜（17–24 時）・休日（土日祝の 8–24 時）・終日（6–24 時）
 * - 今日の候補は、今の時刻を 30 分単位に切り上げた時刻より後だけ。昨日までの日は候補にしない
 * - 予定なし（busy=false）の予定は除く。他人の非公開は中身を出さずに「予定あり」として含める（label: null）
 * - 終了時刻なしの予定は 60 分。日付をまたぐ予定は翌日側にも反映する
 * - 全員の予定は選んだ家族みんなをふさぐ
 */

export type FreePreset = 'evenings' | 'holidays' | 'all';

/** プリセットごとの 1 日の範囲（その日の 0:00 からの分） */
export const FREE_PRESET_WINDOWS: Record<FreePreset, { startMin: number; endMin: number }> = {
  evenings: { startMin: 17 * 60, endMin: 24 * 60 },
  holidays: { startMin: 8 * 60, endMin: 24 * 60 },
  all: { startMin: 6 * 60, endMin: 24 * 60 },
};

/** 終了時刻なしの予定の長さ（分） */
export const OPEN_END_MINUTES = 60;
/** 候補の最大数（§6 S-06） */
export const MAX_FREE_CANDIDATES = 5;

export interface FreeBusySource extends OccurrenceSource {
  title: string | null;
  busy: boolean;
  forEveryone: boolean;
  memberIds: readonly string[];
  visibility: 'family' | 'private';
  ownerId: string;
}

export interface FreeBusyBlock {
  memberId: string;
  /** その日の 0:00 からの分（0〜1440） */
  startMin: number;
  endMin: number;
  /** null = 他人の非公開（中身を出さない） */
  label: string | null;
}

export interface FreeInterval {
  startMin: number;
  endMin: number;
}

export interface FreeDay {
  date: DateISO;
  weekday: Weekday;
  holiday: string | null;
  busy: FreeBusyBlock[];
  /** 選んだ家族みんなが空いている区間（プリセットの範囲の中で、長さが minDuration 以上のもの） */
  commonFree: FreeInterval[];
}

export interface FreeCandidate {
  date: DateISO;
  startMin: number;
  endMin: number;
  /** '10/3(土) 16:00–24:00' */
  label: string;
}

export interface FreeBusyInput {
  events: readonly FreeBusySource[];
  /** 表示する最初の日 */
  from: DateISO;
  /** 何日分か（画面は 7 日） */
  days: number;
  /** 空きを探す家族 */
  memberIds: readonly string[];
  preset: FreePreset;
  /** 分（60・120・240） */
  minDuration: number;
  nowMs: number;
  /** 見ている人（他人の非公開の中身を出さない） */
  viewerId: string;
}

export interface FreeBusyResult {
  /** 休日のプリセットでは土日祝だけ */
  days: FreeDay[];
  /** 日付の順に最大 5 件 */
  candidates: FreeCandidate[];
}

/** 休日（土日・祝日） */
export function isRestDay(date: DateISO): boolean {
  const w = weekdayOf(date);
  return w === 0 || w === 6 || holidayName(date) !== null;
}

/** 今の時刻を 30 分単位に切り上げた、今日の 0:00 からの分 */
export function nextHalfHourMinutes(nowMs: number): number {
  const { time } = toJstParts(nowMs);
  const min = minutesOfTime(time);
  const seconds = Math.floor((nowMs % MINUTE_MS) / 1000);
  const exact = min % 30 === 0 && seconds === 0 && nowMs % 1000 === 0;
  return exact ? min : (Math.floor(min / 30) + 1) * 30;
}

/** 区間の和（重なり・接するものをまとめて、始まりの順に） */
export function mergeIntervals(list: readonly FreeInterval[]): FreeInterval[] {
  const sorted = [...list]
    .filter((i) => i.endMin > i.startMin)
    .sort((a, b) => a.startMin - b.startMin);
  const out: FreeInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMin <= last.endMin) last.endMin = Math.max(last.endMin, i.endMin);
    else out.push({ ...i });
  }
  return out;
}

/** [from, to] から busy を除いた区間 */
export function subtractIntervals(
  from: number,
  to: number,
  busy: readonly FreeInterval[],
): FreeInterval[] {
  const out: FreeInterval[] = [];
  let cursor = from;
  for (const b of mergeIntervals(busy)) {
    if (b.endMin <= cursor) continue;
    if (b.startMin >= to) break;
    if (b.startMin > cursor) out.push({ startMin: cursor, endMin: Math.min(b.startMin, to) });
    cursor = Math.max(cursor, b.endMin);
    if (cursor >= to) break;
  }
  if (cursor < to) out.push({ startMin: cursor, endMin: to });
  return out;
}

function hm(min: number): string {
  return min >= 24 * 60 ? '24:00' : timeFromMinutes(min).replace(/^0/, '');
}

export function freeCandidateLabel(date: DateISO, startMin: number, endMin: number): string {
  return `${formatMdW(date)} ${hm(startMin)}–${hm(endMin)}`;
}

export function freeBusy(input: FreeBusyInput): FreeBusyResult {
  const { preset, minDuration, viewerId } = input;
  const window = FREE_PRESET_WINDOWS[preset];
  const selected = new Set(input.memberIds);
  const today = todayJst(input.nowMs);
  const last = addDays(input.from, Math.max(0, input.days - 1));
  // 前日から続く予定・日付をまたぐ予定も拾うため、1 日前から展開する
  const occs = expandAll(input.events, fromJst(addDays(input.from, -1)), fromJst(addDays(last, 1)));

  const blocksByDay = new Map<DateISO, FreeBusyBlock[]>();
  for (const o of occs) {
    const e = o.event;
    if (!e.busy) continue;
    const who = e.forEveryone ? [...selected] : e.memberIds.filter((id) => selected.has(id));
    if (who.length === 0) continue;
    const endMs = o.endMs ?? o.startMs + OPEN_END_MINUTES * MINUTE_MS;
    const label = canSeeContent(e, viewerId) ? (e.title ?? '') : null;
    // その回がかかる日ごとに、その日の 0:00 からの分に切り分ける
    for (let d = o.startDate; diffDays(d, last) >= 0; d = addDays(d, 1)) {
      const dayStart = fromJst(d);
      const dayEnd = fromJst(addDays(d, 1));
      if (dayStart >= endMs) break;
      if (dayEnd <= o.startMs || diffDays(input.from, d) < 0) continue;
      const startMin = Math.max(0, Math.round((o.startMs - dayStart) / MINUTE_MS));
      const endMin = Math.min(24 * 60, Math.round((endMs - dayStart) / MINUTE_MS));
      if (endMin <= startMin) continue;
      const list = blocksByDay.get(d) ?? [];
      for (const memberId of who) list.push({ memberId, startMin, endMin, label });
      blocksByDay.set(d, list);
    }
  }

  const days: FreeDay[] = [];
  const candidates: FreeCandidate[] = [];
  for (let i = 0; i < input.days; i++) {
    const date = addDays(input.from, i);
    if (preset === 'holidays' && !isRestDay(date)) continue;
    const busy = (blocksByDay.get(date) ?? []).sort(
      (a, b) =>
        a.startMin - b.startMin || a.endMin - b.endMin || (a.memberId < b.memberId ? -1 : 1),
    );
    // 昨日までは候補にしない。今日は 30 分単位に切り上げた今より後
    const past = diffDays(date, today) > 0;
    const from =
      date === today
        ? Math.max(window.startMin, nextHalfHourMinutes(input.nowMs))
        : window.startMin;
    const commonFree = past
      ? []
      : subtractIntervals(from, window.endMin, busy).filter(
          (f) => f.endMin - f.startMin >= minDuration,
        );
    days.push({ date, weekday: weekdayOf(date), holiday: holidayName(date), busy, commonFree });
    for (const f of commonFree) {
      if (candidates.length >= MAX_FREE_CANDIDATES) break;
      candidates.push({ date, ...f, label: freeCandidateLabel(date, f.startMin, f.endMin) });
    }
  }
  return { days, candidates };
}
