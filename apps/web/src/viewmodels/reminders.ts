import {
  effectiveOffsets,
  type NotificationSettings,
  type ReminderPrefDTO,
  reminderOptions,
} from '@ito/core';
import type { EventDraftVM } from '../ui/types';

/**
 * 自分への通知（§15・§22 myReminders）。本人の行があればそれ、なければ担当者に本人の既定値、担当外はなし。
 * サーバーのスケジューラと同じ core の effectiveOffsets で決める（シリーズの行は親の ID）
 */

type Defaults = Pick<NotificationSettings, 'timedDefaults' | 'allDayDefaults'>;

interface TargetLike {
  allDay: boolean;
  forEveryone: boolean;
  memberIds: readonly string[];
  visibility: 'family' | 'private';
  ownerId: string;
}

export function prefOf(prefs: readonly ReminderPrefDTO[] | undefined, eventId: string) {
  return prefs?.find((p) => p.eventId === eventId)?.offsets;
}

/** 詳細（S-04）に出す、自分への通知と選べる候補 */
export function myReminders(
  target: TargetLike,
  seriesId: string,
  meId: string,
  prefs: readonly ReminderPrefDTO[] | undefined,
  settings: Defaults,
): { myReminders: number[]; reminderOptions: number[] } {
  const current = effectiveOffsets(target, meId, prefOf(prefs, seriesId), settings);
  return {
    myReminders: current,
    reminderOptions:
      target.visibility === 'private' && target.ownerId !== meId
        ? []
        : reminderOptions(target.allDay, current),
  };
}

/** 書く画面の下書きのときの既定値（担当なら本人の既定値） */
export function draftDefaults(draft: EventDraftVM, meId: string, settings: Defaults): number[] {
  return effectiveOffsets(
    {
      allDay: draft.allDay,
      forEveryone: draft.forEveryone,
      memberIds: draft.memberIds,
      visibility: draft.isPrivate ? 'private' : 'family',
      ownerId: meId,
    },
    meId,
    undefined,
    settings,
  );
}

/** 書く画面の自分への通知の状態（§15） */
export interface ReminderDraftState {
  /** 自分への通知を触ったか */
  touched: boolean;
  /** 開いたときの本人の行（直すときだけ） */
  pref: number[] | undefined;
  /** 本人の行を付けたときの予定の種類（終日か） */
  prefAllDay: boolean;
  /** 本人の既定値（§15 の設定） */
  defaults: Defaults;
}

/**
 * 下書きが変わったときの自分への通知。触っていなければ、担当・終日の変更に合わせて既定値に追従する。
 * 終日⇔時刻ありを切り替えたら、前の種類の通知（触った値・本人の行）は意味が変わるので既定値に戻す
 * （時刻ありの「10分前」は終日では前日 23:50 になる）。元の種類に戻したら本人の行を使う
 */
export function followReminders(
  prev: EventDraftVM,
  next: EventDraftVM,
  state: ReminderDraftState,
  meId: string,
): { myReminders: number[]; touched: boolean } {
  const touched = next.allDay !== prev.allDay ? false : state.touched;
  if (touched) return { myReminders: next.myReminders, touched };
  const pref =
    state.pref !== undefined && next.allDay === state.prefAllDay ? state.pref : undefined;
  return { myReminders: pref ?? draftDefaults(next, meId, state.defaults), touched };
}

/**
 * 保存のときに本人の行を書くか: 触ったとき、または本人の行が違う種類（終日⇔時刻ありを切り替えた）のとき
 * （古い行を残すと、切り替えたあとの予定に前の種類の通知が効いてしまう）
 */
export function shouldWriteReminders(draft: EventDraftVM, state: ReminderDraftState): boolean {
  return state.touched || (state.pref !== undefined && draft.allDay !== state.prefAllDay);
}

export function sameOffsets(a: readonly number[], b: readonly number[]): boolean {
  const x = [...new Set(a)].sort((p, q) => p - q);
  const y = [...new Set(b)].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
