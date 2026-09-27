import {
  addDays,
  type DateISO,
  diffDays,
  fromJst,
  parseIsoToMs,
  toIsoJst,
  toJstParts,
} from './jst';
import { formatRrule, parseRrule, untilDate, untilFor } from './recurrence';
import type { EventChanges, EventCreate, EventDTO, Visibility } from './schemas';

/** サーバー内部の予定の形（時刻は epoch ミリ秒。§10） */
export interface EventRecord {
  id: string;
  version: number;
  title: string;
  note: string | null;
  location: string | null;
  allDay: boolean;
  startAt: number | null;
  endAt: number | null;
  startDate: DateISO | null;
  endDate: DateISO | null;
  rrule: string | null;
  exdates: string[];
  parentId: string | null;
  recurrenceId: string | null;
  memberIds: string[];
  forEveryone: boolean;
  busy: boolean;
  visibility: Visibility;
  ownerId: string;
  createdBy: string;
  updatedBy: string;
  deletedBy: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** 予定の中身（検証・正規化のあと） */
export interface EventFields {
  title: string;
  note: string | null;
  location: string | null;
  allDay: boolean;
  startAt: number | null;
  endAt: number | null;
  startDate: DateISO | null;
  endDate: DateISO | null;
  rrule: string | null;
  memberIds: string[];
  forEveryone: boolean;
  busy: boolean;
  visibility: Visibility;
}

export interface FieldError {
  field: string;
  message: string;
}

/** 扱う日付の範囲（祝日の表と繰り返しの展開が破綻しないように） */
export const MIN_DATE = '1970-01-01';
export const MAX_DATE = '2100-12-31';
/** 複数日の終日予定の最大日数（表示のループが膨らまないように） */
export const MAX_ALL_DAY_SPAN_DAYS = 366;

/** busy の既定値: 時刻あり=true、1 日の終日=false、複数日の終日=true（§10） */
export function defaultBusy(
  allDay: boolean,
  startDate: DateISO | null,
  endDate: DateISO | null,
): boolean {
  if (!allDay) return true;
  return Boolean(startDate && endDate && endDate > startDate);
}

/**
 * 作成の本文 → 予定の中身。終日と時刻ありの組み合わせ、終わり > 始まり、時刻ありは開始日の翌日 24:00 まで、
 * 非公開なら全員なし・担当は持ち主だけ、を確かめる（§10）。メンバーが有効かどうかは呼び出し側で確かめる。
 */
export function fieldsFromCreate(
  input: EventCreate,
  ownerId: string,
): { value: EventFields } | { errors: FieldError[] } {
  const allDay = input.allDay;
  const visibility = input.visibility ?? 'family';
  const forEveryone = visibility === 'private' ? false : (input.forEveryone ?? false);
  const raw: RawFields = {
    title: input.title,
    note: input.note ?? null,
    location: input.location ?? null,
    allDay,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? input.startDate ?? null,
    rrule: input.rrule ?? null,
    memberIds: input.memberIds ?? (forEveryone ? [] : [ownerId]),
    forEveryone,
    busy: input.busy,
    visibility,
  };
  return finalize(raw, ownerId);
}

/** 今の予定に changes を当てた中身 */
export function fieldsFromChanges(
  current: EventRecord,
  changes: EventChanges,
): { value: EventFields } | { errors: FieldError[] } {
  const allDay = changes.allDay ?? current.allDay;
  const switched = allDay !== current.allDay;
  const errors: FieldError[] = [];
  if (allDay && (changes.startAt != null || changes.endAt != null)) {
    errors.push({ field: 'startAt', message: '終日の予定に時刻は付けられません' });
  }
  if (!allDay && (changes.startDate != null || changes.endDate != null)) {
    errors.push({
      field: 'startDate',
      message: '時刻ありの予定は startAt で日時を指定してください',
    });
  }
  if (errors.length) return { errors };
  const visibility = changes.visibility ?? current.visibility;
  const raw: RawFields = {
    title: changes.title ?? current.title,
    note: changes.note !== undefined ? changes.note : current.note,
    location: changes.location !== undefined ? changes.location : current.location,
    allDay,
    startAt: allDay
      ? null
      : changes.startAt !== undefined
        ? changes.startAt
        : switched
          ? null
          : current.startAt,
    endAt: allDay
      ? null
      : changes.endAt !== undefined
        ? changes.endAt
        : switched
          ? null
          : current.endAt,
    startDate: !allDay
      ? null
      : changes.startDate !== undefined
        ? changes.startDate
        : switched
          ? null
          : current.startDate,
    endDate: !allDay
      ? null
      : changes.endDate !== undefined
        ? changes.endDate
        : switched
          ? null
          : current.endDate,
    rrule: changes.rrule !== undefined ? changes.rrule : current.rrule,
    memberIds: changes.memberIds ?? current.memberIds,
    forEveryone: visibility === 'private' ? false : (changes.forEveryone ?? current.forEveryone),
    busy: changes.busy ?? current.busy,
    visibility,
  };
  if (visibility === 'private' && changes.memberIds === undefined)
    raw.memberIds = [current.ownerId];
  return finalize(raw, current.ownerId);
}

interface RawFields {
  title: string;
  note: string | null;
  location: string | null;
  allDay: boolean;
  startAt: string | number | null;
  endAt: string | number | null;
  startDate: DateISO | null;
  endDate: DateISO | null;
  rrule: string | null;
  memberIds: string[];
  forEveryone: boolean;
  busy: boolean | undefined;
  visibility: Visibility;
}

function toMs(v: string | number | null): number | null {
  if (v === null) return null;
  return typeof v === 'number' ? v : parseIsoToMs(v);
}

function finalize(
  raw: RawFields,
  ownerId: string,
): { value: EventFields } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  let startAt: number | null = null;
  let endAt: number | null = null;
  let startDate: DateISO | null = null;
  let endDate: DateISO | null = null;

