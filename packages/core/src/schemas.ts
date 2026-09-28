import './zod-config';
import { z } from 'zod';
import { UUID_RE } from './ids';
import { isValidDate, isValidTime, parseIsoToMs } from './jst';
import {
  memberAliasesSchema,
  memberColorSchema,
  memberMarkSchema,
  memberNameSchema,
} from './members';
import { graphemeLength, normalizeText, withinGraphemes } from './text';

/* ───────── 基本 ───────── */

export const uuidSchema = z.string().regex(UUID_RE, 'ID の形式が正しくありません');
export const dateIsoSchema = z.string().refine(isValidDate, '日付の形式が正しくありません');
export const timeHmSchema = z.string().refine(isValidTime, '時刻の形式が正しくありません');
export const isoDateTimeSchema = z
  .string()
  .refine((v) => parseIsoToMs(v) !== null, '日時の形式が正しくありません');
/** recurrenceId: 時刻あり 'YYYY-MM-DDTHH:mm'、終日 'YYYY-MM-DD'（§3） */
export const recurrenceIdSchema = z
  .string()
  .refine(
    (v) =>
      isValidDate(v) ||
      (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) &&
        isValidDate(v.slice(0, 10)) &&
        isValidTime(v.slice(11))),
    'recurrenceId の形式が正しくありません',
  );

