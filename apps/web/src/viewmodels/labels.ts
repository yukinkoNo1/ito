import {
  type DateISO,
  diffDays,
  formatMdW,
  parseDate,
  parseIsoToMs,
  toJstParts,
  WEEKDAY_LABELS,
  weekdayOf,
} from '@ito/core';

const WEEKDAY_LONG = [
  '日曜日',
  '月曜日',
  '火曜日',
  '水曜日',
  '木曜日',
  '金曜日',
  '土曜日',
] as const;
export const WAFU = [
  '睦月',
  '如月',
  '弥生',
  '卯月',
  '皐月',
  '水無月',
  '文月',
  '葉月',
  '長月',
  '神無月',
  '霜月',
  '師走',
] as const;

/** '9月27日 日曜日' */
export function longDateLabel(date: DateISO): string {
  const { month, day } = parseDate(date);
  return `${month}月${day}日 ${WEEKDAY_LONG[weekdayOf(date)]}`;
}

/** '10月3日(土)' */
export function dateWithWeekday(date: DateISO): string {
  const { month, day } = parseDate(date);
  return `${month}月${day}日(${WEEKDAY_LABELS[weekdayOf(date)]})`;
}

/** 詳細の日付: '10月3日 土曜日'、複数日は '10月10日(土) – 12日(月)'（月が違えば '10月31日(土) – 11月2日(月)'） */
export function detailDateLabel(startDate: DateISO, endDate: DateISO, allDay: boolean): string {
  if (!allDay || startDate === endDate) return longDateLabel(startDate);
  const s = parseDate(startDate);
  const e = parseDate(endDate);
  const end =
    s.year === e.year && s.month === e.month
      ? `${e.day}日(${WEEKDAY_LABELS[weekdayOf(endDate)]})`
      : dateWithWeekday(endDate);
  return `${dateWithWeekday(startDate)} – ${end}`;
}

/** 詳細の時刻: '07:00 — 15:00' / '07:30' / 日付をまたぐと '22:00 — 翌01:00' / 終日は null */
export function detailTimeLabel(
  allDay: boolean,
  startDate: DateISO,
  startTime: string | null,
  endDate: DateISO,
  endTime: string | null,
): string | null {
  if (allDay || !startTime) return null;
  if (!endTime) return startTime;
  const next = diffDays(startDate, endDate) >= 1 ? '翌' : '';
  return `${startTime} — ${next}${endTime}`;
}

/** '更新 お母さん · 9/25 21:04' */
export function updatedLabel(name: string | null, updatedAt: string | null): string {
  if (!name || !updatedAt) return '';
  const ms = parseIsoToMs(updatedAt);
  if (ms === null) return '';
  const p = toJstParts(ms);
  return `更新 ${name} · ${p.month}/${p.day} ${p.time}`;
}

/** 履歴の見出し: '今日' '昨日' '9/25(金)' */
export function dayGroupLabel(date: DateISO, today: DateISO): string {
  const d = diffDays(date, today);
  if (d === 0) return '今日';
  if (d === 1) return '昨日';
  return formatMdW(date);
}

/** 履歴の時刻: '3分前'（1 時間以内）/ '21:40' */
export function relativeTimeLabel(ms: number, nowMs: number): string {
  const min = Math.floor((nowMs - ms) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  return toJstParts(ms).time;
}
