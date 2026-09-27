import table from '@holiday-jp/holiday_jp/lib/holidays';
import type { DateISO } from './jst';

/**
 * 祝日（振替休日・国民の休日を含む。SPEC §5 F-07）。
 * holiday_jp の between() は端末のタイムゾーンで日付を作るので使わず、日付文字列をキーにした表を直接引く。
 */
const byDate: Readonly<Record<string, { date: string; name: string }>> = table;

export function holidayName(date: DateISO): string | null {
  return byDate[date]?.name ?? null;
}

let sortedDates: string[] | null = null;

/** [from, to) の祝日を日付の順で */
export function holidaysBetween(from: DateISO, to: DateISO): { date: DateISO; name: string }[] {
  sortedDates ??= Object.keys(byDate).sort();
  const out: { date: DateISO; name: string }[] = [];
  for (const d of sortedDates) {
    if (d < from) continue;
    if (d >= to) break;
    out.push({ date: d, name: (byDate[d] as { name: string }).name });
  }
  return out;
}