export const VISIBILITIES = ['family', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** 通知のオフセット（分。負=前）。-10080〜1440（§13） */
export const reminderOffsetSchema = z.number().int().min(-10080).max(1440);

/* ───────── 予定 ───────── */

/** サーバー → PWA（投影済み。§13 EventDTO） */
export const eventDtoSchema = z
  .object({
    id: uuidSchema,
    version: z.number().int().min(1),
    title: z.string().nullable(),
    note: z.string().nullable(),
    location: z.string().nullable(),
    allDay: z.boolean(),
    startAt: isoDateTimeSchema.optional(),
    endAt: isoDateTimeSchema.nullable().optional(),
    startDate: dateIsoSchema.optional(),
    endDate: dateIsoSchema.optional(),
    rrule: z.string().nullable(),
    exdates: z.array(z.string()),
    parentId: uuidSchema.nullable(),
    recurrenceId: z.string().nullable(),
    memberIds: z.array(uuidSchema),
    forEveryone: z.boolean(),
    busy: z.boolean(),
    visibility: z.enum(VISIBILITIES),
    ownerId: uuidSchema,
    createdBy: uuidSchema,
    updatedBy: uuidSchema,
    createdAt: isoDateTimeSchema.nullable(),
    updatedAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type EventDTO = z.infer<typeof eventDtoSchema>;

const titleSchema = z
  .string()
  .transform(normalizeText)
  .refine((v) => graphemeLength(v) >= 1, '件名を入れてください')
  .refine((v) => withinGraphemes(v, 100), '件名は 100 文字までにしてください');

/** 空文字は null にする */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .nullable()
    .transform((v) => {
      if (v === null) return null;
      const t = v.normalize('NFC').trim();
      return t === '' ? null : t;
    })
    .refine(
      (v) => v === null || withinGraphemes(v, max),
      `${label}は ${max} 文字までにしてください`,
    );

/** 予定の項目（作成と更新で共通。§13 EventInput） */
export const eventFieldsShape = {
  title: titleSchema,
  note: optionalText(2000, 'メモ'),
  location: optionalText(100, '場所'),
  allDay: z.boolean(),
  startAt: isoDateTimeSchema.nullable(),
  endAt: isoDateTimeSchema.nullable(),
  startDate: dateIsoSchema.nullable(),
  endDate: dateIsoSchema.nullable(),
  rrule: z.string().max(300).nullable(),
  memberIds: z.array(uuidSchema).max(20),
  forEveryone: z.boolean(),
  busy: z.boolean(),
  visibility: z.enum(VISIBILITIES),
} as const;

/** POST /api/events の本文（未知のキーは拒否） */
export const eventCreateSchema = z
  .object({
    id: uuidSchema.optional(),
    title: eventFieldsShape.title,
    note: eventFieldsShape.note.optional(),
    location: eventFieldsShape.location.optional(),
    allDay: eventFieldsShape.allDay,
    startAt: eventFieldsShape.startAt.optional(),
    endAt: eventFieldsShape.endAt.optional(),
    startDate: eventFieldsShape.startDate.optional(),
    endDate: eventFieldsShape.endDate.optional(),
    rrule: eventFieldsShape.rrule.optional(),
    exdates: z.array(recurrenceIdSchema).max(1000).optional(),
    parentId: uuidSchema.nullable().optional(),
    recurrenceId: recurrenceIdSchema.nullable().optional(),
    memberIds: eventFieldsShape.memberIds.optional(),
    forEveryone: eventFieldsShape.forEveryone.optional(),
    busy: eventFieldsShape.busy.optional(),
    visibility: eventFieldsShape.visibility.optional(),
  })
  .strict();
export type EventCreateInput = z.input<typeof eventCreateSchema>;
export type EventCreate = z.output<typeof eventCreateSchema>;

/** PATCH /api/events/:id の changes（項目ごとに差し替え） */
export const eventChangesSchema = z
  .object({
    title: eventFieldsShape.title.optional(),
    note: eventFieldsShape.note.optional(),
    location: eventFieldsShape.location.optional(),
    allDay: eventFieldsShape.allDay.optional(),
    startAt: eventFieldsShape.startAt.optional(),
    endAt: eventFieldsShape.endAt.optional(),
    startDate: eventFieldsShape.startDate.optional(),
    endDate: eventFieldsShape.endDate.optional(),
    rrule: eventFieldsShape.rrule.optional(),
    memberIds: eventFieldsShape.memberIds.optional(),
    forEveryone: eventFieldsShape.forEveryone.optional(),
    busy: eventFieldsShape.busy.optional(),
    visibility: eventFieldsShape.visibility.optional(),
  })
  .strict();
export type EventChangesInput = z.input<typeof eventChangesSchema>;
export type EventChanges = z.output<typeof eventChangesSchema>;

export const EDIT_SCOPES = ['this', 'following', 'all'] as const;
export type EditScope = (typeof EDIT_SCOPES)[number];

export const eventPatchSchema = z
  .object({
    scope: z.enum(EDIT_SCOPES).default('all'),
    recurrenceId: recurrenceIdSchema.nullable().optional(),
    /** 「この回だけ変更」で作る例外行の ID・「これ以降」の新しいシリーズの ID（クライアントが振る。§11） */
    exceptionId: uuidSchema.optional(),
    /** scope=this で「この回だけ変更」を元に戻す（例外行を消す。changes は空。§24 D34） */
    revert: z.literal(true).optional(),
    changes: eventChangesSchema,
  })
  .strict()
  .refine((p) => !p.revert || (p.scope === 'this' && Object.keys(p.changes).length === 0), {
    message: '元に戻すのは「この回だけ」の変更だけです',
    path: ['revert'],
  });
export type EventPatchInput = z.input<typeof eventPatchSchema>;

export const remindersPutSchema = z
  .object({ offsets: z.array(reminderOffsetSchema).max(3) })
  .strict();

/* ───────── メンバー・設定 ───────── */

const quietHoursSchema = z
  .object({ enabled: z.boolean(), from: timeHmSchema, to: timeHmSchema })
  .strict();

export const notificationSettingsSchema = z
  .object({
    timedDefaults: z.array(reminderOffsetSchema).max(3).default([-30]),
    allDayDefaults: z.array(reminderOffsetSchema).max(3).default([-240]),
    morningDigest: z
      .object({ enabled: z.boolean(), time: timeHmSchema })
      .strict()
      .default({ enabled: true, time: '07:00' }),
    eveningPreview: z
      .object({ enabled: z.boolean(), time: timeHmSchema })
      .strict()
      .default({ enabled: false, time: '21:00' }),
    familyChanges: z.enum(['mine', 'all', 'off']).default('mine'),
    quietHours: quietHoursSchema.default({ enabled: true, from: '22:00', to: '07:00' }),
    showDetailsOnLockScreen: z.boolean().default(true),
  })
  .strict();
export type NotificationSettings = z.output<typeof notificationSettingsSchema>;

export const memberSettingsSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).default('system'),
    weekStart: z.union([z.literal(0), z.literal(1)]).default(0),
    notifications: notificationSettingsSchema.prefault({}),
  })
  .strict();
export type MemberSettings = z.output<typeof memberSettingsSchema>;

/** DB に入っている設定を読む（壊れていたら既定値） */
export function readMemberSettings(json: string): MemberSettings {
  try {
    const parsed = memberSettingsSchema.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {}
  return memberSettingsSchema.parse({});
}

/** 通知の設定の部分更新（既定値を持たない。送った項目だけを当てる） */
export const notificationSettingsPatchSchema = z
  .object({
    timedDefaults: z.array(reminderOffsetSchema).max(3).optional(),
    allDayDefaults: z.array(reminderOffsetSchema).max(3).optional(),
    morningDigest: z.object({ enabled: z.boolean(), time: timeHmSchema }).strict().optional(),
    eveningPreview: z.object({ enabled: z.boolean(), time: timeHmSchema }).strict().optional(),
    familyChanges: z.enum(['mine', 'all', 'off']).optional(),
    quietHours: quietHoursSchema.optional(),
    showDetailsOnLockScreen: z.boolean().optional(),
  })
  .strict();

export const settingsPatchSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
    notifications: notificationSettingsPatchSchema.optional(),
  })
  .strict();

