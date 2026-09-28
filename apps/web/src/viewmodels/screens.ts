import {
  addDays,
  type DateISO,
  type MeDTO,
  type MemberDTO,
  parseDate,
  toJstParts,
} from '@ito/core';
import type { LocalEvent } from '../data/db';
import type {
  AdminMemberVM,
  FlowScreenProps,
  HomeNoticeVM,
  MemberColor,
  MonthScreenProps,
  SettingsVM,
  SyncVM,
} from '../ui/types';
import { buildDay, buildFlowItems, buildSummary, buildWeek, groupByDay } from './flow';
import { longDateLabel } from './labels';
import { buildMonth, toMonthCell } from './month';
import { toMemberVMs, type VmContext } from './occurrence';

export const EMPTY_EXAMPLES = ['明日18時 みんなで夕食', '土曜10時 父 ゴルフ', '毎週日曜 母 ヨガ'];
export const COMPOSER_HINT = '例: 土曜10時 父 ゴルフ';

export type FlowScreenData = Omit<
  FlowScreenProps,
  | 'sync'
  | 'onPickExample'
  | 'onSetFilter'
  | 'onJumpToFresh'
  | 'onJumpToDate'
  | 'onPrevWeek'
  | 'onNextWeek'
  | 'onOpenOccurrence'
  | 'onComposeOnDate'
  | 'onReachStart'
  | 'onReachEnd'
  | 'onJumpToday'
  | 'onNoticeAction'
  | 'onNoticeDismiss'
  | 'onOpenActivity'
  | 'onOpenSearch'
>;

/** これからの画面は表示範囲の前後 8 週だけ描画し、端で追加読み込み（§19） */
export const FLOW_WINDOW_DAYS = 56;

/** 端で足す日数と、足せる範囲（今日から過去 1 年・未来 3 年） */
export const FLOW_EXTEND_DAYS = 28;
export const FLOW_PAST_LIMIT = -366;
export const FLOW_FUTURE_LIMIT = 366 * 3;
/**
 * 一度に描く範囲の上限（§19「表示範囲の前後 8 週だけ描画し、端で追加読み込み」。§24 D38）。
 * 端までスクロールして足したら反対側の端を削る（見ている位置は UpcomingScreen が行の key で保つ）
 */
export const MAX_FLOW_DAYS = FLOW_WINDOW_DAYS * 2 + FLOW_EXTEND_DAYS;

/**
 * これからの一覧の範囲を端で広げる。反対側を削るのは、端までスクロールしたとき（byScroll）だけ
 * （一覧が画面に収まっているときのタップで広げるときは削らない。今日の日が消えないように）
 */
export function extendFlowRange(
  range: { from: DateISO; to: DateISO },
  side: 'start' | 'end',
  byScroll: boolean,
  today: DateISO,
): { from: DateISO; to: DateISO } {
  const min = addDays(today, FLOW_PAST_LIMIT);
  const max = addDays(today, FLOW_FUTURE_LIMIT);
  const clamp = (d: DateISO) => (d < min ? min : d > max ? max : d);
  if (side === 'end') {
    const to = clamp(addDays(range.to, FLOW_EXTEND_DAYS));
    const trimmed = addDays(to, -MAX_FLOW_DAYS);
    return { from: byScroll && trimmed > range.from ? trimmed : range.from, to };
  }
  const from = clamp(addDays(range.from, -FLOW_EXTEND_DAYS));
  const trimmed = addDays(from, MAX_FLOW_DAYS);
  return { from, to: byScroll && trimmed < range.to ? trimmed : range.to };
}

/**
 * 「新しい予定 n件」の数。スクロールで描く範囲が変わっても同じ数になるよう、いつも最初の範囲（今日の前後）で数える。
 * 範囲を足すたびに数え直さないよう、FlowContainer は範囲と別に覚えておく（§19。§24 D40）
 */
export function countFlowFresh(
  events: LocalEvent[],
  ctx: VmContext,
  filter: string[] | null,
): number {
  const items = buildFlowItems(
    events,
    addDays(ctx.today, -1),
    addDays(ctx.today, FLOW_WINDOW_DAYS),
    ctx,
    filter,
    [],
  );
  let freshCount = 0;
  for (const item of items) {
    if (item.kind !== 'day') continue;
    for (const a of item.day.allDay)
      if (a.occ.fresh && (a.span === 'single' || a.span === 'start')) freshCount++;
    for (const t of item.day.timed) if (t.occ.fresh) freshCount++;
  }
  return freshCount;
}

/** 素のデータ（VM）の中身が同じか（関数を含まない配列・オブジェクト・プリミティブ） */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameData(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => Object.hasOwn(rb, k) && sameData(ra[k], rb[k]));
}

/**
 * 作り直した一覧のうち、中身が前と同じ行は前のオブジェクトを使う（範囲を足したとき、変わらない日を
 * 描き直さない。UpcomingScreen は行を memo で描く。§19。§24 D40）
 */
export function reuseSame<T extends { key: string }>(prev: readonly T[] | null, next: T[]): T[] {
  if (!prev || prev.length === 0) return next;
  const byKey = new Map(prev.map((item) => [item.key, item]));
  return next.map((item) => {
    const old = byKey.get(item.key);
    return old !== undefined && sameData(old, item) ? old : item;
  });
}

