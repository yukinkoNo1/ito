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
}): FlowScreenData {
  const { events, ctx, filter } = input;
  // 週の帯・日付で移動した日は、予定がなくても日の見出しを出して、そこへ合わせる
  const items = buildFlowItems(events, input.from, input.to, ctx, filter, [input.selectedDate]);
  let freshCount = 0;
  for (const item of items) {
    if (item.kind !== 'day') continue;
    for (const a of item.day.allDay)
      if (a.occ.fresh && (a.span === 'single' || a.span === 'start')) freshCount++;
    for (const t of item.day.timed) if (t.occ.fresh) freshCount++;
  }
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
