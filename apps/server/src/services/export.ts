import {
  addDays,
  canSeeContent,
  type EventDTO,
  type EventRecord,
  fromJst,
  JST_OFFSET_MS,
  type MemberDTO,
  projectEvent,
  todayJst,
  toIsoJst,
  toJstParts,
} from '@ito/core';
import type { DbLike } from '../db/client';
import type { MemberRow } from '../db/schema';
import { listAllMembers } from './members';
import { loadActiveEvents } from './records';
import { toMemberDto } from './sync';

/**
 * 書き出し（GET /api/export?format=json｜ics。§13・§5 F-20）。
 * - 他人の非公開は含めない（その例外行も）。自分の非公開は含める（ICS では CLASS:PRIVATE）
 * - ゴミ箱の予定は含めない
 * - ICS: VTIMEZONE(Asia/Tokyo)、終日の DTEND は翌日（含まない）、「この回だけ変更」は RECURRENCE-ID 付きの VEVENT、
 *   「この回だけ削除」は EXDATE。時刻ありの UNTIL（浮動時刻の 23:59:59）は RFC 5545 のとおり UTC にする
 */

export type ExportFormat = 'json' | 'ics';

/** 見る人に書き出してよい予定（他人の非公開と、その例外行を除く） */
export function exportableRecords(db: DbLike, viewerId: string): EventRecord[] {
  return loadActiveEvents(db).filter((r) => canSeeContent(r, viewerId));
}

export interface JsonExport {
  format: 'ito-export';
  version: 1;
  exportedAt: string;
  members: MemberDTO[];
  events: EventDTO[];
}

export function buildJsonExport(db: DbLike, me: MemberRow, nowMs: number): JsonExport {
  return {
    format: 'ito-export',
    version: 1,
    exportedAt: toIsoJst(nowMs),
    members: listAllMembers(db).map(toMemberDto),
    events: exportableRecords(db, me.id).map((r) => projectEvent(r, me.id)),
  };
}

/* ───────── ICS（RFC 5545） ───────── */

/** テキストの値のエスケープ（\ ; , と改行） */
export function icsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** 1 行を 75 オクテットで折り返す（続きの行は空白 1 つで始める。UTF-8 の文字の途中では切らない） */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** epoch ミリ秒 → UTC の日時（20261003T100000Z）。日本時間の部品から 9 時間戻して作る */
function utcStamp(ms: number): string {
  const u = toJstParts(ms - JST_OFFSET_MS);
  return `${dateValue(u.date)}T${pad(u.hour)}${pad(u.minute)}${pad(u.second)}Z`;
}

/** '2026-10-03' → '20261003' */
function dateValue(date: string): string {
  return date.replace(/-/g, '');
}

/** '2026-10-03T19:00:00+09:00' → '20261003T190000'（日本時間の壁時計） */
function localDateTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
  if (!m) return '';
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? '00'}`;
}

/** recurrenceId（'2026-09-30T07:30' か '2026-09-30'）→ RECURRENCE-ID・EXDATE の値と引数 */
function ridProperty(name: 'RECURRENCE-ID' | 'EXDATE', rids: string[], allDay: boolean): string {
  if (allDay) return `${name};VALUE=DATE:${rids.map((r) => dateValue(r)).join(',')}`;
  return `${name};TZID=Asia/Tokyo:${rids.map((r) => `${dateValue(r.slice(0, 10))}T${r.slice(11, 13)}${r.slice(14, 16)}00`).join(',')}`;
}

/** 時刻ありの UNTIL（浮動時刻）を UTC にする。終日は日付のまま */
export function icsRrule(rrule: string, allDay: boolean): string {
  if (allDay) return rrule;
  return rrule.replace(
    /UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
    (_m, y, mo, d, h, mi, s) => {
      const ms = fromJst(`${y}-${mo}-${d}`, `${h}:${mi}`) + Number(s) * 1000;
      return `UNTIL=${utcStamp(ms)}`;
    },
  );
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Tokyo',
  'BEGIN:STANDARD',
  'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0900',
  'TZOFFSETTO:+0900',
  'TZNAME:JST',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function vevent(
  e: EventDTO,
  uid: string,
  stamp: string,
  names: Map<string, string>,
  seriesAllDay: boolean,
): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`];
  if (e.recurrenceId) lines.push(ridProperty('RECURRENCE-ID', [e.recurrenceId], seriesAllDay));
  if (e.allDay && e.startDate) {
    lines.push(`DTSTART;VALUE=DATE:${dateValue(e.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${dateValue(addDays(e.endDate ?? e.startDate, 1))}`);
  } else if (e.startAt) {
    lines.push(`DTSTART;TZID=Asia/Tokyo:${localDateTime(e.startAt)}`);
    if (e.endAt) lines.push(`DTEND;TZID=Asia/Tokyo:${localDateTime(e.endAt)}`);
  }
  if (e.rrule && !e.parentId) {
    lines.push(`RRULE:${icsRrule(e.rrule, e.allDay)}`);
    if (e.exdates.length > 0) lines.push(ridProperty('EXDATE', e.exdates, e.allDay));
  }
  lines.push(`SUMMARY:${icsText(e.title ?? '')}`);
  if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
  if (e.note) lines.push(`DESCRIPTION:${icsText(e.note)}`);
  const who = e.forEveryone
    ? ['全員']
    : e.memberIds.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  if (who.length > 0) lines.push(`CATEGORIES:${who.map(icsText).join(',')}`);
  lines.push(`TRANSP:${e.busy ? 'OPAQUE' : 'TRANSPARENT'}`);
  if (e.visibility === 'private') lines.push('CLASS:PRIVATE');
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcsExport(db: DbLike, me: MemberRow, nowMs: number): string {
  const events = exportableRecords(db, me.id).map((r) => projectEvent(r, me.id));
  const names = new Map(listAllMembers(db).map((m) => [m.id, m.name]));
  const parents = new Map(events.filter((e) => !e.parentId).map((e) => [e.id, e]));
  const stamp = utcStamp(nowMs);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ito//family calendar//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText('いと')}`,
    'X-WR-TIMEZONE:Asia/Tokyo',
    ...VTIMEZONE,
  ];
  // 親を先に、例外行（この回だけ変更）はその親のあとに（同じ UID・RECURRENCE-ID 付き）
  const ordered = [...events].sort((a, b) =>
    a.parentId === b.parentId ? (a.id < b.id ? -1 : 1) : a.parentId ? 1 : -1,
  );
  for (const e of ordered) {
    const parent = e.parentId ? parents.get(e.parentId) : e;
    if (!parent) continue;
    lines.push(...vevent(e, `${parent.id}@ito`, stamp, names, parent.allDay));
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** 書き出しのファイル名（ito-20260927.json） */
export function exportFileName(format: ExportFormat, nowMs: number): string {
  return `ito-${todayJst(nowMs).replace(/-/g, '')}.${format}`;
}