export function buildFlowScreen(input: {
  events: LocalEvent[];
  ctx: VmContext;
  filter: string[] | null;
  from: DateISO;
  to: DateISO;
  selectedDate: DateISO;
  weekStart: 0 | 1;
  unreadActivity: number;
  notice: HomeNoticeVM;
  showBackToToday: boolean;
  /** 範囲と別に数えた「新しい予定」の数（なければここで数える） */
  freshCount?: number;
}): FlowScreenData {
  const { events, ctx, filter } = input;
  // 週の帯・日付で移動した日は、予定がなくても日の見出しを出して、そこへ合わせる
  const items = buildFlowItems(events, input.from, input.to, ctx, filter, [input.selectedDate]);
  const freshCount = input.freshCount ?? countFlowFresh(events, ctx, filter);
  const todayOccs = groupByDay(events, ctx.today, addDays(ctx.today, 1), ctx, null).get(ctx.today);
  const today = buildDay(ctx.today, todayOccs, ctx);
  return {
    items,
    members: toMemberVMs(ctx.members, ctx.meId),
    anchorKey: `day:${input.selectedDate}`,
    headerDateLabel: `${parseDate(ctx.today).year}年 ${longDateLabel(ctx.today)}`,
    // ④「新しい予定 n件」はボタン（freshCount）で出すので、まとめの文には入れない
    summary: buildSummary(today, ctx.members, 0),
    freshCount,
    week: buildWeek(events, input.selectedDate, input.weekStart, ctx, filter, (d, o, inMonth) =>
      toMonthCell(d, o, inMonth, ctx),
    ),
    selectedDate: input.selectedDate,
    filterMemberIds: filter,
    unreadActivity: input.unreadActivity,
    showBackToToday: input.showBackToToday,
    notice: input.notice,
    // 入力例は、手元に予定が 1 件もないときだけ（絞り込みや範囲で 0 件のときは日の見出しを出す）
    emptyExamples: events.some((e) => e.parentId === null) ? [] : EMPTY_EXAMPLES,
  };
}

export type MonthScreenData = Omit<
  MonthScreenProps,
  | 'onSelectDate'
  | 'onPrevMonth'
  | 'onNextMonth'
  | 'onPickMonth'
  | 'onToday'
  | 'onOpenOccurrence'
  | 'onComposeOnDate'
>;

export function buildMonthScreen(input: {
  events: LocalEvent[];
  ctx: VmContext;
  year: number;
  month: number;
  selectedDate: DateISO;
  weekStart: 0 | 1;
}): MonthScreenData {
  const { events, ctx } = input;
  const day = buildDay(
    input.selectedDate,
    groupByDay(events, input.selectedDate, addDays(input.selectedDate, 1), ctx, null).get(
      input.selectedDate,
    ),
    ctx,
  );
  return {
    month: buildMonth(events, input.year, input.month, input.weekStart, ctx),
    members: toMemberVMs(ctx.members, ctx.meId),
    selectedDate: input.selectedDate,
    selectedDay: day,
  };
}

/** 同期が止まった理由（§12: 401 no_identity・403 not_member・426 client_outdated） */
export type SyncBlockVM =
  | { kind: 'no_identity' }
  | { kind: 'not_member'; login: string | null }
  | { kind: 'client_outdated' }
  | { kind: 'server' };

function blockLabel(block: SyncBlockVM): string {
  switch (block.kind) {
    case 'no_identity':
      return 'ログインが確認できません（Tailscale を確認）';
    case 'not_member':
      return `このアカウント（${block.login ?? '不明'}）は家族として登録されていません`;
    case 'client_outdated':
      return 'アプリを更新してください';
    case 'server':
      return '家のサーバーの応答を読めません';
  }
}

/** SyncVM（'14:18' の形の最終同期の時刻。止まっていれば理由と C-02 のボタン） */
export function toSyncVM(
  status: SyncVM['status'],
  lastSyncedAt: number | null,
  pendingCount: number,
  block: SyncBlockVM | null = null,
): SyncVM {
  return {
    status,
    lastSyncedLabel: lastSyncedAt === null ? null : toJstParts(lastSyncedAt).time,
    pendingCount,
    errorLabel: status === 'error' && block ? blockLabel(block) : null,
    action: block?.kind === 'client_outdated' ? 'update' : 'retry',
  };
}

export function buildSettingsVM(input: {
  me: MeDTO;
  members: MemberDTO[];
  adminMembers: AdminMemberVM[];
  textSize: SettingsVM['textSize'];
  permission: SettingsVM['notifications']['permission'];
  devices: SettingsVM['devices'];
  install: SettingsVM['install'];
  appVersion: string;
}): SettingsVM {
  const { me } = input;
  const n = me.settings.notifications;
  return {
    me: { id: me.id, name: me.name, mark: me.mark, color: me.color as MemberColor, isMe: true },
    aliases: me.aliases,
    takenColors: input.members
      .filter((m) => m.id !== me.id && !m.disabled)
      .map((m) => ({ color: m.color, mark: m.mark })),
    textSize: input.textSize,
    theme: me.settings.theme,
    weekStart: me.settings.weekStart,
    notifications: {
      permission: input.permission,
      timedDefaults: n.timedDefaults,
      allDayDefaults: n.allDayDefaults,
      morningDigest: n.morningDigest,
      eveningPreview: n.eveningPreview,
      familyChanges: n.familyChanges,
      quietHours: n.quietHours,
      showDetailsOnLockScreen: n.showDetailsOnLockScreen,
    },
    devices: input.devices,
    isAdmin: me.role === 'admin',
    members: me.role === 'admin' ? input.adminMembers : [],
    install: input.install,
    appVersion: input.appVersion,
  };
}

/** 週の帯の「前の週・次の週」 */
export function shiftWeek(date: DateISO, delta: number): DateISO {
  return addDays(date, delta * 7);
}