  if (raw.allDay) {
    if (raw.startAt !== null || raw.endAt !== null) {
      errors.push({ field: 'startAt', message: '終日の予定に時刻は付けられません' });
    }
    startDate = raw.startDate;
    endDate = raw.endDate ?? raw.startDate;
    if (!startDate) errors.push({ field: 'startDate', message: '開始日を入れてください' });
    if (startDate && endDate) {
      if (endDate < startDate)
        errors.push({ field: 'endDate', message: '終わりの日は始まりの日より後にしてください' });
      else if (diffDays(startDate, endDate) + 1 > MAX_ALL_DAY_SPAN_DAYS) {
        errors.push({
          field: 'endDate',
          message: `終日の予定は ${MAX_ALL_DAY_SPAN_DAYS} 日までにしてください`,
        });
      }
      if (startDate < MIN_DATE || endDate > MAX_DATE)
        errors.push({ field: 'startDate', message: '日付の範囲が正しくありません' });
    }
  } else {
    if (raw.startDate !== null || raw.endDate !== null) {
      errors.push({
        field: 'startDate',
        message: '時刻ありの予定は startAt で日時を指定してください',
      });
    }
    startAt = toMs(raw.startAt);
    endAt = toMs(raw.endAt);
    if (startAt === null) errors.push({ field: 'startAt', message: '開始の日時を入れてください' });
    else {
      const startDay = toJstParts(startAt).date;
      if (startDay < MIN_DATE || startDay > MAX_DATE)
        errors.push({ field: 'startAt', message: '日付の範囲が正しくありません' });
      if (endAt !== null) {
        if (endAt <= startAt)
          errors.push({ field: 'endAt', message: '終わりは始まりより後にしてください' });
        // 時刻ありの予定は開始日の翌日 24:00 までに終わる（§10）
        else if (endAt > fromJst(addDays(startDay, 2))) {
          errors.push({
            field: 'endAt',
            message:
              '時刻ありの予定は翌日の 24:00 までにしてください（長い予定は終日にしてください）',
          });
        }
      }
    }
  }

  // 繰り返し（§11）: サブセットの検証と、決まった順への正規化。時刻ありの UNTIL はその日の 23:59:59（浮動時刻）、
  // 終日は日付だけにする（rrule は日付だけの UNTIL を 0:00 と読み、時刻ありの最終日の回を落とすため）
  let rrule: string | null = null;
  if (raw.rrule !== null && raw.rrule.trim() !== '') {
    const parsed = parseRrule(raw.rrule);
    if (!parsed.ok) errors.push({ field: 'rrule', message: parsed.message });
    else {
      const rule = parsed.rule;
      if (rule.until !== null) {
        const untilDay = untilDate(rule.until);
        rule.until = untilFor(untilDay, raw.allDay);
        const first = startDate ?? (startAt === null ? null : toJstParts(startAt).date);
        if (first && untilDay < first)
          errors.push({
            field: 'rrule',
            message: '繰り返しの終わりは始まりの日より後にしてください',
          });
      }
      rrule = formatRrule(rule);
    }
  }

  const visibility = raw.visibility;
  let forEveryone = raw.forEveryone;
  let memberIds = [...new Set(raw.memberIds)];
  if (visibility === 'private') {
    forEveryone = false;
    if (memberIds.length !== 1 || memberIds[0] !== ownerId) {
      errors.push({ field: 'memberIds', message: '非公開の予定の担当は自分だけです' });
    }
  } else if (forEveryone) {
    memberIds = [];
  } else if (memberIds.length === 0) {
    errors.push({ field: 'memberIds', message: '家族のだれかか「全員」を選んでください' });
  }

  if (errors.length) return { errors };
  return {
    value: {
      title: raw.title,
      note: raw.note,
      location: raw.location,
      allDay: raw.allDay,
      startAt,
      endAt,
      startDate,
      endDate,
      rrule,
      memberIds,
      forEveryone,
      busy: raw.busy ?? defaultBusy(raw.allDay, startDate, endDate),
      visibility,
    },
  };
}

