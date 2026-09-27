import {
  addDays,
  type DateISO,
  diffDays,
  formatMdW,
  fromJst,
  parseIsoToMs,
  toJstParts,
  weekdayOf,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import type { ComposerVM, EventDraftVM, MemberVM, TimeHM } from '../ui/types';

export const QUICK_TIMES: TimeHM[] = ['09:00', '12:00', '15:00', '18:00', '19:00'];
export const COMPOSER_EXAMPLES = [
  '土曜10時 父 ゴルフ',
  '明日18時 みんなで夕食',
  '毎週日曜 母 ヨガ',
];

/** 次の曜日（今日を含まない） */
function nextWeekday(from: DateISO, weekday: number): DateISO {
  const d = (weekday - weekdayOf(from) + 7) % 7 || 7;
  return addDays(from, d);
}

/**
 * 日付の札（§16 F-22）: 今日・明日・次の土曜・次の日曜・その次の土曜。
 * 札には日付を書き、「来週の土」のような曖昧な言い方をしない（§16。§22 の注釈を直した）
 */
export function quickDates(today: DateISO): { label: string; date: DateISO }[] {
  const sat = nextWeekday(today, 6);
  const sun = nextWeekday(today, 0);
  const out = [
    { label: '今日', date: today },
    { label: '明日', date: addDays(today, 1) },
    { label: formatMdW(sat), date: sat },
    { label: formatMdW(sun), date: sun },
    { label: formatMdW(addDays(sat, 7)), date: addDays(sat, 7) },
  ];
  // 同じ日付の札は 1 つだけ（明日が土曜など）
  const seen = new Set<string>();
  return out.filter((o) => {
    if (seen.has(o.date)) return false;
    seen.add(o.date);
    return true;
  });
}

/**
 * 最近の予定（§16 F-22）: 端末の DB の過去 90 日の予定名を回数順に最大 5 件。
 * よく使う人と開始時刻（最頻値）を添え、タップで予定名・人・時刻をまとめて入れる。
 */
export function recentSuggestions(
  events: LocalEvent[],
  todayMs: number,
  members: MemberVM[],
): ComposerVM['suggestions'] {
  const since = todayMs - 90 * 24 * 60 * 60 * 1000;
  const byTitle = new Map<
    string,
    {
      count: number;
      members: Map<string, number>;
      times: Map<string, number>;
      everyone: number;
      last: number;
    }
  >();
  for (const e of events) {
    if (!e.title || e.parentId) continue;
    const created = e.createdAt ? (parseIsoToMs(e.createdAt) ?? 0) : 0;
    const start = e.allDay
      ? fromJst(e.startDate as string)
      : (parseIsoToMs(e.startAt as string) ?? 0);
    if (Math.max(created, start) < since) continue;
    const entry = byTitle.get(e.title) ?? {
      count: 0,
      members: new Map(),
      times: new Map(),
      everyone: 0,
      last: 0,
    };
    entry.count++;
    entry.last = Math.max(entry.last, created);
    if (e.forEveryone) entry.everyone++;
    else for (const id of e.memberIds) entry.members.set(id, (entry.members.get(id) ?? 0) + 1);
    const time = e.allDay ? 'allday' : toJstParts(parseIsoToMs(e.startAt as string) ?? 0).time;
    entry.times.set(time, (entry.times.get(time) ?? 0) + 1);
    byTitle.set(e.title, entry);
  }
  const top = <K>(m: Map<K, number>): K | null => {
    let best: K | null = null;
    let n = -1;
    for (const [k, v] of m) if (v > n) [best, n] = [k, v];
    return best;
  };
  return [...byTitle.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last || (a[0] < b[0] ? -1 : 1))
    .slice(0, 5)
    .map(([title, entry]) => {
      const memberId = top(entry.members);
      const everyone = entry.everyone > (memberId ? (entry.members.get(memberId) ?? 0) : 0);
      const time = top(entry.times);
      const patch: Partial<EventDraftVM> = { title };
      if (everyone) Object.assign(patch, { forEveryone: true, memberIds: [] });
      else if (memberId) Object.assign(patch, { forEveryone: false, memberIds: [memberId] });
      if (time && time !== 'allday') Object.assign(patch, { allDay: false, startTime: time });
      else if (time === 'allday')
        Object.assign(patch, { allDay: true, startTime: null, endTime: null });
      const who = everyone ? '全員' : (members.find((m) => m.id === memberId)?.mark ?? null);
      const hint = [who, time && time !== 'allday' ? time : time === 'allday' ? '終日' : null]
        .filter(Boolean)
        .join(' · ');
      return { title, hint: hint || null, patch };
    });
}

/** 保存ボタンの文言（中身が分かるように。§16 F-22）。件名と日付が決まるまでは押せない */
export function saveLabelFor(draft: EventDraftVM | null, editing: boolean): string {
  if (!draft?.title.trim()) return '件名を入れてください';
  if (!draft.startDate) return '日付を選んでください';
  const date = formatMdW(draft.startDate);
  const multi =
    draft.allDay && draft.endDate > draft.startDate ? `〜${formatMdW(draft.endDate)}` : '';
  const when = draft.allDay ? `${date}${multi} 終日` : `${date} ${draft.startTime ?? ''}`;
  return `${when} ${editing ? 'に変更' : 'に保存'}`;
}

/**
 * S-05 の ComposerVM（§22）。一言の解析（ambiguities・overlaps・source）は Phase 5 でつなぐ。
 * 候補（最近の予定）は開いた時点で出す（§16 F-22。編集では出さない）
 */
export function buildComposerVM(input: {
  mode: ComposerVM['mode'];
  editing: boolean;
  text: string;
  draft: EventDraftVM | null;
  today: DateISO;
  nowMs: number;
  events: LocalEvent[];
  members: MemberVM[];
  saving: boolean;
  error: string | null;
}): ComposerVM {
  return {
    mode: input.mode,
    editing: input.editing,
    text: input.text,
    parse: 'idle',
    source: null,
    draft: input.draft,
    ambiguities: [],
    overlaps: [],
    examples: COMPOSER_EXAMPLES,
    quickDates: quickDates(input.today),
    quickTimes: QUICK_TIMES,
    suggestions: input.editing ? [] : recentSuggestions(input.events, input.nowMs, input.members),
    saveLabel: saveLabelFor(input.draft, input.editing),
    saving: input.saving,
    error: input.error,
  };
}

/** 日付を選べるか（今日から −1 年〜+3 年。§16 の検証と合わせる） */
export function isReasonableDate(date: DateISO, today: DateISO): boolean {
  const d = diffDays(today, date);
  return d >= -366 && d <= 366 * 3;
}