export const memberDtoSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    mark: z.string(),
    color: memberColorSchema,
    role: z.enum(['admin', 'member']),
    disabled: z.boolean(),
    createdAt: isoDateTimeSchema,
    /** 一言入力で人を指す呼び名（端末のルール解析でほかの家族も見分けるため。§24 D37） */
    aliases: z.array(z.string()).optional(),
  })
  .strict();
export type MemberDTO = z.infer<typeof memberDtoSchema>;

export const meDtoSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    mark: z.string(),
    color: memberColorSchema,
    role: z.enum(['admin', 'member']),
    aliases: z.array(z.string()),
    settings: memberSettingsSchema,
    activityReadAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type MeDTO = z.infer<typeof meDtoSchema>;

export const mePatchSchema = z
  .object({
    name: memberNameSchema.optional(),
    mark: memberMarkSchema.optional(),
    color: memberColorSchema.optional(),
    aliases: memberAliasesSchema.optional(),
    settings: settingsPatchSchema.optional(),
  })
  .strict();

export const adminMemberDtoSchema = memberDtoSchema.extend({
  login: z.string(),
  deviceCount: z.number().int().min(0),
});
export type AdminMemberDTO = z.infer<typeof adminMemberDtoSchema>;

export const memberCreateSchema = z
  .object({
    login: z.string(),
    name: memberNameSchema,
    mark: memberMarkSchema,
    color: memberColorSchema,
    role: z.enum(['admin', 'member']).default('member'),
  })
  .strict();

export const memberPatchSchema = z
  .object({
    name: memberNameSchema.optional(),
    mark: memberMarkSchema.optional(),
    color: memberColorSchema.optional(),
    role: z.enum(['admin', 'member']).optional(),
    disabled: z.boolean().optional(),
    aliases: memberAliasesSchema.optional(),
  })
  .strict();

/* ───────── 履歴・ゴミ箱・同期 ───────── */

export const ACTIVITY_ACTIONS = ['create', 'update', 'delete', 'restore'] as const;

export const activityDtoSchema = z
  .object({
    id: uuidSchema,
    actorId: uuidSchema,
    action: z.enum(ACTIVITY_ACTIONS),
    eventId: uuidSchema,
    title: z.string(),
    detail: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    unread: z.boolean(),
  })
  .strict();
export type ActivityDTO = z.infer<typeof activityDtoSchema>;

export const activityPageSchema = z
  .object({ items: z.array(activityDtoSchema), nextBefore: z.string().nullable() })
  .strict();

export const trashItemDtoSchema = z
  .object({
    event: eventDtoSchema,
    deletedAt: isoDateTimeSchema,
    deletedBy: uuidSchema,
  })
  .strict();
export type TrashItemDTO = z.infer<typeof trashItemDtoSchema>;

export const reminderPrefDtoSchema = z
  .object({ eventId: uuidSchema, offsets: z.array(reminderOffsetSchema) })
  .strict();
export type ReminderPrefDTO = z.infer<typeof reminderPrefDtoSchema>;

export const syncResponseSchema = z
  .object({
    cursor: z.number().int().min(0),
    full: z.boolean(),
    events: z.array(eventDtoSchema),
    deletedEventIds: z.array(uuidSchema),
    members: z.array(memberDtoSchema),
    myReminderPrefs: z.array(reminderPrefDtoSchema),
    me: meDtoSchema,
    unreadActivity: z.number().int().min(0),
  })
  .strict();
export type SyncResponse = z.infer<typeof syncResponseSchema>;

/* ───────── 表示用フィード（§13.1） ───────── */

const feedOccurrenceBase = {
  key: z.string(),
  title: z.string().nullable(),
  memberIds: z.array(z.string()),
  forEveryone: z.boolean(),
  busy: z.boolean(),
  private: z.boolean(),
};

export const feedOccurrenceSchema = z.union([
  z
    .object({
      ...feedOccurrenceBase,
      allDay: z.literal(false),
      startAt: isoDateTimeSchema,
      endAt: isoDateTimeSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...feedOccurrenceBase,
      allDay: z.literal(true),
      startDate: dateIsoSchema,
      endDate: dateIsoSchema,
    })
    .strict(),
]);
export type FeedOccurrence = z.infer<typeof feedOccurrenceSchema>;

export const displayFeedV1Schema = z
  .object({
    version: z.literal(1),
    range: z.object({ from: dateIsoSchema, to: dateIsoSchema }).strict(),
    holidays: z.array(z.object({ date: dateIsoSchema, name: z.string() }).strict()),
    members: z.array(
      z
        .object({ id: z.string(), name: z.string(), mark: z.string(), color: memberColorSchema })
        .strict(),
    ),
    occurrences: z.array(feedOccurrenceSchema),
  })
  .strict();
export type DisplayFeedV1 = z.infer<typeof displayFeedV1Schema>;
