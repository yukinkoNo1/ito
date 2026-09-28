import { fromJst, type MeDTO, memberSettingsSchema } from '@ito/core';
import { describe, expect, it } from 'vitest';
import { emptyDraft } from '../src/viewmodels/detail';
import {
  applyTextPatch,
  forgetTextFields,
  nlpContext,
  nlpToPatch,
  overlapsFor,
  parseLocally,
  parseResponseSchema,
  protectTouched,
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
    // 公開・非公開と繰り返しも、書いていなければ変えない（最近の予定の札・複製で選んだものを残す。§24 D37）
    expect(nlpToPatch(r.draft, r.found, current)).toEqual({ title: 'E2E 運動会' });
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

describe('一言と札の組み合わせ（Phase 5 のレビュー）', () => {
  it('非公開の最近の予定を選んでから確認へ進んでも、非公開のまま（一言に「内緒」がなくても公開にしない）', () => {
    const picked = {
      ...emptyDraft('2026-10-12', M.papa, '10:00'),
      title: 'プレゼント選び',
      isPrivate: true,
    };
    const r = parseLocally('プレゼント選び', ctx);
    const patch = nlpToPatch(r.draft, r.found, picked);
    expect(patch).toEqual({ title: 'プレゼント選び' });
    // 複製した非公開の毎週の予定の件名だけ直しても、非公開・繰り返しは残る
    const dup = {
      ...picked,
      title: '通院',
      recurrence: { kind: 'weekly' as const, interval: 1, weekdays: [1 as const] },
    };
    const r2 = parseLocally('通院（再診）', ctx);
    expect(nlpToPatch(r2.draft, r2.found, dup)).toEqual({ title: '通院(再診)' });
  });

  it('一言で入れた項目は、その語を消したら入れる前の値に戻る（札・候補で変えた項目は戻さない）', () => {
    const base = emptyDraft('2026-10-12', M.papa, '10:00');
    const r1 = parseLocally('内緒 毎週月 通院', ctx);
    const a1 = applyTextPatch(base, nlpToPatch(r1.draft, r1.found, base), {});
    const d1 = { ...base, ...a1.patch };
    expect(d1.isPrivate).toBe(true);
    expect(d1.recurrence.kind).toBe('weekly');
    const r2 = parseLocally('通院', ctx);
    const a2 = applyTextPatch(d1, nlpToPatch(r2.draft, r2.found, d1), a1.textBefore);
    const d2 = { ...d1, ...a2.patch };
    expect(d2.isPrivate).toBe(false);
    expect(d2.recurrence).toEqual({ kind: 'none' });
    expect(d2.memberIds).toEqual(base.memberIds);
    expect(a2.textBefore).toEqual({});
    // 札で繰り返しを選び直したあとは、一言から消しても戻さない
    const kept = forgetTextFields(a1.textBefore, ['recurrence']);
    const a3 = applyTextPatch(d1, nlpToPatch(r2.draft, r2.found, d1), kept);
    expect({ ...d1, ...a3.patch }.recurrence.kind).toBe('weekly');
  });

  it('札で日付を選んでから一言に日付を書いても、複数日にしない（終わりの日は選んだ日から数える）', () => {
    const current = emptyDraft('2026-09-28', M.papa, null);
    const r = parseLocally('土曜 映画', ctx);
    const patch = protectTouched(nlpToPatch(r.draft, r.found, current), ['startDate'], current);
    expect('startDate' in patch).toBe(false);
    expect(patch.endDate).toBe('2026-09-28');
    // 日付をまたぐ時刻なら、選んだ日の次の日に終わる
    const night = parseLocally('10/15 22時〜翌1時 夜釣り', ctx);
    const p2 = protectTouched(
      nlpToPatch(night.draft, night.found, current),
      ['startDate'],
      current,
    );
    expect(p2).toMatchObject({ startTime: '22:00', endTime: '01:00', endDate: '2026-09-29' });
  });

  it('終日の札を選んでから一言に時刻を書いても、時刻・予定あり（busy）を上書きしない', () => {
    const current = { ...emptyDraft('2026-09-28', M.papa, null), allDay: true, busy: false };
    const r = parseLocally('19時 夕食', ctx);
    const patch = protectTouched(
      nlpToPatch(r.draft, r.found, current),
      ['allDay', 'startTime', 'endTime'],
      current,
    );
    expect(patch).toEqual({ title: '夕食' });
  });

  it('ほかの家族の呼び名も見分ける（オフラインのかんたん解析でも。§21 #5・#34）', () => {
    const withAliases = members.map((m) => (m.id === M.mama ? { ...m, aliases: ['ママ'] } : m));
    const asKid = nlpContext({ ...me, id: M.haru, aliases: [] }, withAliases, now);
    expect(parseLocally('ママ 明日 7時 早朝会議', asKid).draft.memberIds).toEqual([M.mama]);
  });

  it('応答の found に公開・繰り返しがなくても読める（ないものは書いていない）', () => {
    const r = parseResponseSchema.safeParse({
      source: 'rules',
      draft: {
        title: 'x',
        allDay: true,
        startDate: '2026-09-28',
        endDate: '2026-09-28',
        startTime: null,
        endTime: null,
        memberIds: [],
        forEveryone: false,
        location: null,
        isPrivate: false,
        busy: false,
        recurrence: { kind: 'none' },
      },
      ambiguities: [],
      found: { date: true, time: false, members: false },
    });
    expect(r.success && r.data.found).toEqual({
      date: true,
      time: false,
      members: false,
      private: false,
      recurrence: false,
    });
  });
});

describe('重なりの警告の範囲（Phase 5 のレビュー）', () => {
  it('終わりのない予定は 60 分とみなす（前から続く予定も重なる）', () => {
    const dentist = ev({ title: '歯医者', startAt: '2026-10-10T19:00:00+09:00', endAt: null });
    const draft = { ...emptyDraft('2026-10-10', M.papa, '19:30'), title: '夕食' };
    expect(overlapsFor(draft, [dentist], M.papa, null)).toEqual([
      '10/10(土) は「歯医者」と重なっています',
    ]);
    const after = { ...emptyDraft('2026-10-10', M.papa, '20:00'), title: '夕食' };
    expect(overlapsFor(after, [dentist], M.papa, null)).toEqual([]);
  });

  it('終わりが開始以前の時刻なら次の日まで（保存と同じ決まり）', () => {
    const late = ev({
      title: '夜の電話',
      startAt: '2026-10-11T00:30:00+09:00',
      endAt: '2026-10-11T01:00:00+09:00',
    });
    const draft = {
      ...emptyDraft('2026-10-10', M.papa, '23:00'),
      endTime: '01:00',
      title: 'カラオケ',
    };
    expect(overlapsFor(draft, [late], M.papa, null)).toEqual([
      '10/11(日) は「夜の電話」と重なっています',
    ]);
  });
});
