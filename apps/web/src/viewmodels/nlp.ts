import {
  addDays,
  canSeeContent,
  compareOccurrences,
  diffDays,
  expandAll,
  formatMdW,
  fromJst,
  type MeDTO,
  type MemberDTO,
  MINUTE_MS,
  type NlpAmbiguity,
  type NlpContext,
  type NlpDraft,
  type NlpResult,
  overlapsRange,
  parseRules,
} from '@ito/core';
import { z } from 'zod';
import type { LocalEvent } from '../data/db';
import type { AmbiguityVM, EventDraftVM, RecurrenceVM } from '../ui/types';

/**
 * 一言入力（§16）の PWA 側: ルール解析の文脈、解析の結果 → 書く画面の下書き・曖昧さ、重なりの警告
 */

/** ルール解析の文脈（ほかの家族の呼び名は同期に入らないので、名前と略称。自分は呼び名も） */
export function nlpContext(me: MeDTO, members: MemberDTO[], nowMs: number): NlpContext {
  return {
    nowMs,
    weekStart: me.settings.weekStart,
    writerId: me.id,
    members: members
      .filter((m) => !m.disabled)
      .map((m) => ({
        id: m.id,
        name: m.name,
        mark: m.mark,
        aliases: m.id === me.id ? me.aliases : [],
      })),
  };
}

export function parseLocally(text: string, ctx: NlpContext) {
  return parseRules(text, ctx);
}

export type NlpFound = NlpResult['found'];

/**
 * 解析の結果 → 下書きの変更（書く画面の札に反映する）。一言に書いていない日付・時刻・人は、
 * 書く画面で先に選んでいたもの（開いた日など）を残す（§24 D37）
 */
export function nlpToPatch(
  d: NlpDraft,
  found: NlpFound,
  current: EventDraftVM,
): Partial<EventDraftVM> {
  const patch: Partial<EventDraftVM> = {
    title: d.title,
    isPrivate: d.isPrivate,
    recurrence: d.recurrence as RecurrenceVM,
    recurrenceEnd: { kind: 'never' },
  };
  if (d.location !== null) patch.location = d.location;
  const start = found.date ? d.startDate : current.startDate;
  if (found.date) patch.startDate = d.startDate;
  if (found.date || found.time) {
    // 日付をまたぐ時刻・複数日は、開始からの日数を保つ
    patch.endDate = addDays(start, Math.max(0, diffDays(d.startDate, d.endDate)));
  }
  if (found.time) {
    patch.allDay = d.allDay;
    patch.startTime = d.startTime;
    patch.endTime = d.endTime;
    patch.busy = d.busy;
  }
  if (found.members || d.isPrivate) {
    patch.memberIds = d.memberIds;
    patch.forEveryone = d.forEveryone;
  }
  return patch;
}

/** 書いていない日付についての質問（「今日と明日のどちら？」）は、先に選んでいた日があるので出さない */
export function visibleAmbiguities(list: NlpAmbiguity[], found: NlpFound): NlpAmbiguity[] {
  return list.filter((a) => a.field !== 'date' || found.date);
}

/** 曖昧さ → §22 AmbiguityVM（選んだら下書きに当てる変更） */
export function toAmbiguityVM(a: NlpAmbiguity, draft: EventDraftVM | null): AmbiguityVM {
  const span = draft ? Math.max(0, diffDays(draft.startDate, draft.endDate)) : 0;
  return {
    field: a.field,
    question: a.question,
    options: a.options.map((o) => {
      switch (a.field) {
        case 'date':
          return {
            label: o.label,
            patch: { startDate: o.value, endDate: addDays(o.value, span) },
          };
        case 'time':
          return {
            label: o.label,
            patch:
              o.value === 'all_day'
                ? { allDay: true, startTime: null, endTime: null, busy: false }
                : { allDay: false, startTime: o.value, endTime: null, busy: true },
          };
        case 'members':
          return { label: o.label, patch: { memberIds: [o.value], forEveryone: false } };
        default:
          return { label: o.label, patch: { title: o.value } };
      }
    }),
    chosen: null,
  };
}

/** /api/parse の応答（形が違えばルール解析のまま） */
const recurrenceSchema = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('daily'), interval: z.number().int() }),
  z.object({
    kind: z.literal('weekly'),
    interval: z.number().int(),
    weekdays: z.array(z.number().int().min(0).max(6)),
  }),
  z.object({ kind: z.literal('monthlyByDate'), day: z.number().int() }),
  z.object({
    kind: z.literal('monthlyByWeekday'),
    nth: z.array(z.number().int()),
    weekday: z.number().int().min(0).max(6),
  }),
  z.object({ kind: z.literal('yearly') }),
]);

export const parseResponseSchema = z.object({
  source: z.enum(['ai', 'rules']),
  reason: z.string().optional(),
  draft: z.object({
    title: z.string(),
    allDay: z.boolean(),
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    memberIds: z.array(z.string()),
    forEveryone: z.boolean(),
    location: z.string().nullable(),
    isPrivate: z.boolean(),
    busy: z.boolean(),
    recurrence: recurrenceSchema,
  }),
  ambiguities: z.array(
    z.object({
      field: z.enum(['date', 'time', 'members', 'title', 'recurrence']),
      question: z.string(),
      options: z.array(z.object({ label: z.string(), value: z.string() })),
    }),
  ),
  found: z.object({ date: z.boolean(), time: z.boolean(), members: z.boolean() }),
});

/**
 * 重なりの警告（§16。端末の DB で同じ日時の予定を探す）。予定ありの予定だけ。他人の非公開は「予定あり」。
 * 例: '10/10(土) は「家族旅行（金沢）」と重なっています'
 */
export function overlapsFor(
  draft: EventDraftVM,
  events: LocalEvent[],
  meId: string,
  exceptId: string | null,
): string[] {
  if (!draft.startDate) return [];
  let from: number;
  let to: number;
  if (draft.allDay) {
    from = fromJst(draft.startDate);
    to = fromJst(addDays(draft.endDate || draft.startDate, 1));
  } else {
    if (!draft.startTime) return [];
    from = fromJst(draft.startDate, draft.startTime);
    to = draft.endTime
      ? fromJst(draft.endDate || draft.startDate, draft.endTime)
      : from + 60 * MINUTE_MS;
    if (to <= from) to = from + 60 * MINUTE_MS;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const occs = expandAll(
    exceptId === null ? events : events.filter((e) => e.id !== exceptId && e.parentId !== exceptId),
    from,
    to,
  ).sort(compareOccurrences);
  for (const o of occs) {
    const e = o.event;
    if (!e.busy || !overlapsRange(o, from, to)) continue;
    const title = canSeeContent(e, meId) ? (e.title ?? '予定あり') : '予定あり';
    const day = o.startDate < draft.startDate ? draft.startDate : o.startDate;
    const label = `${formatMdW(day)} は「${title}」と重なっています`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= 3) break;
  }
  return out;
}
