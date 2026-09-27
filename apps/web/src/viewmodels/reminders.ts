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

export function sameOffsets(a: readonly number[], b: readonly number[]): boolean {
  const x = [...new Set(a)].sort((p, q) => p - q);
  const y = [...new Set(b)].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
