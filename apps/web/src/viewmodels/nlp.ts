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
  parseRules,
} from '@ito/core';
import { z } from 'zod';
import type { LocalEvent } from '../data/db';
import type { AmbiguityVM, EventDraftVM, RecurrenceVM } from '../ui/types';

/**
 * 一言入力（§16）の PWA 側: ルール解析の文脈、解析の結果 → 書く画面の下書き・曖昧さ、重なりの警告
 */

/** ルール解析の文脈（家族の名前・略称・呼び名。自分の呼び名は me から） */
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
        aliases: m.id === me.id ? me.aliases : (m.aliases ?? []),
      })),
  };
}

export function parseLocally(text: string, ctx: NlpContext) {
  return parseRules(text, ctx);
}

export type NlpFound = NlpResult['found'];

/**
 * 解析の結果 → 下書きの変更（書く画面の札に反映する）。一言に書いていない日付・時刻・人・公開と非公開・
 * 繰り返しは、書く画面で先に選んでいたもの（開いた日、最近の予定の札、複製した予定）を残す（§24 D37）
 */
export function nlpToPatch(
  d: NlpDraft,
  found: NlpFound,
  current: EventDraftVM,
): Partial<EventDraftVM> {
  const patch: Partial<EventDraftVM> = { title: d.title };
  if (found.private) patch.isPrivate = true;
  if (found.recurrence) {
    patch.recurrence = d.recurrence as RecurrenceVM;
    patch.recurrenceEnd = { kind: 'never' };
  }
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
  if (found.members || found.private) {
    patch.memberIds = d.memberIds;
    patch.forEveryone = d.forEveryone;
  }
  return patch;
}

/**
 * いっしょに扱う項目（札で 1 つを選んだら、一言の解析では同じ組のほかの項目も上書きしない。§24 D37）。
 * 終わりの日は開始の日と、予定あり（busy）は終日・時刻と組にする
 */
export const DRAFT_FIELD_GROUPS: readonly (readonly (keyof EventDraftVM)[])[] = [
  ['startDate', 'endDate'],
  ['allDay', 'startTime', 'endTime', 'busy'],
  ['memberIds', 'forEveryone'],
  ['recurrence', 'recurrenceEnd'],
];

/** 項目とその組の項目 */
export function withGroups(keys: Iterable<string>): Set<string> {
  const out = new Set(keys);
  for (const g of DRAFT_FIELD_GROUPS) {
    if (g.some((k) => out.has(k))) for (const k of g) out.add(k);
  }
  return out;
}

/**
 * 解析の結果のうち、札で選んだ項目（とその組）は上書きしない（件名は一言から）。開始の日を札で選んでいて
 * 一言に日付をまたぐ時刻・複数日を書いたときは、終わりの日を選んだ日から数える
 */
export function protectTouched(
  patch: Partial<EventDraftVM>,
  touched: readonly string[],
  current: EventDraftVM,
): Partial<EventDraftVM> {
  const drop = withGroups(touched.filter((k) => k !== 'title'));
  const out: Record<string, unknown> = { ...patch };
  for (const k of drop) delete out[k];
  if (drop.has('startDate') && patch.endDate !== undefined && !drop.has('allDay')) {
    const span = diffDays(patch.startDate ?? current.startDate, patch.endDate);
    out.endDate = addDays(current.startDate, Math.max(0, span));
  }
  // 時刻を札で選んでいて日付を書いていなければ、時刻から決めた終わりの日（日付をまたぐ時刻）も当てない
  if (drop.has('allDay') && !('startDate' in out)) delete out.endDate;
  return out as Partial<EventDraftVM>;
}

/**
 * 一言の解析の結果を当てる変更を作る。前の解析で入れたのに今は書いていない項目は、入れる前の値に戻す
 * （「内緒」「毎週月」を消したら元に戻る）。textBefore は一言で入れた項目の、入れる前の値
 */
export function applyTextPatch(
  current: EventDraftVM,
  patch: Partial<EventDraftVM>,
  textBefore: Partial<EventDraftVM>,
): { patch: Partial<EventDraftVM>; textBefore: Partial<EventDraftVM> } {
  const next: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const prev = textBefore as Record<string, unknown>;
  const cur = current as unknown as Record<string, unknown>;
  for (const k of Object.keys(prev)) if (!(k in patch)) next[k] = prev[k];
  for (const [k, v] of Object.entries(patch)) {
    next[k] = v;
    if (k === 'title') continue;
    before[k] = k in prev ? prev[k] : cur[k];
  }
  return {
    patch: next as Partial<EventDraftVM>,
    textBefore: before as Partial<EventDraftVM>,
  };
}

/** 札・候補などで変えた項目は、一言で入れたものではなくなる（あとで戻さない） */
export function forgetTextFields(
  textBefore: Partial<EventDraftVM>,
  keys: Iterable<string>,
): Partial<EventDraftVM> {
  const drop = withGroups(keys);
  const out: Record<string, unknown> = { ...textBefore };
  for (const k of drop) delete out[k];
  return out as Partial<EventDraftVM>;
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

/** 終わりのない予定の長さ（重なりの警告。§24 D37） */
const OPEN_END_MINUTES = 60;

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
  found: z.object({
    date: z.boolean(),
    time: z.boolean(),
    members: z.boolean(),
    private: z.boolean().default(false),
    recurrence: z.boolean().default(false),
  }),
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
    if (draft.endTime) {
      // 保存と同じ決まり: 終わりが開始以前なら次の日（「+2時間」で 23:00〜1:00 にしたときなど）
      to = fromJst(draft.endDate || draft.startDate, draft.endTime);
      if (to <= from) to = fromJst(addDays(draft.startDate, 1), draft.endTime);
      if (to <= from) to = from + OPEN_END_MINUTES * MINUTE_MS;
    } else {
      to = from + OPEN_END_MINUTES * MINUTE_MS;
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  // 終わりのない予定は 60 分とみなすので、その分だけ前から展開する（§24 D37）
  const occs = expandAll(
    exceptId === null ? events : events.filter((e) => e.id !== exceptId && e.parentId !== exceptId),
    from - OPEN_END_MINUTES * MINUTE_MS,
    to,
  ).sort(compareOccurrences);
  for (const o of occs) {
    const e = o.event;
    const end = o.endMs ?? o.startMs + OPEN_END_MINUTES * MINUTE_MS;
    if (!e.busy || !(o.startMs < to && end > from)) continue;
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
