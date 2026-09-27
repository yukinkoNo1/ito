import { describe, expect, it } from 'vitest';
import {
  canSeeContent,
  defaultBusy,
  type EventRecord,
  fieldsFromChanges,
  fieldsFromCreate,
  projectEvent,
} from '../src/events';
import { fromJst } from '../src/jst';
import { eventCreateSchema } from '../src/schemas';

const OWNER = '0192f5a0-1c00-7000-8000-000000000003';
const OTHER = '0192f5a0-1c00-7000-8000-000000000002';

function record(extra: Partial<EventRecord> = {}): EventRecord {
  return {
    id: '0192f5b1-0000-7000-8000-00000000e003',
    version: 3,
    title: 'プレゼント選び',
    note: 'メモ',
    location: '駅前',
    allDay: false,
    startAt: fromJst('2026-09-29', '17:00'),
    endAt: null,
    startDate: null,
    endDate: null,
    rrule: null,
    exdates: [],
    parentId: null,
    recurrenceId: null,
    memberIds: [OWNER],
    forEveryone: false,
    busy: true,
    visibility: 'private',
    ownerId: OWNER,
    createdBy: OWNER,
    updatedBy: OWNER,
    deletedBy: null,
    createdAt: fromJst('2026-09-20', '10:00'),
    updatedAt: fromJst('2026-09-21', '10:00'),
    deletedAt: null,
    ...extra,
  };
}

describe('projectEvent（§10）', () => {
  it('他人の非公開は §10 の形だけ', () => {
    expect(projectEvent(record(), OTHER)).toEqual({
      id: '0192f5b1-0000-7000-8000-00000000e003',
      version: 3,
      title: null,
      note: null,
      location: null,
      allDay: false,
      startAt: '2026-09-29T17:00:00+09:00',
      endAt: null,
      rrule: null,
      exdates: [],
      parentId: null,
      recurrenceId: null,
      memberIds: [OWNER],
      forEveryone: false,
      busy: true,
      visibility: 'private',
      ownerId: OWNER,
      createdBy: OWNER,
      updatedBy: OWNER,
      createdAt: null,
      updatedAt: null,
    });
  });

  it('閲覧者なし（表示用フィード）は持ち主のものも中身を出さない', () => {
    expect(projectEvent(record(), null).title).toBeNull();
    expect(canSeeContent(record(), null)).toBe(false);
  });

  it('持ち主と家族の予定はそのまま', () => {
    expect(projectEvent(record(), OWNER).title).toBe('プレゼント選び');
    expect(projectEvent(record({ visibility: 'family' }), OTHER).title).toBe('プレゼント選び');
    expect(projectEvent(record({ visibility: 'family' }), null).title).toBe('プレゼント選び');
  });

  it('終日の非公開も日付だけ出す', () => {
    const r = record({
      allDay: true,
      startAt: null,
      startDate: '2026-09-29',
      endDate: '2026-09-30',
    });
    const p = projectEvent(r, OTHER);
    expect(p).toMatchObject({
      allDay: true,
      startDate: '2026-09-29',
      endDate: '2026-09-30',
      title: null,
    });
    expect(p.startAt).toBeUndefined();
  });
});

describe('予定の項目の検証（§10）', () => {
  const parse = (v: unknown) => eventCreateSchema.parse(v);

  it('busy の既定値', () => {
    expect(defaultBusy(false, null, null)).toBe(true);
    expect(defaultBusy(true, '2026-09-29', '2026-09-29')).toBe(false);
    expect(defaultBusy(true, '2026-09-28', '2026-09-30')).toBe(true);
  });

  it('終日の終わりの日を省けば開始日', () => {
    const r = fieldsFromCreate(parse({ title: 'a', allDay: true, startDate: '2026-09-29' }), OWNER);
    expect('value' in r && r.value.endDate).toBe('2026-09-29');
  });

  it('終日は 366 日まで、日付は 1970〜2100 年', () => {
    expect(
      'errors' in
        fieldsFromCreate(
          parse({ title: 'a', allDay: true, startDate: '2026-01-01', endDate: '2027-01-02' }),
          OWNER,
        ),
    ).toBe(true);
    expect(
      'errors' in
        fieldsFromCreate(parse({ title: 'a', allDay: true, startDate: '2101-01-01' }), OWNER),
    ).toBe(true);
  });

  it('メモ・場所の空文字は null、件名は前後の空白を除く', () => {
    const r = fieldsFromCreate(
      parse({
        title: '  歯医者 ',
        allDay: false,
        startAt: '2026-09-29T10:00:00+09:00',
        note: ' ',
        location: '',
      }),
      OWNER,
    );
    expect('value' in r && r.value).toMatchObject({ title: '歯医者', note: null, location: null });
  });

  it('非公開にすると担当は持ち主だけ・全員は外れる（更新）', () => {
    const current = record({ visibility: 'family', memberIds: [OWNER], forEveryone: false });
    const r = fieldsFromChanges(current, { visibility: 'private' });
    expect('value' in r && r.value).toMatchObject({
      visibility: 'private',
      memberIds: [OWNER],
      forEveryone: false,
    });
    const bad = fieldsFromChanges(current, { visibility: 'private', memberIds: [OTHER] });
    expect('errors' in bad).toBe(true);
  });
});
