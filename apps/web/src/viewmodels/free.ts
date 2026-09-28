import { addDays, type DateISO, FREE_PRESET_WINDOWS, formatMdW, freeBusy } from '@ito/core';
import type { LocalEvent } from '../data/db';
import type { FreePreset, FreeTimeVM } from '../ui/types';
import type { VmContext } from './occurrence';

/** 空き時間の画面で見る日数（§22 FreeTimeVM の rangeLabel は 1 週間） */
export const FREE_RANGE_DAYS = 7;

/**
 * S-06 空き時間の VM（§22 FreeTimeVM）。端末の DB の予定から @ito/core/freebusy で作る（オフラインでも使える）。
 * 無効にした家族は選べない（呼び出し側で有効な家族だけを渡す）
 */
export function buildFreeTimeVM(input: {
  events: readonly LocalEvent[];
  start: DateISO;
  preset: FreePreset;
  minDuration: 60 | 120 | 240;
  memberIds: string[];
  ctx: Pick<VmContext, 'nowMs' | 'meId'>;
}): FreeTimeVM {
  const { start, preset, minDuration, memberIds, ctx } = input;
  const r = freeBusy({
    events: input.events,
    from: start,
    days: FREE_RANGE_DAYS,
    memberIds,
    preset,
    minDuration,
    nowMs: ctx.nowMs,
    viewerId: ctx.meId,
  });
  const window = FREE_PRESET_WINDOWS[preset];
  return {
    rangeLabel: `${formatMdW(start)} – ${formatMdW(addDays(start, FREE_RANGE_DAYS - 1))}`,
    preset,
    dayStartMin: window.startMin,
    dayEndMin: window.endMin,
    minDuration,
    memberIds,
    candidates: r.candidates.map((c) => ({
      date: c.date,
      label: c.label,
      startMin: c.startMin,
      endMin: c.endMin,
    })),
    days: r.days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      holiday: d.holiday,
      busy: d.busy.map((b) => ({ ...b })),
      commonFree: d.commonFree.map((f) => ({ ...f })),
    })),
  };
}
