import { HOLIDAYS_PACKED } from './holidays-data';
import type { DateISO } from './jst';

/**
 * 祝日（振替休日・国民の休日を含む。SPEC §5 F-07）。
 * データは @holiday-jp/holiday_jp の表から作った小さな表（scripts/gen-holidays.mjs。2000 年以降）。
 * holiday_jp の between() は端末のタイムゾーンで日付を作るので使わず、日付文字列で引く。
 * 表とライブラリが一致することは core のテストで確かめる。
 */
let byDate: Map<string, string> | null = null;
let sortedDates: string[] | null = null;

function table(): Map<string, string> {
  if (byDate) return byDate;
  byDate = new Map();
  for (const row of HOLIDAYS_PACKED.split('|')) {
    const d = `${row.slice(0, 4)}-${row.slice(4, 6)}-${row.slice(6, 8)}`;
    byDate.set(d, row.slice(8));
  }
  return byDate;
}

export function holidayName(date: DateISO): string | null {
  return table().get(date) ?? null;
}

/** [from, to) の祝日を日付の順で */
export function holidaysBetween(from: DateISO, to: DateISO): { date: DateISO; name: string }[] {
  const t = table();
  sortedDates ??= [...t.keys()].sort();
  const out: { date: DateISO; name: string }[] = [];
  for (const d of sortedDates) {
    if (d < from) continue;
    if (d >= to) break;
    out.push({ date: d, name: t.get(d) as string });
  }
  return out;
}