/** EventRecord → EventDTO（投影なし。閲覧してよい人にだけ使う） */
export function recordToDto(r: EventRecord): EventDTO {
  const base = {
    id: r.id,
    version: r.version,
    title: r.title,
    note: r.note,
    location: r.location,
    allDay: r.allDay,
    rrule: r.rrule,
    exdates: [...r.exdates],
    parentId: r.parentId,
    recurrenceId: r.recurrenceId,
    memberIds: [...r.memberIds],
    forEveryone: r.forEveryone,
    busy: r.busy,
    visibility: r.visibility,
    ownerId: r.ownerId,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    createdAt: toIsoJst(r.createdAt, true),
    updatedAt: toIsoJst(r.updatedAt, true),
  };
  return r.allDay
    ? { ...base, startDate: r.startDate as string, endDate: r.endDate as string }
    : {
        ...base,
        startAt: toIsoJst(r.startAt as number),
        endAt: r.endAt === null ? null : toIsoJst(r.endAt),
      };
}

/** 閲覧者がこの予定の中身を見てよいか（viewerId が null＝閲覧者なし。表示用フィード） */
export function canSeeContent(
  r: { visibility: Visibility; ownerId: string },
  viewerId: string | null,
): boolean {
  return r.visibility !== 'private' || (viewerId !== null && r.ownerId === viewerId);
}

/**
 * 閲覧者ごとの投影（§10）。サーバーのすべての出口で必ず通す。
 * 他人の非公開（例外行を含む）と、閲覧者なし（表示用フィード）の非公開は、中身を消した形だけを返す。
 */
export function projectEvent(r: EventRecord, viewerId: string | null): EventDTO {
  const dto = recordToDto(r);
  if (canSeeContent(r, viewerId)) return dto;
  const times = r.allDay
    ? { startDate: dto.startDate as string, endDate: dto.endDate as string }
    : { startAt: dto.startAt as string, endAt: dto.endAt ?? null };
  return {
    id: r.id,
    version: r.version,
    title: null,
    note: null,
    location: null,
    allDay: r.allDay,
    ...times,
    rrule: r.rrule,
    exdates: [...r.exdates],
    parentId: r.parentId,
    recurrenceId: r.recurrenceId,
    memberIds: [r.ownerId],
    forEveryone: false,
    busy: r.busy,
    visibility: 'private',
    ownerId: r.ownerId,
    createdBy: r.ownerId,
    updatedBy: r.ownerId,
    createdAt: null,
    updatedAt: null,
  };
}

/** 時刻ありの予定の終わりの上限（開始日の翌日 24:00） */
export function maxEndOfTimed(startAtMs: number): number {
  return fromJst(addDays(toJstParts(startAtMs).date, 2));
}

/** EventDTO → EventRecord（PWA で手元の変更を当てるため。中身を見てよい予定にだけ使う） */
export function dtoToRecord(dto: EventDTO): EventRecord {
  return {
    id: dto.id,
    version: dto.version,
    title: dto.title ?? '',
    note: dto.note,
    location: dto.location,
    allDay: dto.allDay,
    startAt: dto.startAt ? parseIsoToMs(dto.startAt) : null,
    endAt: dto.endAt ? parseIsoToMs(dto.endAt) : null,
    startDate: dto.startDate ?? null,
    endDate: dto.endDate ?? null,
    rrule: dto.rrule,
    exdates: [...dto.exdates],
    parentId: dto.parentId,
    recurrenceId: dto.recurrenceId,
    memberIds: [...dto.memberIds],
    forEveryone: dto.forEveryone,
    busy: dto.busy,
    visibility: dto.visibility,
    ownerId: dto.ownerId,
    createdBy: dto.createdBy,
    updatedBy: dto.updatedBy,
    deletedBy: null,
    createdAt: dto.createdAt ? (parseIsoToMs(dto.createdAt) ?? 0) : 0,
    updatedAt: dto.updatedAt ? (parseIsoToMs(dto.updatedAt) ?? 0) : 0,
    deletedAt: null,
  };
}

/** 手元で作る（オフライン作成）。サーバーと同じ検証を通す */
export function createLocally(
  input: EventCreate,
  id: string,
  meId: string,
  nowMs: number,
): { value: EventDTO } | { errors: FieldError[] } {
  const fields = fieldsFromCreate(input, meId);
  if ('errors' in fields) return fields;
  const record: EventRecord = {
    id,
    version: 0,
    ...fields.value,
    exdates: [],
    parentId: null,
    recurrenceId: null,
    ownerId: meId,
    createdBy: meId,
    updatedBy: meId,
    deletedBy: null,
    createdAt: nowMs,
    updatedAt: nowMs,
    deletedAt: null,
  };
  return { value: recordToDto(record) };
}

/** 手元で変更を当てる（サーバーと同じ検証）。version はサーバーが上げるので変えない */
export function applyChangesLocally(
  dto: EventDTO,
  changes: EventChanges,
  meId: string,
  nowMs: number,
): { value: EventDTO } | { errors: FieldError[] } {
  const current = dtoToRecord(dto);
  const fields = fieldsFromChanges(current, changes);
  if ('errors' in fields) return fields;
  return { value: recordToDto({ ...current, ...fields.value, updatedBy: meId, updatedAt: nowMs }) };
}
