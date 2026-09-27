import {
  addDays,
  defaultBusy,
  diffDays,
  isValidDate,
  minutesOfTime,
  timeFromMinutes,
} from '@ito/core';
import type { EventDraftVM } from '../ui/types';

const MINUTES_PER_DAY = 24 * 60;

/**
 * 下書きに変更を当てる（書く画面の札・入力欄から）。
 * - 開始日を動かしたら、終わりの日も同じ日数だけ動かす（長さを保つ）
 * - busy をまだ自分で変えていなければ、終日・日付に合わせて §10 の既定値にする（複数日の終日は busy）
 */
export function applyDraftPatch(
  draft: EventDraftVM,
  patch: Partial<EventDraftVM>,
  opts: { busyTouched: boolean },
): EventDraftVM {
  const next: EventDraftVM = { ...draft, ...patch };
  if (
    patch.startDate !== undefined &&
    patch.endDate === undefined &&
    isValidDate(patch.startDate) &&
    isValidDate(draft.startDate) &&
    isValidDate(draft.endDate)
  ) {
    const length = Math.max(0, diffDays(draft.startDate, draft.endDate));
    next.endDate = addDays(patch.startDate, length);
  }
  // 開始の時刻を動かしたら、終わりの時刻も同じだけ動かす（長さを保つ。§6.2「予定の時刻を直す」）
  if (
    patch.startTime &&
    patch.endTime === undefined &&
    !next.allDay &&
    draft.startTime &&
    draft.endTime
  ) {
    const length =
      diffDays(draft.startDate, draft.endDate) * MINUTES_PER_DAY +
      minutesOfTime(draft.endTime) -
      minutesOfTime(draft.startTime);
    if (length > 0 && length < MINUTES_PER_DAY) {
      const end = minutesOfTime(patch.startTime) + length;
      next.endTime = timeFromMinutes(end % MINUTES_PER_DAY);
      next.endDate = end >= MINUTES_PER_DAY ? addDays(next.startDate, 1) : next.startDate;
    }
  }
  if (next.allDay && next.endDate < next.startDate) next.endDate = next.startDate;
  if (!next.allDay && next.endDate > addDays(next.startDate, 1)) next.endDate = next.startDate;
  if (next.isPrivate) {
    next.forEveryone = false;
  }
  const touchesShape =
    patch.allDay !== undefined || patch.startDate !== undefined || patch.endDate !== undefined;
  if (!opts.busyTouched && patch.busy === undefined && touchesShape) {
    next.busy = defaultBusy(next.allDay, next.startDate, next.endDate);
  }
  return next;
}
