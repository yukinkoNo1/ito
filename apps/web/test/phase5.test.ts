import { fromJst, type MeDTO, memberSettingsSchema } from '@ito/core';
import { describe, expect, it } from 'vitest';
import { emptyDraft } from '../src/viewmodels/detail';
import {
  nlpContext,
  nlpToPatch,
  overlapsFor,
  parseLocally,
  parseResponseSchema,
  toAmbiguityVM,
  visibleAmbiguities,
} from '../src/viewmodels/nlp';
import { ev, M, members } from './fixtures';

/** Phase 5（一言入力）の PWA 側 */

const me: MeDTO = {
  id: M.papa,
  name: 'お父さん',
  mark: '父',
  color: 'kaki',
  role: 'admin',
  aliases: ['パパ'],
  settings: memberSettingsSchema.parse({}),
  activityReadAt: null,
};
const now = fromJst('2026-09-27', '14:18');
const ctx = nlpContext(me, members, now);

describe('ルール解析の文脈と、書く画面への反映（§16）', () => {
  it('自分の呼び名とほかの家族の名前・略称で人を見分ける', () => {
    expect(parseLocally('明日 散歩 パパ', ctx).draft.memberIds).toEqual([M.papa]);
    const mama = members.find((m) => m.id === M.mama);
    expect(parseLocally(`明日 散歩 ${mama?.name}`, ctx).draft.memberIds).toEqual([M.mama]);
  });

  it('一言に書いていない日付・時刻・人は、先に選んでいた日（開いた日）を残す', () => {
    const current = emptyDraft('2026-10-12', M.papa, '10:00');
    const r = parseLocally('E2E 運動会', ctx);
    expect(nlpToPatch(r.draft, r.found, current)).toEqual({
      title: 'E2E 運動会',
      isPrivate: false,
      recurrence: { kind: 'none' },
      recurrenceEnd: { kind: 'never' },
    });
    expect(visibleAmbiguities(r.ambiguities, r.found)).toEqual([]);
  });

  it('時刻だけ書いたら、開いた日のまま時刻を入れる。日付をまたぐ時刻は開いた日の翌日に終わる', () => {
    const current = emptyDraft('2026-10-12', M.papa);
    const r = parseLocally('22時〜翌1時 夜釣り', ctx);
    expect(nlpToPatch(r.draft, r.found, current)).toMatchObject({
      allDay: false,
      startTime: '22:00',
      endTime: '01:00',
      endDate: '2026-10-13',
    });
    expect('startDate' in nlpToPatch(r.draft, r.found, current)).toBe(false);
  });

  it('日付を書いたら置き換え、曖昧さは質問にする（選ぶと日付を変える）', () => {
    const current = emptyDraft('2026-09-27', M.papa);
    const r = parseLocally('来週の土曜 18時 焼肉', ctx);
    const patch = nlpToPatch(r.draft, r.found, current);
    expect(patch).toMatchObject({ startDate: '2026-10-10', startTime: '18:00' });
    const [a] = visibleAmbiguities(r.ambiguities, r.found).map((x) =>
      toAmbiguityVM(x, { ...current, ...patch }),
    );
    expect(a).toEqual({
      field: 'date',
      question: 'どの日ですか？',
      options: [
        { label: '10/10(土)', patch: { startDate: '2026-10-10', endDate: '2026-10-10' } },
        { label: '10/3(土)', patch: { startDate: '2026-10-03', endDate: '2026-10-03' } },
      ],
      chosen: null,
    });
  });

  it('時間帯だけ（午後）は終日にして時刻を聞く。人の曖昧さはその人に', () => {
    const current = emptyDraft('2026-09-27', M.papa);
    const r = parseLocally('10/3 午後 買い物', ctx);
    const [t] = r.ambiguities.map((x) => toAmbiguityVM(x, current));
    expect(t?.options.map((o) => o.patch)).toEqual([
      { allDay: false, startTime: '13:00', endTime: null, busy: true },
      { allDay: false, startTime: '15:00', endTime: null, busy: true },
      { allDay: true, startTime: null, endTime: null, busy: false },
    ]);
    const m = toAmbiguityVM(
      { field: 'members', question: 'だれ？', options: [{ label: 'お母さん', value: M.mama }] },
      current,
    );
    expect(m.options[0]?.patch).toEqual({ memberIds: [M.mama], forEveryone: false });
  });

  it('/api/parse の応答を確かめる（形が違えばルール解析のまま）', () => {
    const r = parseLocally('明日 19時 歯医者', ctx);
    expect(parseResponseSchema.safeParse({ source: 'ai', ...r }).success).toBe(true);
    expect(parseResponseSchema.safeParse({ source: 'ai', draft: {} }).success).toBe(false);
  });
});

describe('重なりの警告（§16。端末の DB で同じ日時の予定を探す）', () => {
  const trip = ev({
    title: '家族旅行（金沢）',
    allDay: true,
    startAt: undefined,
    endAt: undefined,
    startDate: '2026-10-10',
    endDate: '2026-10-12',
    forEveryone: true,
    busy: true,
  });
  const dentist = ev({
    title: '歯医者',
    startAt: '2026-10-10T19:00:00+09:00',
    endAt: '2026-10-10T20:00:00+09:00',
  });
  const secret = ev({
    title: null,
    visibility: 'private',
    ownerId: M.mama,
    startAt: '2026-10-10T19:30:00+09:00',
    endAt: null,
  });
  const free = ev({
    title: 'お祭り',
    allDay: true,
    startAt: undefined,
    endAt: undefined,
    startDate: '2026-10-10',
    endDate: '2026-10-10',
    busy: false,
  });
  const events = [trip, dentist, secret, free];

  it('時刻の予定: 重なる予定ありの予定を出す（他人の非公開は「予定あり」、予定なしの終日は出さない）', () => {
    const draft = {
      ...emptyDraft('2026-10-10', M.papa, '19:15'),
      title: '夕食',
    };
    expect(overlapsFor(draft, events, M.papa, null)).toEqual([
      '10/10(土) は「家族旅行（金沢）」と重なっています',
      '10/10(土) は「歯医者」と重なっています',
      '10/10(土) は「予定あり」と重なっています',
    ]);
  });

  it('直している予定そのものとは重ならない。重ならなければ空', () => {
    const draft = { ...emptyDraft('2026-10-10', M.papa, '19:00'), endTime: '20:00' };
    expect(overlapsFor(draft, [dentist], M.papa, dentist.id)).toEqual([]);
    const later = { ...emptyDraft('2026-10-20', M.papa, '19:00') };
    expect(overlapsFor(later, events, M.papa, null)).toEqual([]);
  });
});
